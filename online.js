/**
 * Online multiplayer via MQTT over WebSockets (public broker relay).
 * Works across different networks — no WebRTC / NAT / TURN required.
 * Host uses a short room code as the topic. Star topology: host relays to guests.
 */

const Online = (() => {
  const TOPIC_ROOT = "xo-fields-v1";
  const BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
  ];
  const JOIN_TIMEOUT_MS = 20000;
  const HOST_CLAIM_MS = 700;

  let client = null;
  let role = null;
  let handlers = {};
  /** @type {Set<string>} */
  let guests = new Set();
  let maxGuests = 1;
  let myId = null;
  let roomCode = null;
  let roomTopic = null;
  let hostTopic = null;
  let joinTimer = null;
  let destroyed = true;
  let hostAttempt = 0;

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function randomId() {
    return (
      "p_" +
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  function clearJoinTimer() {
    if (joinTimer) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
  }

  function publish(msg, opts = {}) {
    if (!client || !roomTopic || !client.connected) return;
    try {
      client.publish(roomTopic, JSON.stringify(msg), {
        qos: 1,
        retain: false,
        ...opts,
      });
    } catch (_) {}
  }

  function publishHostMeta(payload, retain = true) {
    if (!client || !hostTopic || !client.connected) return;
    try {
      client.publish(
        hostTopic,
        payload == null ? "" : JSON.stringify(payload),
        { qos: 1, retain }
      );
    } catch (_) {}
  }

  function destroy() {
    destroyed = true;
    hostAttempt += 1;
    clearJoinTimer();
    const c = client;
    const ht = hostTopic;
    const wasHost = role === "host";
    const id = myId;

    if (c && c.connected && roomTopic && id) {
      try {
        c.publish(
          roomTopic,
          JSON.stringify({ type: "__leave", from: id }),
          { qos: 0 }
        );
      } catch (_) {}
    }
    if (c && wasHost && ht) {
      try {
        c.publish(ht, "", { qos: 1, retain: true });
      } catch (_) {}
    }

    guests.clear();
    peerCleanup(c);
    client = null;
    role = null;
    maxGuests = 1;
    myId = null;
    roomCode = null;
    roomTopic = null;
    hostTopic = null;
  }

  function peerCleanup(c) {
    if (!c) return;
    try {
      c.removeAllListeners();
    } catch (_) {}
    try {
      c.end(true);
    } catch (_) {}
  }

  function guestCount() {
    return guests.size;
  }

  function send(msg, exceptPeerId) {
    if (!myId) return;
    publish({
      type: "__relay",
      from: myId,
      except: exceptPeerId || null,
      to: null,
      body: msg,
    });
  }

  function sendTo(peerId, msg) {
    if (!myId || !peerId) return;
    publish({
      type: "__relay",
      from: myId,
      except: null,
      to: peerId,
      body: msg,
    });
  }

  function handleRoomMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch (_) {
      return;
    }
    if (!msg || !msg.type || msg.from === myId) return;

    if (msg.type === "__hello" && role === "host") {
      if (guests.has(msg.from)) {
        publish({ type: "__welcome", from: myId, to: msg.from });
        return;
      }
      if (guests.size >= maxGuests) {
        publish({ type: "__room-full", from: myId, to: msg.from });
        return;
      }
      guests.add(msg.from);
      publish({ type: "__welcome", from: myId, to: msg.from });
      if (handlers.onPeerJoined) {
        handlers.onPeerJoined({ peerId: msg.from, guestCount: guests.size });
      }
      if (handlers.onConnected) {
        handlers.onConnected({
          role: "host",
          peerId: msg.from,
          guestCount: guests.size,
        });
      }
      return;
    }

    if (msg.type === "__welcome" && role === "guest" && msg.to === myId) {
      clearJoinTimer();
      if (handlers.onConnected) {
        handlers.onConnected({ role: "guest", peerId: myId });
      }
      return;
    }

    if (msg.type === "__room-full" && role === "guest" && msg.to === myId) {
      clearJoinTimer();
      if (handlers.onMessage) {
        handlers.onMessage({ type: "room-full" }, msg.from);
      }
      return;
    }

    if (msg.type === "__leave") {
      if (role === "host" && guests.has(msg.from)) {
        guests.delete(msg.from);
        if (handlers.onPeerLeft) handlers.onPeerLeft(msg.from);
        if (handlers.onDisconnect && guests.size === 0) {
          handlers.onDisconnect();
        }
      } else if (role === "guest") {
        if (handlers.onDisconnect) handlers.onDisconnect();
      }
      return;
    }

    if (msg.type === "__relay" && msg.body) {
      if (msg.to && msg.to !== myId) return;
      if (msg.except && msg.except === myId) return;
      if (handlers.onMessage) handlers.onMessage(msg.body, msg.from);
    }
  }

  function connectMqtt(onConnected, onFail) {
    if (typeof mqtt === "undefined") {
      onFail(new Error("MQTT library not loaded"));
      return;
    }

    let brokerIndex = 0;
    let settled = false;

    const tryNext = () => {
      if (destroyed || settled) return;
      if (brokerIndex >= BROKERS.length) {
        settled = true;
        onFail(new Error("Could not reach relay server"));
        return;
      }

      const url = BROKERS[brokerIndex++];
      peerCleanup(client);

      const c = mqtt.connect(url, {
        clientId: myId,
        clean: true,
        reconnectPeriod: 0,
        connectTimeout: 10000,
        will: roomTopic
          ? {
              topic: roomTopic,
              payload: JSON.stringify({ type: "__leave", from: myId }),
              qos: 0,
              retain: false,
            }
          : undefined,
      });
      client = c;

      const failThis = () => {
        if (settled || destroyed) return;
        peerCleanup(c);
        if (client === c) client = null;
        tryNext();
      };

      const timer = setTimeout(failThis, 12000);

      c.on("connect", () => {
        if (settled || destroyed) {
          peerCleanup(c);
          return;
        }
        clearTimeout(timer);
        settled = true;
        c.on("message", (topic, payload) => {
          if (destroyed) return;
          if (topic === roomTopic) handleRoomMessage(payload);
        });
        c.on("close", () => {
          if (destroyed) return;
          if (handlers.onDisconnect) handlers.onDisconnect();
        });
        c.on("error", (err) => {
          if (destroyed) return;
          if (handlers.onError) handlers.onError(err);
        });
        onConnected(c);
      });

      c.on("error", () => {
        clearTimeout(timer);
        failThis();
      });
    };

    tryNext();
  }

  function host(preferredCode, onReady, opts = {}) {
    destroy();
    destroyed = false;
    role = "host";
    maxGuests = opts.maxGuests || 1;
    myId = randomId();
    guests = new Set();

    const attempt = (code) => {
      if (destroyed) return;
      const attemptId = ++hostAttempt;
      roomCode = code;
      roomTopic = `${TOPIC_ROOT}/${code}/room`;
      hostTopic = `${TOPIC_ROOT}/${code}/host`;

      connectMqtt(
        (c) => {
          if (destroyed || attemptId !== hostAttempt) {
            peerCleanup(c);
            return;
          }
          let claimed = false;
          let sawForeignHost = false;

          c.subscribe([hostTopic, roomTopic], { qos: 1 }, (err) => {
            if (err) {
              if (handlers.onError) handlers.onError(err);
              return;
            }
            if (destroyed || attemptId !== hostAttempt) return;

            const onMeta = (topic, payload) => {
              if (topic !== hostTopic || claimed) return;
              if (attemptId !== hostAttempt) return;
              const text = String(payload || "");
              if (!text) return;
              try {
                const meta = JSON.parse(text);
                if (meta && meta.hostId && meta.hostId !== myId) {
                  sawForeignHost = true;
                }
              } catch (_) {}
            };
            c.on("message", onMeta);

            setTimeout(() => {
              try {
                c.removeListener("message", onMeta);
              } catch (_) {
                try {
                  c.off("message", onMeta);
                } catch (_) {}
              }
              if (destroyed || attemptId !== hostAttempt) return;
              if (sawForeignHost) {
                peerCleanup(c);
                if (client === c) client = null;
                attempt(randomCode());
                return;
              }
              claimed = true;
              publishHostMeta({ hostId: myId, ts: Date.now() }, true);
              onReady({ code, peerId: myId });
            }, HOST_CLAIM_MS);
          });
        },
        (err) => {
          if (attemptId !== hostAttempt) return;
          if (handlers.onError) handlers.onError(err);
        }
      );
    };

    attempt((preferredCode || randomCode()).toUpperCase());
  }

  function join(roomCodeInput, onReady) {
    destroy();
    destroyed = false;
    role = "guest";
    maxGuests = 1;
    myId = randomId();
    guests = new Set();
    const code = String(roomCodeInput || "").trim().toUpperCase();
    roomCode = code;
    roomTopic = `${TOPIC_ROOT}/${code}/room`;
    hostTopic = `${TOPIC_ROOT}/${code}/host`;

    connectMqtt(
      (c) => {
        c.subscribe(roomTopic, { qos: 1 }, (err) => {
          if (err) {
            if (handlers.onError) handlers.onError(err);
            return;
          }

          let welcomed = false;
          const prevConnected = handlers.onConnected;
          handlers.onConnected = (info) => {
            if (welcomed) return;
            welcomed = true;
            clearJoinTimer();
            if (prevConnected) prevConnected(info);
            onReady({ role: "guest", code, peerId: myId });
          };

          publish({ type: "__hello", from: myId });

          joinTimer = setTimeout(() => {
            if (welcomed || destroyed) return;
            const err = new Error("Room not found or host unreachable");
            err.code = "ROOM_UNREACHABLE";
            if (handlers.onError) handlers.onError(err);
            destroy();
          }, JOIN_TIMEOUT_MS);
        });
      },
      (err) => {
        if (handlers.onError) handlers.onError(err);
      }
    );
  }

  function setHandlers(h) {
    handlers = h || {};
  }

  function setMaxGuests(n) {
    maxGuests = n;
  }

  return {
    host,
    join,
    send,
    sendTo,
    destroy,
    setHandlers,
    setMaxGuests,
    randomCode,
    guestCount,
    get role() {
      return role;
    },
    get peerId() {
      return myId;
    },
    get maxGuests() {
      return maxGuests;
    },
  };
})();

window.XOOnline = Online;
