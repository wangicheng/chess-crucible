// ── Board Component (Chessground Wrapper) ───────────────────────
import { Chessground } from 'chessground';
import { Chess } from 'chess.js';
import { createEvalBar } from './evalBar.js';

export function createBoard(container, options = {}) {
  const {
    interactive = false,
    orientation = 'white',
    showEvalBar = true,
  } = options;

  // ── DOM structure ──────────────────────────────────────────────
  const layout = document.createElement('div');
  layout.className = 'board-layout';

  let evalBarComponent = null;
  let evalBarContainer = null;

  if (showEvalBar) {
    evalBarContainer = document.createElement('div');
    evalBarContainer.className = 'eval-bar-container';
    layout.appendChild(evalBarContainer);
    evalBarComponent = createEvalBar(evalBarContainer, orientation);
  }

  const boardContainer = document.createElement('div');
  boardContainer.className = 'board-container';
  layout.appendChild(boardContainer);

  container.appendChild(layout);

  // ── Internal state ─────────────────────────────────────────────
  let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let currentOrientation = orientation;
  let moveCallback = null;
  const chess = new Chess();

  // ── Chessground config ─────────────────────────────────────────
  const config = {
    fen: currentFen,
    orientation: orientation,
    turnColor: 'white',
    movable: {
      free: false,
      color: interactive ? orientation : undefined,
      dests: interactive ? computeDests(currentFen) : new Map(),
      showDests: true,
      events: {
        after(orig, dest) {
          if (moveCallback) moveCallback(orig, dest);
        },
      },
    },
    draggable: {
      enabled: true,
      showGhost: true,
    },
    highlight: {
      lastMove: true,
      check: true,
    },
    animation: {
      enabled: true,
      duration: 200,
    },
    drawable: {
      enabled: true,
      visible: true,
    },
    premovable: {
      enabled: false,
    },
  };

  const ground = Chessground(boardContainer, config);

  // ── Fix interaction offset caused by CSS animations ────────────
  // The container may be animating (e.g., fadeInUp translateY) when
  // Chessground initializes, caching an incorrect bounding client rect.
  // We dispatch a resize event after the animation finishes to recalculate.
  setTimeout(() => {
    if (document.body.contains(boardContainer)) {
      window.dispatchEvent(new Event('resize'));
    }
  }, 450);

  // ── Compute legal destinations ─────────────────────────────────
  function computeDests(fen) {
    const dests = new Map();
    try {
      chess.load(fen);
      const moves = chess.moves({ verbose: true });
      for (const m of moves) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
      }
    } catch {
      // Invalid FEN — return empty dests
    }
    return dests;
  }

  // ── Determine turn color from FEN ──────────────────────────────
  function turnFromFen(fen) {
    const parts = fen.split(' ');
    return parts[1] === 'b' ? 'black' : 'white';
  }

  // ── API ────────────────────────────────────────────────────────
  function setPosition(fen, lastMove = null) {
    currentFen = fen;
    const turn = turnFromFen(fen);
    const cgConfig = {
      fen,
      turnColor: turn,
      check: false,
      lastMove: lastMove || null,
    };

    // Update movable dests if interactive
    const movableColor = ground.state.movable.color;
    if (movableColor) {
      cgConfig.movable = {
        dests: computeDests(fen),
        color: movableColor,
      };
    }

    // Check detection
    try {
      chess.load(fen);
      if (chess.inCheck()) {
        cgConfig.check = true;
      }
    } catch {
      // Ignore
    }

    ground.set(cgConfig);
  }

  function setInteractive(color) {
    if (color) {
      ground.set({
        movable: {
          free: false,
          color: color,
          dests: computeDests(currentFen),
          showDests: true,
        },
      });
    } else {
      ground.set({
        movable: {
          color: undefined,
          dests: new Map(),
        },
      });
    }
  }

  function setOrientation(color) {
    currentOrientation = color;
    ground.set({ orientation: color });
    if (evalBarComponent) evalBarComponent.setOrientation(color);
  }

  function showArrow(from, to, brush = 'green') {
    const current = ground.state.drawable.autoShapes || [];
    ground.setAutoShapes([
      ...current,
      { orig: from, dest: to, brush },
    ]);
  }

  function clearArrows() {
    ground.setAutoShapes([]);
  }

  function onMove(callback) {
    moveCallback = callback;
  }

  function getGround() {
    return ground;
  }

  function enableEvalBar() {
    if (evalBarComponent) return;
    evalBarContainer = document.createElement('div');
    evalBarContainer.className = 'eval-bar-container';
    layout.insertBefore(evalBarContainer, boardContainer);
    evalBarComponent = createEvalBar(evalBarContainer, currentOrientation);
  }

  function disableEvalBar() {
    if (!evalBarComponent) return;
    evalBarComponent.destroy();
    evalBarComponent = null;
    if (evalBarContainer) {
      evalBarContainer.remove();
      evalBarContainer = null;
    }
  }

  function destroy() {
    ground.destroy();
    if (evalBarComponent) evalBarComponent.destroy();
    layout.remove();
  }

  return {
    setPosition,
    setInteractive,
    setOrientation,
    showArrow,
    clearArrows,
    onMove,
    getGround,
    get evalBar() { return evalBarComponent; },
    enableEvalBar,
    disableEvalBar,
    destroy,
  };
}
