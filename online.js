/**
 * Online multiplayer via PeerJS (WebRTC).
 * Host uses a short room code as peer id. Star topology: host relays to all guests.
 */

const Online = (() => {
  let peer = null;
  let role = null;
  let handlers = {};
  /** @type {Map<string, import('peerjs').DataConnection>} */
  let connections = new Map();
  let maxGuests = 1;

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function destroy() {
    connections.forEach((c) => {
      try {
        c.close();
      } catch (_) {}
    });
    connections.clear();
    try {
      if (peer) peer.destroy();
    } catch (_) {}
    peer = null;
    role = null;
    maxGuests = 1;
  }

  function guestCount() {
    let n = 0;
    connections.forEach((c) => {
      if (c.open) n += 1;
    });
    return n;
  }

  function send(msg, exceptPeerId) {
    connections.forEach((c, id) => {
      if (!c.open) return;
      if (exceptPeerId && id === exceptPeerId) return;
      try {
        c.send(msg);
      } catch (_) {}
    });
  }

  function sendTo(peerId, msg) {
    const c = connections.get(peerId);
    if (c && c.open) {
      try {
        c.send(msg);
      } catch (_) {}
    }
  }

  function wireConnection(c) {
    const id = c.peer;
    connections.set(id, c);

    c.on("data", (data) => {
      if (handlers.onMessage) handlers.onMessage(data, id);
    });

    c.on("close", () => {
      connections.delete(id);
      if (handlers.onPeerLeft) handlers.onPeerLeft(id);
      if (handlers.onDisconnect && guestCount() === 0 && role === "host") {
        handlers.onDisconnect();
      }
      if (handlers.onDisconnect && role === "guest") {
        handlers.onDisconnect();
      }
    });

    c.on("error", (err) => {
      if (handlers.onError) handlers.onError(err);
    });
  }

  function host(preferredCode, onReady, opts = {}) {
    destroy();
    role = "host";
    maxGuests = opts.maxGuests || 1;
    const code = (preferredCode || randomCode()).toUpperCase();

    peer = new Peer(code);
    peer.on("open", (id) => {
      onReady({ code: id.toUpperCase(), peerId: id });
    });
    peer.on("connection", (c) => {
      if (guestCount() >= maxGuests) {
        c.on("open", () => {
          try {
            c.send({ type: "room-full" });
          } catch (_) {}
          c.close();
        });
        return;
      }
      wireConnection(c);
      c.on("open", () => {
        if (handlers.onPeerJoined) {
          handlers.onPeerJoined({ peerId: c.peer, guestCount: guestCount() });
        }
        if (handlers.onConnected) {
          handlers.onConnected({
            role: "host",
            peerId: c.peer,
            guestCount: guestCount(),
          });
        }
      });
    });
    peer.on("error", (err) => {
      if (err && err.type === "unavailable-id") {
        host(randomCode(), onReady, opts);
        return;
      }
      if (handlers.onError) handlers.onError(err);
    });
  }

  function join(roomCode, onReady) {
    destroy();
    role = "guest";
    maxGuests = 1;
    const code = String(roomCode || "").trim().toUpperCase();
    peer = new Peer();
    peer.on("open", () => {
      const c = peer.connect(code, { reliable: true });
      wireConnection(c);
      c.on("open", () => {
        onReady({ role: "guest", code, peerId: peer.id });
        if (handlers.onConnected) {
          handlers.onConnected({ role: "guest", peerId: peer.id });
        }
      });
    });
    peer.on("error", (err) => {
      if (handlers.onError) handlers.onError(err);
    });
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
      return peer ? peer.id : null;
    },
    get maxGuests() {
      return maxGuests;
    },
  };
})();

window.XOOnline = Online;
