/**
 * XO Fields — core board rules + AI
 * Level 1: 3×3, 3-in-a-row
 * Level 2: 5×5, 4-in-a-row
 * Level 3: 4 colored 3×3 boards (6×6). Win a mini-board, then claim 2 linked boards.
 */

const LEVELS = {
  1: { name: "Classic", size: 3, winLength: 3, kind: "flat" },
  2: { name: "Wide Field", size: 5, winLength: 4, kind: "flat" },
  3: { name: "Quad", size: 6, winLength: 3, kind: "quad" },
};

function buildQuadMaps() {
  const localToGlobal = [[], [], [], []];
  const globalToLocal = Array(36).fill(null);

  for (let q = 0; q < 4; q++) {
    const baseRow = q < 2 ? 0 : 3;
    const baseCol = q % 2 === 0 ? 0 : 3;
    for (let lr = 0; lr < 3; lr++) {
      for (let lc = 0; lc < 3; lc++) {
        const local = lr * 3 + lc;
        const global = (baseRow + lr) * 6 + (baseCol + lc);
        localToGlobal[q][local] = global;
        globalToLocal[global] = { q, local };
      }
    }
  }
  return { localToGlobal, globalToLocal };
}

const QUAD = buildQuadMaps();

const LINES_3 = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Meta wins on 2×2 of boards: any two adjacent (row, col, or both diagonals = 2 boards) */
const META_LINES = [
  [0, 1], // top row
  [2, 3], // bottom row
  [0, 2], // left col
  [1, 3], // right col
  [0, 3], // diagonal
  [1, 2], // anti-diagonal
];

function emptyFlatBoard(n) {
  return Array(n * n).fill(null);
}

function createState(level) {
  const cfg = LEVELS[level];
  if (cfg.kind === "flat") {
    return {
      level,
      kind: "flat",
      size: cfg.size,
      winLength: cfg.winLength,
      cells: emptyFlatBoard(cfg.size),
      current: "X",
      winner: null,
      winningLine: null,
      over: false,
    };
  }
  return {
    level: 3,
    kind: "quad",
    size: 6,
    cells: emptyFlatBoard(36),
    boards: [null, null, null, null], // winner of each mini-board
    activeQuad: null, // always free choice among unfinished boards
    current: "X",
    winner: null,
    winningLine: null,
    winningBoards: null,
    over: false,
  };
}

function idx(row, col, size) {
  return row * size + col;
}

function findFlatWin(cells, size, winLength) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const start = cells[idx(r, c, size)];
      if (!start) continue;
      for (const [dr, dc] of dirs) {
        const line = [idx(r, c, size)];
        let ok = true;
        for (let k = 1; k < winLength; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nc < 0 || nr >= size || nc >= size) {
            ok = false;
            break;
          }
          const i = idx(nr, nc, size);
          if (cells[i] !== start) {
            ok = false;
            break;
          }
          line.push(i);
        }
        if (ok) return { winner: start, line };
      }
    }
  }
  if (cells.every(Boolean)) return { winner: "draw", line: null };
  return null;
}

function miniBoardCells(state, q) {
  return QUAD.localToGlobal[q].map((g) => state.cells[g]);
}

function checkMiniWin(marks) {
  for (const line of LINES_3) {
    const [a, b, c] = line;
    if (marks[a] && marks[a] === marks[b] && marks[a] === marks[c]) {
      return { winner: marks[a], line };
    }
  }
  if (marks.every(Boolean)) return { winner: "draw", line: null };
  return null;
}

function checkMetaWin(boards) {
  for (const line of META_LINES) {
    const [a, b] = line;
    if (boards[a] && boards[a] !== "draw" && boards[a] === boards[b]) {
      return { winner: boards[a], boards: line };
    }
  }
  if (boards.every((b) => b !== null)) return { winner: "draw", boards: null };
  return null;
}

function cloneState(state) {
  return {
    ...state,
    cells: state.cells.slice(),
    boards: state.boards ? state.boards.slice() : undefined,
    winningLine: state.winningLine ? state.winningLine.slice() : null,
    winningBoards: state.winningBoards ? state.winningBoards.slice() : null,
  };
}

function legalMoves(state) {
  if (state.over) return [];
  if (state.kind === "flat") {
    return state.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  }
  const moves = [];
  for (let g = 0; g < 36; g++) {
    if (state.cells[g]) continue;
    const { q } = QUAD.globalToLocal[g];
    if (state.boards[q]) continue; // finished mini-board
    moves.push(g);
  }
  return moves;
}

function applyMove(state, cellIndex) {
  if (state.over || state.cells[cellIndex]) return null;
  const next = cloneState(state);

  if (next.kind === "flat") {
    next.cells[cellIndex] = next.current;
    const result = findFlatWin(next.cells, next.size, next.winLength);
    if (result) {
      next.over = true;
      next.winner = result.winner;
      next.winningLine = result.line;
    } else {
      next.current = next.current === "X" ? "O" : "X";
    }
    return next;
  }

  const map = QUAD.globalToLocal[cellIndex];
  if (!map) return null;
  const { q } = map;
  if (next.boards[q]) return null;
  if (!legalMoves(state).includes(cellIndex)) return null;

  next.cells[cellIndex] = next.current;

  if (!next.boards[q]) {
    const mini = checkMiniWin(miniBoardCells(next, q));
    if (mini) {
      next.boards[q] = mini.winner;
    }
  }

  const meta = checkMetaWin(next.boards);
  if (meta) {
    next.over = true;
    next.winner = meta.winner;
    next.winningBoards = meta.boards;
    return next;
  }

  // Drawn mini-boards still count as finished; if every board done without meta win → draw
  if (next.boards.every((b) => b !== null) && !meta) {
    next.over = true;
    next.winner = "draw";
    return next;
  }

  next.current = next.current === "X" ? "O" : "X";
  return next;
}

/* ---------- AI ---------- */

function scoreFlatWindow(cells, size, winLength, ai, human) {
  let score = 0;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      for (const [dr, dc] of dirs) {
        let aiCount = 0;
        let humanCount = 0;
        let blocked = false;
        for (let k = 0; k < winLength; k++) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nc < 0 || nr >= size || nc >= size) {
            blocked = true;
            break;
          }
          const v = cells[idx(nr, nc, size)];
          if (v === ai) aiCount++;
          else if (v === human) humanCount++;
        }
        if (blocked || (aiCount && humanCount)) continue;
        if (aiCount === winLength) score += 100000;
        else if (aiCount === winLength - 1) score += 5000;
        else if (aiCount === winLength - 2) score += 200;
        else if (aiCount > 0) score += aiCount * 10;
        if (humanCount === winLength - 1) score -= 8000;
        else if (humanCount === winLength - 2) score -= 300;
        else if (humanCount > 0) score -= humanCount * 12;
      }
    }
  }
  return score;
}

function minimaxFlat(state, depth, maximizing, ai, human, alpha, beta) {
  if (state.over) {
    if (state.winner === ai) return 100000 + depth;
    if (state.winner === human) return -100000 - depth;
    return 0;
  }
  if (depth === 0) {
    return scoreFlatWindow(state.cells, state.size, state.winLength, ai, human);
  }

  const moves = legalMoves(state);
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const child = applyMove(state, m);
      const val = minimaxFlat(child, depth - 1, false, ai, human, alpha, beta);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const child = applyMove(state, m);
    const val = minimaxFlat(child, depth - 1, true, ai, human, alpha, beta);
    best = Math.min(best, val);
    beta = Math.min(beta, val);
    if (beta <= alpha) break;
  }
  return best;
}

function evaluateQuad(state, ai, human) {
  let score = 0;
  for (let q = 0; q < 4; q++) {
    if (state.boards[q] === ai) score += 400;
    else if (state.boards[q] === human) score -= 450;
    else if (state.boards[q] === "draw") score += 0;
    else {
      const marks = miniBoardCells(state, q);
      for (const line of LINES_3) {
        const vals = line.map((i) => marks[i]);
        const a = vals.filter((v) => v === ai).length;
        const h = vals.filter((v) => v === human).length;
        if (a && h) continue;
        if (a === 2) score += 40;
        if (a === 1) score += 8;
        if (h === 2) score -= 50;
        if (h === 1) score -= 10;
      }
    }
  }
  for (const line of META_LINES) {
    const [a, b] = line;
    if (state.boards[a] === ai && state.boards[b] === ai) score += 10000;
    if (state.boards[a] === human && state.boards[b] === human) score -= 10000;
  }
  return score;
}

function minimaxQuad(state, depth, maximizing, ai, human, alpha, beta) {
  if (state.over) {
    if (state.winner === ai) return 100000 + depth;
    if (state.winner === human) return -100000 - depth;
    return 0;
  }
  if (depth === 0) return evaluateQuad(state, ai, human);

  const moves = legalMoves(state);
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const child = applyMove(state, m);
      if (!child) continue;
      const val = minimaxQuad(child, depth - 1, false, ai, human, alpha, beta);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best === -Infinity ? 0 : best;
  }
  let best = Infinity;
  for (const m of moves) {
    const child = applyMove(state, m);
    if (!child) continue;
    const val = minimaxQuad(child, depth - 1, true, ai, human, alpha, beta);
    best = Math.min(best, val);
    beta = Math.min(beta, val);
    if (beta <= alpha) break;
  }
  return best === Infinity ? 0 : best;
}

function pickAiMove(state, aiMark = "O", difficulty = "medium") {
  const human = aiMark === "X" ? "O" : "X";
  const moves = legalMoves(state);
  if (!moves.length) return null;

  const diff = ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium";

  function findWinningMove(mark) {
    for (const m of moves) {
      const probe = cloneState(state);
      probe.current = mark;
      const child = applyMove(probe, m);
      if (child && child.winner === mark) return m;
    }
    return null;
  }

  const winMove = findWinningMove(aiMark);
  const blockMove = findWinningMove(human);

  if (diff === "easy") {
    if (winMove && Math.random() < 0.4) return winMove;
    if (blockMove && Math.random() < 0.3) return blockMove;
    return moves[Math.floor(Math.random() * moves.length)];
  }

  // Medium & Hard: always take wins and blocks
  if (winMove) return winMove;
  if (blockMove) return blockMove;

  let depth;
  if (state.kind === "flat") {
    if (state.size === 3) {
      depth = diff === "hard" ? 9 : 3;
    } else {
      depth = diff === "hard" ? 4 : 2;
    }
  } else {
    depth = diff === "hard" ? 3 : 1;
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;
  const ordered = moves.slice().sort(() => Math.random() - 0.5);

  // Medium: sometimes pick a near-best move
  const scored = [];

  for (const m of ordered) {
    const child = applyMove(state, m);
    if (!child) continue;
    let score;
    if (state.kind === "flat") {
      score = minimaxFlat(child, depth, false, aiMark, human, -Infinity, Infinity);
    } else {
      score = minimaxQuad(child, depth, false, aiMark, human, -Infinity, Infinity);
    }
    scored.push({ m, score });
    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }

  if (diff === "medium" && scored.length > 1) {
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.min(3, scored.length));
    return top[Math.floor(Math.random() * top.length)].m;
  }

  return bestMove;
}

window.XOGame = {
  LEVELS,
  QUAD,
  createState,
  applyMove,
  legalMoves,
  pickAiMove,
  cloneState,
};
