(() => {
  const { LEVELS, QUAD, createState, applyMove, legalMoves, pickAiMove } = window.XOGame;
  const Online = window.XOOnline;
  const { t, setLang, applyDocument, getLang } = window.XOi18n;

  const LEVEL_NAME_KEYS = {
    1: "levelClassic",
    2: "levelWide",
    3: "levelQuad",
  };

  const DEMO_COPY = {
    1: ["demo1Play", "demo1Win", "demo1Lose"],
    2: ["demo2Play", "demo2Win", "demo2Lose"],
    3: ["demo3Play", "demo3Win", "demo3Lose"],
  };

  const DIFF_KEYS = {
    easy: "diffEasy",
    medium: "diffMedium",
    hard: "diffHard",
  };

  /** Seconds per move by difficulty */
  const TURN_SECONDS = {
    easy: 30,
    medium: 15,
    hard: 8,
  };

  /** Turn order: X1 → O1 → X2 → O2 */
  const TEAM_SEATS = [
    { mark: "X", seatKey: "teamSeatX1", teamKey: "teamX" },
    { mark: "O", seatKey: "teamSeatO1", teamKey: "teamO" },
    { mark: "X", seatKey: "teamSeatX2", teamKey: "teamX" },
    { mark: "O", seatKey: "teamSeatO2", teamKey: "teamO" },
  ];

  const state = {
    mode: null,
    level: 1,
    difficulty: "medium",
    difficulties: { 1: "easy", 2: "easy", 3: "easy", online: "easy" },
    game: null,
    scores: { X: 0, O: 0 },
    aiThinking: false,
    pendingMatch: null,
    demoTimer: null,
    teamSeat: 0,
    timer: {
      id: null,
      endsAt: 0,
      totalMs: 0,
      paused: false,
    },
    lastResultReason: null,
    online: {
      myMark: null,
      mySeat: null,
      format: "duel", // duel | team
      hostLevel: 1,
      connected: false,
      peerIdFull: null,
      guestOrder: [], // peer ids in join order (host side)
    },
  };

  const $ = (sel) => document.querySelector(sel);
  const screens = {
    home: $("#screen-home"),
    levels: $("#screen-levels"),
    howto: $("#screen-howto"),
    online: $("#screen-online"),
    game: $("#screen-game"),
  };

  function levelName(level) {
    return t(LEVEL_NAME_KEYS[level] || "levelClassic");
  }

  function modeLabel(mode) {
    if (mode === "ai") return t("modeLabelAi");
    if (mode === "local") return t("modeLabelLocal");
    if (mode === "team") return t("modeLabelTeam");
    return t("modeLabelOnline");
  }

  function currentTeamSeat() {
    return TEAM_SEATS[state.teamSeat] || TEAM_SEATS[0];
  }

  function advanceTeamSeat() {
    state.teamSeat = (state.teamSeat + 1) % TEAM_SEATS.length;
  }

  function resetTeamSeat() {
    state.teamSeat = 0;
  }

  function isOnlineTeam() {
    return state.mode === "online" && state.online.format === "team";
  }

  function showTeamUI() {
    return state.mode === "team" || isOnlineTeam();
  }

  function onlineNeededPlayers() {
    return state.online.format === "team" ? 4 : 2;
  }

  function updateOnlineFormatHint() {
    const el = $("#online-format-hint");
    const selected = $("#online-format-selected");
    if (el) {
      el.textContent =
        state.online.format === "team" ? t("onlineTeam4Hint") : t("onlineDuelHint");
    }
    if (selected) {
      selected.textContent = t("onlineSelected", {
        name: state.online.format === "team" ? t("onlineTeam4") : t("onlineDuel"),
      });
    }
  }

  function updateOnlinePlayersLabel() {
    const el = $("#online-players");
    const wait = $("#host-wait");
    if (!el) return;
    const need = onlineNeededPlayers();
    const n = 1 + Online.guestCount();
    el.textContent = t("waitingPlayers", { n, need });
    if (wait) {
      wait.textContent =
        state.online.format === "team" ? t("waitingTeam") : t("waitingOpponent");
    }
  }

  function renderTeamRoster() {
    const roster = $("#team-roster");
    const scoreTx = $("#score-team-x");
    const scoreTo = $("#score-team-o");
    const isTeam = showTeamUI();

    if (roster) roster.classList.toggle("is-hidden", !isTeam);
    if (scoreTx) scoreTx.classList.toggle("is-hidden", !isTeam);
    if (scoreTo) scoreTo.classList.toggle("is-hidden", !isTeam);
    if (!isTeam || !roster) return;

    roster.querySelectorAll(".team-seat").forEach((el) => {
      const seat = Number(el.getAttribute("data-seat"));
      const info = TEAM_SEATS[seat];
      el.textContent = t(info.seatKey);
      el.classList.toggle(
        "is-active",
        seat === state.teamSeat && !(state.game && state.game.over)
      );
      el.classList.toggle("is-mine", isOnlineTeam() && state.online.mySeat === seat);
      el.classList.toggle("is-x", info.mark === "X");
      el.classList.toggle("is-o", info.mark === "O");
    });
  }

  function levelModeLabel(mode) {
    if (mode === "ai") return t("levelModeAi");
    if (mode === "team") return t("levelModeTeam");
    return t("levelModeLocal");
  }

  function diffLabel(diff) {
    return t(DIFF_KEYS[diff] || "diffMedium");
  }

  function getBoardDifficulty(level) {
    return state.difficulties[level] || "easy";
  }

  function turnSeconds(diff) {
    return TURN_SECONDS[diff] || TURN_SECONDS.medium;
  }

  function stopTimer() {
    if (state.timer.id) {
      clearInterval(state.timer.id);
      state.timer.id = null;
    }
    state.timer.endsAt = 0;
    state.timer.paused = false;
  }

  function renderTimerUI(remainingMs, totalMs, paused) {
    const wrap = $("#turn-timer");
    const fill = $("#timer-fill");
    const label = $("#timer-label");
    if (!wrap || !fill || !label) return;

    wrap.classList.remove("is-hidden");
    const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
    fill.style.width = `${ratio * 100}%`;
    const secs = Math.max(0, Math.ceil(remainingMs / 1000));
    label.textContent = t("timeLeft", { n: secs });
    wrap.classList.toggle("is-urgent", secs <= 5 && !paused);
    wrap.classList.toggle("is-paused", !!paused);
  }

  function hideTimer() {
    stopTimer();
    const wrap = $("#turn-timer");
    if (wrap) wrap.classList.add("is-hidden");
  }

  function onTurnTimeout() {
    const g = state.game;
    if (!g || g.over) return;

    if (state.mode === "ai" && g.current === "O") return;

    if (state.mode === "online") {
      if (isOnlineTeam()) {
        if (state.online.mySeat !== state.teamSeat && Online.role !== "host") return;
      } else if (g.current !== state.online.myMark && Online.role !== "host") {
        return;
      }
      const loser = g.current;
      Online.send({ type: "timeout", loser });
      applyTimeoutLoss(loser);
      return;
    }

    applyTimeoutLoss(g.current);
  }

  function applyTimeoutLoss(loserMark) {
    const g = state.game;
    if (!g || g.over) return;
    stopTimer();
    const winner = loserMark === "X" ? "O" : "X";
    g.over = true;
    g.winner = winner;
    g.winningLine = null;
    state.lastResultReason = "timeout";
    renderBoard();
    updateTurn();
    finishRound();
  }

  function startTurnTimer() {
    stopTimer();
    const g = state.game;
    if (!g || g.over) {
      hideTimer();
      return;
    }

    // Pause visual timer while AI thinks
    if (state.mode === "ai" && g.current === "O") {
      const totalMs = turnSeconds(state.difficulty) * 1000;
      state.timer.totalMs = totalMs;
      state.timer.paused = true;
      renderTimerUI(totalMs, totalMs, true);
      return;
    }

    const totalMs = turnSeconds(state.difficulty) * 1000;
    state.timer.totalMs = totalMs;
    state.timer.endsAt = Date.now() + totalMs;
    state.timer.paused = false;
    renderTimerUI(totalMs, totalMs, false);

    state.timer.id = setInterval(() => {
      const left = state.timer.endsAt - Date.now();
      if (left <= 0) {
        stopTimer();
        renderTimerUI(0, state.timer.totalMs, false);
        onTurnTimeout();
        return;
      }
      renderTimerUI(left, state.timer.totalMs, false);
    }, 100);
  }

  function setBoardDifficulty(level, diff) {
    state.difficulties[level] = diff;
    const row = document.querySelector(`[data-diff-for="${level}"]`);
    if (!row) return;
    row.querySelectorAll(".diff-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-diff") === diff);
    });
  }

  function stopDemo() {
    if (state.demoTimer) {
      clearTimeout(state.demoTimer);
      state.demoTimer = null;
    }
  }

  function demoStepsHtml(level) {
    const keys = DEMO_COPY[level] || DEMO_COPY[1];
    const badges = [t("demoPlay"), t("demoWin"), t("demoLose")];
    return keys
      .map(
        (key, i) =>
          `<div class="howto-step" data-step="${i}">
            <span class="howto-step__badge">${badges[i]}</span>
            <p class="howto-step__text">${t(key)}</p>
          </div>`
      )
      .join("");
  }

  function setActiveStep(root, index) {
    if (!root) return;
    root.querySelectorAll(".howto-step").forEach((el, i) => {
      el.classList.toggle("is-active", i === index);
    });
  }

  function buildFlatDemo(size) {
    const grid = document.createElement("div");
    grid.className = `howto-demo__grid howto-demo__grid--${size === 5 ? "5" : "3"}`;
    for (let i = 0; i < size * size; i++) {
      const cell = document.createElement("div");
      cell.className = "demo-cell";
      cell.dataset.i = String(i);
      grid.appendChild(cell);
    }
    return grid;
  }

  function buildQuadDemo() {
    const wrap = document.createElement("div");
    wrap.className = "demo-quad-wrap";

    const grid = document.createElement("div");
    grid.className = "howto-demo__grid howto-demo__grid--quad";
    for (let i = 0; i < 36; i++) {
      const cell = document.createElement("div");
      cell.className = "demo-cell";
      cell.dataset.i = String(i);
      const map = QUAD.globalToLocal[i];
      if (map) cell.dataset.q = String(map.q);
      grid.appendChild(cell);
    }

    const side = document.createElement("div");
    side.className = "demo-quad-side";
    side.innerHTML = `
      <div class="demo-meta">
        <p class="demo-meta__label">${t("demo3MetaHint")}</p>
        <div class="demo-meta__grid">
          <span class="demo-meta__cell peach" data-q="0"><span></span></span>
          <span class="demo-meta__cell green" data-q="1"><span></span></span>
          <span class="demo-meta__cell blue" data-q="2"><span></span></span>
          <span class="demo-meta__cell yellow" data-q="3"><span></span></span>
        </div>
      </div>
      <p class="demo-caption"></p>
    `;

    wrap.appendChild(grid);
    wrap.appendChild(side);
    return wrap;
  }

  function paintDemo(root, marks, winSet, claimBoards, owners, captionKey) {
    root.querySelectorAll(".demo-cell").forEach((cell) => {
      const i = Number(cell.dataset.i);
      cell.classList.remove("is-x", "is-o", "is-win", "is-board-claim");
      void cell.offsetWidth;
      const mark = marks[i];
      if (mark === "X") cell.classList.add("is-x");
      if (mark === "O") cell.classList.add("is-o");
      if (winSet && winSet.has(i)) cell.classList.add("is-win");
      if (claimBoards && cell.dataset.q != null && claimBoards.has(Number(cell.dataset.q))) {
        cell.classList.add("is-board-claim");
      }
    });

    root.querySelectorAll(".demo-meta__cell").forEach((cell) => {
      const q = Number(cell.dataset.q);
      cell.classList.remove("is-x", "is-o", "is-link");
      const owner = owners && owners[q];
      const markEl = cell.querySelector("span");
      if (markEl) markEl.textContent = owner || "";
      if (owner === "X") cell.classList.add("is-x");
      if (owner === "O") cell.classList.add("is-o");
      if (claimBoards && claimBoards.has(q) && claimBoards.size >= 2) {
        cell.classList.add("is-link");
      }
    });

    const caption = root.querySelector(".demo-caption");
    if (caption) {
      caption.textContent = captionKey ? t(captionKey) : "";
      caption.classList.toggle("is-on", !!captionKey);
    }
  }

  function classicFrames() {
    return [
      { step: 0, marks: {}, delay: 900 },
      { step: 0, marks: { 0: "X" }, delay: 900 },
      { step: 0, marks: { 0: "X", 1: "O" }, delay: 900 },
      { step: 0, marks: { 0: "X", 1: "O", 4: "X" }, delay: 900 },
      { step: 0, marks: { 0: "X", 1: "O", 4: "X", 2: "O" }, delay: 900 },
      { step: 1, marks: { 0: "X", 1: "O", 4: "X", 2: "O", 8: "X" }, win: [0, 4, 8], delay: 2800 },
      { step: 2, marks: { 0: "O", 1: "X", 3: "O", 4: "X", 6: "O" }, win: [0, 3, 6], delay: 2800 },
    ];
  }

  function wideFrames() {
    // 5x5 indices: row-major. Win on top row 0,1,2,3
    return [
      { step: 0, marks: {}, delay: 900 },
      { step: 0, marks: { 0: "X" }, delay: 800 },
      { step: 0, marks: { 0: "X", 10: "O" }, delay: 800 },
      { step: 0, marks: { 0: "X", 10: "O", 1: "X" }, delay: 800 },
      { step: 0, marks: { 0: "X", 10: "O", 1: "X", 12: "O" }, delay: 800 },
      { step: 0, marks: { 0: "X", 10: "O", 1: "X", 12: "O", 2: "X" }, delay: 800 },
      { step: 0, marks: { 0: "X", 10: "O", 1: "X", 12: "O", 2: "X", 14: "O" }, delay: 800 },
      {
        step: 1,
        marks: { 0: "X", 10: "O", 1: "X", 12: "O", 2: "X", 14: "O", 3: "X" },
        win: [0, 1, 2, 3],
        delay: 2800,
      },
      {
        step: 2,
        marks: { 3: "O", 8: "O", 13: "O", 18: "O", 0: "X", 1: "X", 2: "X" },
        win: [3, 8, 13, 18],
        delay: 2800,
      },
    ];
  }

  function quadFrames() {
    const g = (q, local) => QUAD.localToGlobal[q][local];
    return [
      { step: 0, marks: {}, owners: {}, delay: 1000 },
      { step: 0, marks: { [g(0, 0)]: "X" }, owners: {}, delay: 850 },
      { step: 0, marks: { [g(0, 0)]: "X", [g(1, 1)]: "O" }, owners: {}, delay: 850 },
      {
        step: 0,
        marks: { [g(0, 0)]: "X", [g(1, 1)]: "O", [g(0, 4)]: "X" },
        owners: {},
        delay: 850,
      },
      {
        step: 0,
        marks: { [g(0, 0)]: "X", [g(1, 1)]: "O", [g(0, 4)]: "X", [g(2, 4)]: "O" },
        owners: {},
        delay: 850,
      },
      {
        step: 1,
        marks: {
          [g(0, 0)]: "X",
          [g(1, 1)]: "O",
          [g(0, 4)]: "X",
          [g(2, 4)]: "O",
          [g(0, 8)]: "X",
        },
        win: [g(0, 0), g(0, 4), g(0, 8)],
        claim: [0],
        owners: { 0: "X" },
        caption: "demo3Caption1",
        delay: 3200,
      },
      {
        step: 1,
        marks: {
          [g(0, 0)]: "X",
          [g(0, 4)]: "X",
          [g(0, 8)]: "X",
          [g(1, 0)]: "X",
          [g(1, 4)]: "X",
          [g(1, 8)]: "X",
          [g(2, 4)]: "O",
          [g(3, 4)]: "O",
        },
        win: [g(1, 0), g(1, 4), g(1, 8)],
        claim: [0, 1],
        owners: { 0: "X", 1: "X" },
        caption: "demo3Caption2",
        delay: 4000,
      },
      {
        step: 2,
        marks: {
          [g(2, 0)]: "O",
          [g(2, 4)]: "O",
          [g(2, 8)]: "O",
          [g(0, 4)]: "X",
          [g(1, 4)]: "X",
        },
        win: [g(2, 0), g(2, 4), g(2, 8)],
        claim: [2],
        owners: { 2: "O" },
        caption: "demo3Caption3",
        delay: 3500,
      },
    ];
  }

  function getDemoFrames(level) {
    if (level === 2) return wideFrames();
    if (level === 3) return quadFrames();
    return classicFrames();
  }

  function mountDemo(level, demoEl, stepsEl) {
    stopDemo();
    demoEl.innerHTML = "";
    demoEl.dataset.level = String(level);
    const board = level === 3 ? buildQuadDemo() : buildFlatDemo(level === 2 ? 5 : 3);
    demoEl.appendChild(board);
    stepsEl.innerHTML = demoStepsHtml(level);

    const frames = getDemoFrames(level);
    let i = 0;

    function tick() {
      const frame = frames[i];
      setActiveStep(stepsEl, frame.step);
      paintDemo(
        board,
        frame.marks,
        frame.win ? new Set(frame.win) : null,
        frame.claim ? new Set(frame.claim) : null,
        frame.owners || null,
        frame.caption || null
      );
      i = (i + 1) % frames.length;
      state.demoTimer = setTimeout(tick, frame.delay);
    }

    tick();
  }

  function showHowto(level, difficulty) {
    state.pendingMatch = { level, difficulty };
    state.level = level;
    state.difficulty = difficulty;
    $("#howto-title").textContent = levelName(level);
    showScreen("howto");
    mountDemo(level, $("#howto-demo"), $("#howto-steps"));
  }

  function openTips(level) {
    $("#tips-title").textContent = levelName(level);
    mountDemo(level, $("#tips-demo"), $("#tips-steps"));
    $("#tips-overlay").classList.remove("is-hidden");
  }

  function beginPendingMatch() {
    stopDemo();
    const pending = state.pendingMatch;
    if (!pending) return;
    startMatch(state.mode, pending.level, { difficulty: pending.difficulty });
    state.pendingMatch = null;
  }

  function refreshDynamicLabels() {
    updateDiffButtonLabels();
    const timeHint = $("#online-time-hint");
    if (timeHint) timeHint.textContent = t("timeHint");
    if (screens.online && screens.online.classList.contains("is-active")) {
      updateOnlineFormatHint();
    }
    if (state.mode === "ai" || state.mode === "local" || state.mode === "team") {
      $("#level-mode-label").textContent = levelModeLabel(state.mode);
    }
    if (screens.howto && screens.howto.classList.contains("is-active") && state.pendingMatch) {
      $("#howto-title").textContent = levelName(state.pendingMatch.level);
      mountDemo(state.pendingMatch.level, $("#howto-demo"), $("#howto-steps"));
    }
    if (!$("#tips-overlay").classList.contains("is-hidden")) {
      openTips(state.level || 1);
    }
    if (screens.game.classList.contains("is-active") && state.game) {
      $("#game-mode-label").textContent =
        state.mode === "online" && state.online.format === "team"
          ? `${t("modeLabelOnline")} · ${t("modeLabelTeam")}`
          : modeLabel(state.mode);
      $("#game-level-label").textContent = t("levelChip", {
        n: state.level,
        name: levelName(state.level),
      });
      const diffChip = $("#game-diff-label");
      diffChip.textContent = `${diffLabel(state.difficulty)} · ${t("timePerMove", {
        n: turnSeconds(state.difficulty),
      })}`;
      diffChip.classList.remove("is-hidden");
      updateTurn();
      renderTeamRoster();
      if (!$("#result-overlay").classList.contains("is-hidden")) {
        finishRound(true);
      }
    }
  }

  function updateDiffButtonLabels() {
    document.querySelectorAll(".diff-btn").forEach((btn) => {
      const diff = btn.getAttribute("data-diff");
      const base = diffLabel(diff);
      btn.textContent = `${base} · ${turnSeconds(diff)}s`;
    });
  }

  function showScreen(name) {
    if (name !== "howto") stopDemo();
    if (name !== "game") hideTimer();
    Object.values(screens).forEach((el) => {
      if (el) el.classList.remove("is-active");
    });
    screens[name].classList.add("is-active");
    $("#result-overlay").classList.add("is-hidden");
    if (name !== "game") $("#tips-overlay").classList.add("is-hidden");
  }

  function setStatus(msg) {
    const el = $("#online-status");
    if (el) el.textContent = msg || "";
  }

  /* ---------- Language ---------- */

  document.querySelectorAll("[data-lang]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(btn.getAttribute("data-lang"));
    });
  });

  window.onLanguageChange = () => {
    refreshDynamicLabels();
  };

  /* ---------- Navigation ---------- */

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-mode");
      state.mode = mode;
      if (mode === "online") {
        Online.destroy();
        state.online.connected = false;
        state.online.guestOrder = [];
        state.online.mySeat = null;
        $("#host-code-box").classList.add("is-hidden");
        setStatus("");
        const hint = $("#online-time-hint");
        if (hint) hint.textContent = t("timeHint");
        updateOnlineFormatHint();
        showScreen("online");
      } else {
        $("#level-mode-label").textContent = levelModeLabel(mode);
        showScreen("levels");
      }
    });
  });

  document.querySelectorAll("[data-back]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-back");
      if (target === "home") {
        Online.destroy();
        showScreen("home");
      } else if (target === "levels") {
        stopDemo();
        state.pendingMatch = null;
        showScreen("levels");
      } else if (target === "exit-game") {
        exitGame();
      }
    });
  });

  document.querySelectorAll("[data-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const level = Number(btn.getAttribute("data-level"));
      showHowto(level, getBoardDifficulty(level));
    });
  });

  document.querySelectorAll(".diff-row").forEach((row) => {
    const levelKey = row.getAttribute("data-diff-for");
    const level = levelKey === "online" ? "online" : Number(levelKey);
    row.querySelectorAll(".diff-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setBoardDifficulty(level, btn.getAttribute("data-diff"));
        updateDiffButtonLabels();
        if (level === "online") {
          state.difficulty = btn.getAttribute("data-diff");
        }
      });
    });
  });

  document.querySelectorAll("[data-host-level]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-host-level]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.online.hostLevel = Number(btn.getAttribute("data-host-level"));
    });
  });

  document.querySelectorAll("[data-online-format]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-online-format]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.online.format = btn.getAttribute("data-online-format") === "team" ? "team" : "duel";
      updateOnlineFormatHint();
    });
  });

  $("#btn-howto-start").addEventListener("click", beginPendingMatch);
  $("#btn-howto-skip").addEventListener("click", beginPendingMatch);

  $("#btn-tips").addEventListener("click", () => {
    openTips(state.level || 1);
  });

  $("#btn-tips-close").addEventListener("click", () => {
    stopDemo();
    $("#tips-overlay").classList.add("is-hidden");
  });

  $("#tips-overlay").addEventListener("click", (e) => {
    if (e.target.id === "tips-overlay") {
      stopDemo();
      $("#tips-overlay").classList.add("is-hidden");
    }
  });

  $("#btn-restart").addEventListener("click", () => {
    if (state.mode === "online") {
      if (Online.role === "host") {
        resetRound(true);
        Online.send({ type: "restart", level: state.level });
      }
      return;
    }
    resetRound(false);
  });

  $("#btn-again").addEventListener("click", () => {
    if (state.mode === "online") {
      if (Online.role === "host") {
        resetRound(true);
        Online.send({ type: "restart", level: state.level });
      }
      return;
    }
    resetRound(false);
  });

  $("#btn-menu").addEventListener("click", () => {
    exitGame();
  });

  function exitGame() {
    hideTimer();
    Online.destroy();
    state.game = null;
    state.aiThinking = false;
    state.online.connected = false;
    showScreen("home");
  }

  /* ---------- Online lobby ---------- */

  function beginOnlineMatchAsHost() {
    const level = state.online.hostLevel;
    const difficulty = getBoardDifficulty("online");
    const format = state.online.format;

    if (format === "team") {
      const seats = [
        { peerId: "host", seat: 0, mark: "X" },
        ...state.online.guestOrder.map((peerId, i) => ({
          peerId,
          seat: i + 1,
          mark: TEAM_SEATS[i + 1].mark,
        })),
      ];
      seats.forEach((s) => {
        if (s.peerId === "host") return;
        Online.sendTo(s.peerId, {
          type: "start",
          level,
          difficulty,
          format: "team",
          seat: s.seat,
          mark: s.mark,
        });
      });
      state.online.mySeat = 0;
      state.online.myMark = "X";
      startMatch("online", level, {
        myMark: "X",
        mySeat: 0,
        format: "team",
        difficulty,
      });
      return;
    }

    Online.send({
      type: "start",
      level,
      difficulty,
      format: "duel",
      hostMark: "X",
      guestMark: "O",
    });
    state.online.myMark = "X";
    state.online.mySeat = null;
    startMatch("online", level, { myMark: "X", format: "duel", difficulty });
  }

  $("#btn-host").addEventListener("click", () => {
    setStatus(t("creatingRoom"));
    state.online.guestOrder = [];
    const maxGuests = state.online.format === "team" ? 3 : 1;

    Online.setHandlers({
      onPeerJoined: ({ peerId, guestCount }) => {
        if (!state.online.guestOrder.includes(peerId)) {
          state.online.guestOrder.push(peerId);
        }
        state.online.connected = true;
        updateOnlinePlayersLabel();
        setStatus(
          t("playerJoined", {
            n: 1 + guestCount,
            need: onlineNeededPlayers(),
          })
        );
        if (guestCount >= maxGuests) {
          beginOnlineMatchAsHost();
        }
      },
      onConnected: () => {
        /* peer join handled in onPeerJoined */
      },
      onMessage: handleOnlineMessage,
      onPeerLeft: () => {
        updateOnlinePlayersLabel();
      },
      onDisconnect: () => {
        setStatus(t("opponentDisconnected"));
        state.online.connected = false;
      },
      onError: (err) => {
        setStatus(onlineErrorText(err));
      },
    });

    Online.host(
      null,
      ({ code }) => {
        $("#host-code-box").classList.remove("is-hidden");
        $("#host-code").textContent = code;
        updateOnlinePlayersLabel();
        setStatus(t("shareCode"));
      },
      { maxGuests }
    );
  });

  $("#btn-join").addEventListener("click", () => {
    const code = $("#join-code").value.trim().toUpperCase();
    if (code.length < 4) {
      setStatus(t("enterValidCode"));
      return;
    }
    setStatus(t("connecting"));
    Online.setHandlers({
      onConnected: () => {
        state.online.connected = true;
        setStatus(t("connectedWaitingHost"));
      },
      onMessage: handleOnlineMessage,
      onDisconnect: () => {
        setStatus(t("disconnectedHost"));
        state.online.connected = false;
      },
      onError: (err) => {
        setStatus(onlineErrorText(err) || t("couldNotJoin"));
      },
    });
    Online.join(code, () => {
      setStatus(t("connectedWaitingStart"));
    });
  });

  function onlineErrorText(err) {
    if (!err) return t("connectionError");
    if (err.code === "ROOM_UNREACHABLE") return t("roomUnreachable");
    return err.message || t("connectionError");
  }

  function applyRemoteMove(index) {
    if (!state.game || state.game.over) return;
    if (state.game.cells[index]) return;
    const next = applyMove(state.game, index);
    if (!next) return;
    state.game = next;
    if ((state.mode === "team" || isOnlineTeam()) && !next.over) {
      advanceTeamSeat();
    }
    renderBoard();
    updateTurn();
    if (next.over) finishRound();
    else startTurnTimer();
  }

  function handleOnlineMessage(msg, fromPeerId) {
    if (!msg || !msg.type) return;

    if (msg.type === "room-full") {
      setStatus(t("roomFull"));
      Online.destroy();
      return;
    }

    if (msg.type === "start") {
      const format = msg.format || "duel";
      state.online.format = format;
      if (format === "team") {
        state.online.mySeat = msg.seat;
        state.online.myMark = msg.mark;
        startMatch("online", msg.level, {
          myMark: msg.mark,
          mySeat: msg.seat,
          format: "team",
          difficulty: msg.difficulty || "medium",
        });
      } else {
        state.online.myMark = msg.guestMark;
        state.online.mySeat = null;
        startMatch("online", msg.level, {
          myMark: msg.guestMark,
          format: "duel",
          difficulty: msg.difficulty || "medium",
        });
      }
      return;
    }

    if (msg.type === "move") {
      applyRemoteMove(msg.index);
      if (Online.role === "host" && fromPeerId) {
        Online.send({ type: "move", index: msg.index }, fromPeerId);
      }
      return;
    }

    if (msg.type === "timeout") {
      if (!state.game || state.game.over) return;
      applyTimeoutLoss(msg.loser);
      if (Online.role === "host" && fromPeerId) {
        Online.send({ type: "timeout", loser: msg.loser }, fromPeerId);
      }
      return;
    }

    if (msg.type === "restart") {
      state.level = msg.level || state.level;
      if (msg.difficulty) state.difficulty = msg.difficulty;
      if (msg.format) state.online.format = msg.format;
      resetRound(false);
      if (Online.role === "host" && fromPeerId) {
        Online.send(msg, fromPeerId);
      }
      return;
    }

    if (msg.type === "score") {
      state.scores = msg.scores;
      renderScores();
      if (Online.role === "host" && fromPeerId) {
        Online.send(msg, fromPeerId);
      }
    }
  }

  /* ---------- Match lifecycle ---------- */

  function startMatch(mode, level, opts = {}) {
    state.mode = mode;
    state.level = level;
    state.difficulty =
      opts.difficulty ||
      (mode === "online" ? getBoardDifficulty("online") : getBoardDifficulty(level)) ||
      "medium";
    state.scores = { X: 0, O: 0 };
    state.lastResultReason = null;
    resetTeamSeat();
    if (opts.myMark) state.online.myMark = opts.myMark;
    if (opts.mySeat != null) state.online.mySeat = opts.mySeat;
    if (opts.format) state.online.format = opts.format;

    $("#game-mode-label").textContent =
      mode === "online" && state.online.format === "team"
        ? `${t("modeLabelOnline")} · ${t("modeLabelTeam")}`
        : modeLabel(mode);
    $("#game-level-label").textContent = t("levelChip", {
      n: level,
      name: levelName(level),
    });

    const diffChip = $("#game-diff-label");
    diffChip.textContent = `${diffLabel(state.difficulty)} · ${t("timePerMove", {
      n: turnSeconds(state.difficulty),
    })}`;
    diffChip.classList.remove("is-hidden");

    showScreen("game");
    resetRound(false);
  }

  function resetRound(syncOnline) {
    hideTimer();
    state.game = createState(state.level);
    state.aiThinking = false;
    state.lastResultReason = null;
    resetTeamSeat();
    $("#result-overlay").classList.add("is-hidden");
    renderBoard();
    renderScores();
    renderTeamRoster();
    updateTurn();
    startTurnTimer();

    if (syncOnline && state.mode === "online" && Online.role === "host") {
      Online.send({
        type: "restart",
        level: state.level,
        difficulty: state.difficulty,
        format: state.online.format,
      });
    }

    maybeAiMove();
  }

  function finishRound(relabelOnly) {
    const g = state.game;
    if (!g || !g.over) return;

    if (!relabelOnly) {
      hideTimer();
      if (g.winner === "X" || g.winner === "O") {
        state.scores[g.winner] += 1;
        renderScores();
        if (state.mode === "online" && Online.role === "host") {
          Online.send({ type: "score", scores: state.scores });
        }
      }
    }

    const title = $("#result-title");
    const eyebrow = $("#result-eyebrow");
    const timedOut = state.lastResultReason === "timeout";
    eyebrow.textContent = timedOut ? t("timedOut") : t("roundOver");

    if (g.winner === "draw") {
      title.textContent = t("itsDraw");
    } else if (timedOut) {
      if (state.mode === "ai") {
        title.textContent = g.winner === "X" ? t("youWin") : t("youTimedOut");
      } else if (state.mode === "online") {
        if (isOnlineTeam()) {
          title.textContent = t("teamWins", {
            team: t(g.winner === "X" ? "teamX" : "teamO"),
          });
        } else {
          title.textContent =
            g.winner === state.online.myMark ? t("opponentTimedOut") : t("youTimedOut");
        }
      } else if (state.mode === "team") {
        title.textContent = t("teamWins", {
          team: t(g.winner === "X" ? "teamX" : "teamO"),
        });
      } else {
        title.textContent = t("markWins", { mark: g.winner });
      }
    } else if (state.mode === "ai") {
      title.textContent = g.winner === "X" ? t("youWin") : t("computerWins");
    } else if (state.mode === "online") {
      if (isOnlineTeam()) {
        title.textContent = t("teamWins", {
          team: t(g.winner === "X" ? "teamX" : "teamO"),
        });
      } else {
        title.textContent =
          g.winner === state.online.myMark ? t("youWin") : t("opponentWins");
      }
    } else if (state.mode === "team") {
      title.textContent = t("teamWins", {
        team: t(g.winner === "X" ? "teamX" : "teamO"),
      });
    } else {
      title.textContent = t("markWins", { mark: g.winner });
    }

    renderTeamRoster();
    $("#result-overlay").classList.remove("is-hidden");

    if (state.mode === "online" && Online.role !== "host") {
      $("#btn-again").textContent = t("waitingHost");
      $("#btn-again").disabled = true;
    } else {
      $("#btn-again").textContent = t("playAgain");
      $("#btn-again").disabled = false;
    }
  }

  /* ---------- Rendering ---------- */

  function renderScores() {
    $("#score-x").textContent = state.scores.X;
    $("#score-o").textContent = state.scores.O;
  }

  function updateTurn() {
    const banner = $("#turn-text");
    const g = state.game;
    if (!g) return;

    if (g.over) {
      if (state.lastResultReason === "timeout") {
        banner.textContent = t("timedOut");
      } else {
        banner.textContent =
          g.winner === "draw" ? t("draw") : t("markWins", { mark: g.winner });
      }
      return;
    }

    if (state.mode === "ai") {
      banner.textContent =
        g.current === "X" ? t("yourTurnMark", { mark: "X" }) : t("computerThinking");
    } else if (state.mode === "online") {
      if (isOnlineTeam()) {
        const seat = currentTeamSeat();
        if (state.online.mySeat === state.teamSeat) {
          banner.textContent = t("yourTeamTurn", {
            seat: t(seat.seatKey),
            mark: seat.mark,
          });
        } else {
          banner.textContent = t("teamTurn", {
            seat: t(seat.seatKey),
            mark: seat.mark,
            team: t(seat.teamKey),
          });
        }
      } else {
        const mine = state.online.myMark;
        banner.textContent =
          g.current === mine
            ? t("yourTurnMark", { mark: mine })
            : t("opponentTurn", { mark: g.current });
      }
    } else if (state.mode === "team") {
      const seat = currentTeamSeat();
      banner.textContent = t("teamTurn", {
        seat: t(seat.seatKey),
        mark: seat.mark,
        team: t(seat.teamKey),
      });
    } else {
      banner.textContent = t("markTurn", { mark: g.current });
    }

    renderTeamRoster();
  }

  function quadrantOf(globalIndex) {
    const map = QUAD.globalToLocal[globalIndex];
    return map ? map.q : 0;
  }

  function renderBoard() {
    const g = state.game;
    const board = $("#board");
    board.innerHTML = "";
    board.className = `board board--l${g.level}`;

    const moves = new Set(legalMoves(g));
    const winSet = new Set(g.winningLine || []);

    const wonBoards = new Set();
    if (g.kind === "quad" && g.winningBoards) {
      g.winningBoards.forEach((q) => wonBoards.add(q));
    }

    const total = g.cells.length;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      cell.dataset.index = String(i);

      if (g.kind === "quad") {
        const q = quadrantOf(i);
        cell.dataset.q = String(q);
        if (g.activeQuad !== null) {
          if (q === g.activeQuad) cell.classList.add("is-active-q");
          else if (!g.boards[q] && moves.size && !moves.has(i)) cell.classList.add("is-dim");
        }
        if (g.boards[q] === "X") cell.classList.add("is-board-won-x");
        if (g.boards[q] === "O") cell.classList.add("is-board-won-o");
        if (wonBoards.has(q)) cell.classList.add("is-win");
      }

      if (g.cells[i]) {
        cell.dataset.mark = g.cells[i];
        cell.classList.add("is-filled");
        cell.disabled = true;
      } else {
        cell.disabled = g.over || !moves.has(i) || !canLocalPlayerMove();
      }

      if (winSet.has(i)) cell.classList.add("is-win");

      cell.addEventListener("click", () => onCellClick(i));
      board.appendChild(cell);
    }
  }

  function canLocalPlayerMove() {
    if (state.aiThinking) return false;
    const g = state.game;
    if (!g || g.over) return false;
    if (state.mode === "ai") return g.current === "X";
    if (state.mode === "online") {
      if (isOnlineTeam()) {
        return state.online.mySeat === state.teamSeat && g.current === currentTeamSeat().mark;
      }
      return g.current === state.online.myMark;
    }
    return true;
  }

  function onCellClick(index) {
    const g = state.game;
    if (!g || g.over || state.aiThinking) return;
    if (!canLocalPlayerMove()) return;
    if (!legalMoves(g).includes(index)) return;

    const next = applyMove(g, index);
    if (!next) return;
    state.game = next;
    stopTimer();

    if ((state.mode === "team" || isOnlineTeam()) && !next.over) {
      advanceTeamSeat();
    }

    renderBoard();
    updateTurn();

    if (state.mode === "online") {
      Online.send({ type: "move", index });
    }

    if (next.over) {
      finishRound();
      return;
    }

    startTurnTimer();
    maybeAiMove();
  }

  function maybeAiMove() {
    if (state.mode !== "ai") return;
    const g = state.game;
    if (!g || g.over || g.current !== "O") return;

    state.aiThinking = true;
    updateTurn();
    startTurnTimer();
    renderBoard();

    const delay = 280 + Math.random() * 420;
    setTimeout(() => {
      if (!state.game || state.game.over) {
        state.aiThinking = false;
        return;
      }
      const move = pickAiMove(state.game, "O", state.difficulty);
      state.aiThinking = false;
      if (move == null) return;
      const next = applyMove(state.game, move);
      if (!next) return;
      state.game = next;
      renderBoard();
      updateTurn();
      if (next.over) finishRound();
      else startTurnTimer();
    }, delay);
  }

  // Boot
  applyDocument();
  updateDiffButtonLabels();
  const bootHint = $("#online-time-hint");
  if (bootHint) bootHint.textContent = t("timeHint");
  updateOnlineFormatHint();
})();
