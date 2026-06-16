// ── Game Review Component ────────────────────────────────────────
import { store } from '../stores/gameStore.js';
import { stockfish } from '../services/stockfish.js';
import { analyzer } from '../services/analyzer.js';
import { formatDate, formatTimeControl, formatEval, evalToPercentage } from '../utils/format.js';
import { Chess } from 'chess.js';
import { createBoard } from './board.js';
import { createMoveList } from './moveList.js';

export function createGameReview(container) {
  const gameId = store.state.currentGameId;
  const games = store.state.games || [];
  const game = games.find(g => String(g.id) === String(gameId));

  // ── No game selected ──────────────────────────────────────────
  if (!game) {
    const empty = document.createElement('div');
    empty.className = 'empty-state animate-fadeIn';
    empty.id = 'review-empty';
    empty.innerHTML = `
      <div class="empty-state-icon">📋</div>
      <h2>No Game Selected</h2>
      <p>Select a game from the list to review it.</p>
      <a href="#games" class="btn btn-primary">← Back to Games</a>
    `;
    container.appendChild(empty);
    return { destroy() { empty.remove(); } };
  }

  // ── Parse PGN ──────────────────────────────────────────────────
  const chess = new Chess();
  try {
    chess.loadPgn(game.pgn);
  } catch (err) {
    console.error('[gameReview] PGN parse error', err);
  }

  const history = chess.history({ verbose: true });
  const positions = []; // FEN at each half-move index (0 = start)
  const chessNav = new Chess();
  positions.push(chessNav.fen());
  history.forEach(move => {
    chessNav.move(move.san);
    positions.push(chessNav.fen());
  });

  const playerColor = game.playerColor || 'white';

  // Get analysis from store (analysisResults is gameId -> moves[])
  const analysisData = store.state.analysisResults?.[game.id] || null;
  // analysisData could be the raw moves array, or an object with .moves
  const analysisMoves = Array.isArray(analysisData) ? analysisData
    : (analysisData?.moves || null);

  let currentMoveIndex = 0; // 0 = start position, 1 = after first move, etc.
  let destroyed = false;
  const unsubs = [];

  // ── Determine player names ─────────────────────────────────────
  // The normalized game has opponentName but not the original white/black names
  // We reconstruct them from playerColor + opponentName
  const whiteName = playerColor === 'white'
    ? (store.state.username || 'You')
    : game.opponentName;
  const blackName = playerColor === 'black'
    ? (store.state.username || 'You')
    : game.opponentName;
  const whiteRating = playerColor === 'white' ? game.playerRating : game.opponentRating;
  const blackRating = playerColor === 'black' ? game.playerRating : game.opponentRating;

  // ── Build layout ───────────────────────────────────────────────
  const section = document.createElement('section');
  section.className = 'game-review-view animate-fadeInUp';
  section.id = 'game-review-view';

  section.innerHTML = `
    <div class="review-layout">
      <div class="review-board-col">
        <div class="review-board-area" id="review-board-area"></div>
        <div class="nav-controls" id="review-nav-controls">
          <button class="btn btn-icon" id="review-nav-first" title="First move">⏮</button>
          <button class="btn btn-icon" id="review-nav-prev" title="Previous move">◀</button>
          <button class="btn btn-icon" id="review-nav-next" title="Next move">▶</button>
          <button class="btn btn-icon" id="review-nav-last" title="Last move">⏭</button>
        </div>
      </div>
      <div class="review-info-col">
        <div class="review-game-info card" id="review-game-info"></div>
        <div class="review-move-list-container" id="review-move-list-container"></div>
        <div class="review-actions" id="review-actions"></div>
      </div>
    </div>
  `;

  container.appendChild(section);

  // ── Board ──────────────────────────────────────────────────────
  const boardArea = section.querySelector('#review-board-area');
  const boardComponent = createBoard(boardArea, {
    interactive: false,
    orientation: playerColor,
    showEvalBar: !!analysisMoves,
  });

  // ── Move list ──────────────────────────────────────────────────
  const moveListContainer = section.querySelector('#review-move-list-container');
  const moveListComponent = createMoveList(moveListContainer);

  const movesData = history.map((m, i) => {
    const classification = analysisMoves?.[i]?.classification || null;
    return {
      san: m.san,
      color: m.color === 'w' ? 'white' : 'black',
      classification,
    };
  });
  moveListComponent.setMoves(movesData);

  moveListComponent.onMoveClick((index) => {
    goToMove(index + 1); // move index is 1-based in positions array
  });

  // ── Game info panel ────────────────────────────────────────────
  const resultBadgeClass = game.result === 'win' ? 'badge-win'
    : game.result === 'loss' ? 'badge-loss' : 'badge-draw';
  const resultText = game.result === 'win' ? 'Win'
    : game.result === 'loss' ? 'Loss' : 'Draw';

  const gameInfo = section.querySelector('#review-game-info');
  gameInfo.innerHTML = `
    <div class="review-info-row">
      <span class="review-info-label">♔ White</span>
      <span class="review-info-value">${escapeHtml(whiteName)} (${whiteRating})</span>
    </div>
    <div class="review-info-row">
      <span class="review-info-label">♚ Black</span>
      <span class="review-info-value">${escapeHtml(blackName)} (${blackRating})</span>
    </div>
    <div class="review-info-row">
      <span class="review-info-label">Result</span>
      <span class="badge ${resultBadgeClass}">${resultText}</span>
    </div>
    <div class="review-info-row">
      <span class="review-info-label">Time Control</span>
      <span class="review-info-value">${formatTimeControl(game.timeClass)}</span>
    </div>
    <div class="review-info-row">
      <span class="review-info-label">Date</span>
      <span class="review-info-value">${formatDate(game.date)}</span>
    </div>
    ${game.url ? `<a href="${escapeHtml(game.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" id="review-chesscom-link">View on Chess.com ↗</a>` : ''}
  `;

  // ── Actions ────────────────────────────────────────────────────
  const actionsEl = section.querySelector('#review-actions');
  actionsEl.innerHTML = `
    <a href="#games" class="btn btn-secondary" id="review-back-btn">← Back to Games</a>
    ${!analysisMoves ? '<button class="btn btn-primary" id="review-analyze-btn">⚡ Analyze This Game</button>' : ''}
  `;

  // ── Analyze single game ────────────────────────────────────────
  const analyzeBtn = actionsEl.querySelector('#review-analyze-btn');
  if (analyzeBtn) {
    async function onAnalyze() {
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = 'Initializing engine…';

      try {
        await stockfish.init();
        analyzeBtn.textContent = 'Analyzing…';

        const result = await analyzer.analyzeGame(game.pgn, playerColor, 14, (progress) => {
          if (destroyed) return;
          analyzeBtn.textContent = `Analyzing… ${progress.movesAnalyzed}/${progress.totalMoves}`;
        });

        if (destroyed) return;

        // Save to store
        const newResults = { ...store.state.analysisResults, [game.id]: result };
        store.setState({ analysisResults: newResults });
        await store.saveAnalysis(game.id, result);

        // Reload view to show analysis
        store.setState({ currentView: 'review' });
      } catch (err) {
        if (!destroyed) {
          console.error('[gameReview] analysis error', err);
          analyzeBtn.textContent = 'Analysis failed – Retry';
          analyzeBtn.disabled = false;
        }
      }
    }
    analyzeBtn.addEventListener('click', onAnalyze);
  }

  // ── Navigation ─────────────────────────────────────────────────
  function goToMove(index) {
    if (index < 0) index = 0;
    if (index > positions.length - 1) index = positions.length - 1;
    currentMoveIndex = index;

    const fen = positions[index];
    const lastMove = index > 0 ? [history[index - 1].from, history[index - 1].to] : null;
    boardComponent.setPosition(fen, lastMove);

    // Update move list
    moveListComponent.setActiveIndex(index - 1); // -1 because move list is 0-indexed on moves
    moveListComponent.scrollToMove(index - 1);

    // Clear arrows
    boardComponent.clearArrows();

    // Eval bar + analysis overlay
    if (analysisMoves && analysisMoves[index - 1]) {
      const moveAnalysis = analysisMoves[index - 1];

      // Update eval bar
      if (boardComponent.evalBar) {
        const evalObj = {
          score: moveAnalysis.evalAfter?.score ?? moveAnalysis.evalBefore?.score ?? 0,
          mate: moveAnalysis.evalAfter?.mate ?? moveAnalysis.evalBefore?.mate ?? null,
        };
        boardComponent.evalBar.setEval(evalObj);
      }

      // Show best move arrow if the played move wasn't the best
      if (moveAnalysis.bestMove && moveAnalysis.classification !== 'best') {
        const bm = moveAnalysis.bestMove;
        if (bm && bm.length >= 4) {
          boardComponent.showArrow(bm.substring(0, 2), bm.substring(2, 4), 'green');
        }
      }
    } else if (index === 0 && boardComponent.evalBar) {
      boardComponent.evalBar.setEval({ score: 20, mate: null }); // slight white advantage at start
    }
  }

  // Button nav
  const navFirst = section.querySelector('#review-nav-first');
  const navPrev = section.querySelector('#review-nav-prev');
  const navNext = section.querySelector('#review-nav-next');
  const navLast = section.querySelector('#review-nav-last');

  navFirst.addEventListener('click', () => goToMove(0));
  navPrev.addEventListener('click', () => goToMove(currentMoveIndex - 1));
  navNext.addEventListener('click', () => goToMove(currentMoveIndex + 1));
  navLast.addEventListener('click', () => goToMove(positions.length - 1));

  // Keyboard nav
  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        goToMove(currentMoveIndex - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        goToMove(currentMoveIndex + 1);
        break;
      case 'Home':
        e.preventDefault();
        goToMove(0);
        break;
      case 'End':
        e.preventDefault();
        goToMove(positions.length - 1);
        break;
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // ── Initial position ───────────────────────────────────────────
  boardComponent.setOrientation(playerColor);
  goToMove(0);

  return {
    destroy() {
      destroyed = true;
      unsubs.forEach(fn => fn && fn());
      document.removeEventListener('keydown', onKeyDown);
      boardComponent.destroy();
      moveListComponent.destroy();
      section.remove();
    },
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
