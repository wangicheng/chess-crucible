// ── Puzzle Trainer Component ─────────────────────────────────────
import { store } from '../stores/gameStore.js';
import { formatDate } from '../utils/format.js';
import { Chess } from 'chess.js';
import { stockfish } from '../services/stockfish.js';
import { createBoard } from './board.js';
import { createPuzzleFilters } from './puzzleFilters.js';

const EVAL_THRESHOLDS = {
  excellent: 10,
  good: 50,
  inaccuracy: 100,
  mistake: 200,
};

function classifyMove(playerMoveUci, bestMoveUci, diff) {
  if (playerMoveUci === bestMoveUci.substring(0, 4)) {
    return 'best';
  }
  if (diff <= EVAL_THRESHOLDS.excellent) return 'excellent';
  if (diff <= EVAL_THRESHOLDS.good) return 'good';
  if (diff <= EVAL_THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (diff <= EVAL_THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return uci || '?';
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.substring(0, 2),
      to: uci.substring(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

export function createPuzzleTrainer(container) {
  const allPuzzles = store.state.puzzles || [];
  let filteredPuzzles = [...allPuzzles];
  let puzzleIndex = 0;
  let answered = false;
  let stats = { attempted: 0, correct: 0 };
  let destroyed = false;
  let boardComponent = null;

  // Stepper state (move-by-move navigation)
  let gameAnalysis = [];
  let puzzleMoveIndex = 0;
  let stepperIndex = 0;
  let stepperMax = 0;
  let explorationLine = [];
  let analyzingFen = null;

  const unsubs = [];

  // ── Layout ─────────────────────────────────────────────────────
  const section = document.createElement('section');
  section.className = 'puzzle-trainer-view animate-fadeInUp';
  section.id = 'puzzle-trainer-view';

  const hasPuzzles = allPuzzles.length > 0;

  section.innerHTML = `
    <div class="puzzle-trainer-layout">
      <aside class="puzzle-trainer-sidebar" id="puzzle-trainer-sidebar"></aside>
      <div class="puzzle-trainer-main">
        <header class="trainer-header" id="trainer-header">
          <h2 class="trainer-title" id="trainer-title">${hasPuzzles ? `Puzzle 1 / ${filteredPuzzles.length}` : 'Puzzle Trainer'}</h2>
        </header>
        <div class="trainer-layout">
          <div class="trainer-board-col" id="trainer-board-col"></div>
          <div class="trainer-info-col">
            <div class="card trainer-prompt-card" id="trainer-prompt-card">
              <p class="trainer-prompt" id="trainer-prompt">${hasPuzzles ? 'Find the best move!' : 'No Puzzles Generated Yet'}</p>
              <p class="trainer-context" id="trainer-context">${hasPuzzles ? '' : 'Analyze some games first to generate training puzzles from your mistakes!'}</p>
            </div>
            <div class="trainer-feedback" id="trainer-feedback" style="display:none"></div>
            <div class="trainer-actions" id="trainer-actions">
              <button class="btn btn-ghost" id="trainer-show-answer-btn" ${!hasPuzzles ? 'disabled' : ''}>Show Answer</button>
              <span class="trainer-game-link" id="trainer-game-link"></span>
              <div class="trainer-nav-actions">
                <button class="btn btn-secondary" id="trainer-prev-btn" disabled>← Previous</button>
                <button class="btn btn-primary" id="trainer-next-btn" ${!hasPuzzles ? 'disabled' : ''}>${hasPuzzles ? 'Next Puzzle →' : '<a href="#games" style="color:inherit;text-decoration:none">← Go to Games</a>'}</button>
              </div>
            </div>
            <div class="card trainer-stats-card" id="trainer-stats-card">
              <div class="stat-card">
                <span class="stat-value" id="trainer-stat-attempted">0</span>
                <span class="stat-label">Attempted</span>
              </div>
              <div class="stat-card">
                <span class="stat-value" id="trainer-stat-correct">0%</span>
                <span class="stat-label">Correct</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.appendChild(section);

  // Sidebar: filter component
  const sidebar = section.querySelector('#puzzle-trainer-sidebar');
  if (sidebar) {
    createPuzzleFilters(sidebar);
  }

  // ── References ─────────────────────────────────────────────────
  const titleEl = section.querySelector('#trainer-title');
  const boardCol = section.querySelector('#trainer-board-col');
  const promptEl = section.querySelector('#trainer-prompt');
  const contextEl = section.querySelector('#trainer-context');
  const feedbackEl = section.querySelector('#trainer-feedback');
  const showAnswerBtn = section.querySelector('#trainer-show-answer-btn');
  const gameLinkEl = section.querySelector('#trainer-game-link');
  const prevBtn = section.querySelector('#trainer-prev-btn');
  const nextBtn = section.querySelector('#trainer-next-btn');
  const statAttempted = section.querySelector('#trainer-stat-attempted');
  const statCorrect = section.querySelector('#trainer-stat-correct');

  // ── Board ──────────────────────────────────────────────────────
  boardComponent = createBoard(boardCol, {
    interactive: false,
    orientation: 'white',
    showEvalBar: false,
  });

  // If no puzzles, wait for puzzles to arrive
  if (!hasPuzzles) {
    const unsubEmpty = store.on('puzzles', () => {
      unsubEmpty();
      if (!destroyed) {
        refilterPuzzles();
        updateStats();
      }
    });
    return {
      destroy() {
        unsubEmpty();
        if (boardComponent) boardComponent.destroy();
        section.remove();
      },
    };
  }

  // ── Stepper navigation ─────────────────────────────────────────
  function applyStepper() {
    let currentFen;
    const puzzle = filteredPuzzles[puzzleIndex];
    const orientation = puzzle.playerColor || 'white';
    let exploreIndex = stepperIndex - puzzleMoveIndex - 1;

    boardComponent.setOrientation(orientation);
    boardComponent.clearArrows();

    if (stepperIndex <= puzzleMoveIndex) {
      const entry = gameAnalysis[stepperIndex];
      if (!entry) return;
      currentFen = entry.fen;
      
      if (stepperIndex === 0) {
        boardComponent.setPosition(entry.fen);
      } else {
        const prev = gameAnalysis[stepperIndex - 1];
        boardComponent.setPosition(entry.fen, [prev.from, prev.to]);
      }
    } else {
      const step = explorationLine[exploreIndex];
      if (!step) return;
      currentFen = step.fen;
      boardComponent.setPosition(step.fen, [step.from, step.to]);
    }

    if (answered) {
      boardComponent.setInteractive('both');
    } else {
      const canInteract = stepperIndex === puzzleMoveIndex;
      boardComponent.setInteractive(canInteract ? orientation : null);
    }

    // Update prompt
    if (!answered) {
      if (stepperIndex === puzzleMoveIndex) {
        promptEl.textContent = 'Find the best move!';
      } else if (stepperIndex === 0) {
        promptEl.textContent = 'Starting position';
      } else {
        const prev = gameAnalysis[stepperIndex - 1];
        const num = prev.moveNumber;
        const dot = prev.color === 'black' ? '...' : '.';
        promptEl.textContent = `After ${num}${dot} ${prev.san}`;
      }
    } else {
      if (stepperIndex === puzzleMoveIndex + 1 && explorationLine.length > 0 && exploreIndex === 0) {
        const step = explorationLine[0];
        boardComponent.showArrow(step.from, step.to, 'green');
        promptEl.textContent = 'Position after best move';
      } else if (stepperIndex === puzzleMoveIndex) {
        promptEl.textContent = 'Puzzle position';
      } else if (stepperIndex === 0) {
        promptEl.textContent = 'Starting position';
      } else {
        const prevStep = exploreIndex === 0 ? gameAnalysis[puzzleMoveIndex] : explorationLine[exploreIndex - 1];
        promptEl.textContent = 'Free Analysis';
      }
    }

    // Update context
    const total = puzzleMoveIndex;
    let label = '';
    if (!answered) {
      label = stepperIndex < total
        ? `Reviewing move ${stepperIndex} of ${total}`
        : 'Puzzle — find the best move!';
    } else {
      if (stepperIndex < total) {
        label = `Reviewing move ${stepperIndex} of ${total}`;
      } else if (stepperIndex === total) {
        label = 'Puzzle position (Free analysis)';
      } else if (stepperIndex === total + 1 && exploreIndex === 0) {
        label = 'Result position (Free analysis)';
      } else {
        label = `Free analysis (move ${stepperIndex - total})`;
      }
    }

    contextEl.innerHTML = buildContext(puzzle) + `<br><span class="stepper-indicator">${label}</span>`;

    updateEvalBar();
  }

  function updateEvalBar() {
    if (!answered) return;
    boardComponent.enableEvalBar();
    if (!boardComponent.evalBar) return;

    let targetEval = null;
    let targetFen = null;
    let stepToUpdate = null;

    if (stepperIndex <= puzzleMoveIndex) {
      const entry = gameAnalysis[stepperIndex];
      if (entry) {
        targetEval = entry.evalBefore;
        targetFen = entry.fen;
        stepToUpdate = entry;
      }
    } else {
      const exploreIndex = stepperIndex - puzzleMoveIndex - 1;
      const step = explorationLine[exploreIndex];
      if (step) {
        targetEval = step.evalBefore;
        targetFen = step.fen;
        stepToUpdate = step;
      }
    }

    if (targetEval) {
      boardComponent.evalBar.setEval(targetEval);
    } else if (stepToUpdate && targetFen) {
      if (targetFen !== analyzingFen) {
        if (boardComponent.evalBar.setLoading) {
          boardComponent.evalBar.setLoading();
        }
        analyzingFen = targetFen;
        
        // Ensure Stockfish is initialized before analyzing
        stockfish.init().then(() => {
          if (analyzingFen !== targetFen) return; // FEN changed during init
          
          stockfish.stop();
          stockfish.analyze(targetFen, 14, (progressEval) => {
            if (analyzingFen === targetFen && boardComponent && boardComponent.evalBar) {
              boardComponent.evalBar.setEval(progressEval);
            }
          }).then(evalResult => {
            if (analyzingFen === targetFen) {
              analyzingFen = null;
              if (stepToUpdate) {
                stepToUpdate.evalBefore = evalResult;
              }
              if (boardComponent && boardComponent.evalBar) {
                boardComponent.evalBar.setEval(evalResult);
              }
            }
          }).catch((err) => {
            console.error("Stockfish analysis error:", err);
            if (analyzingFen === targetFen) {
              analyzingFen = null;
              if (boardComponent && boardComponent.evalBar) {
                boardComponent.evalBar.setEval({ score: 0, mate: null });
              }
            }
          });
        }).catch(err => {
          console.error("Stockfish init error:", err);
          if (analyzingFen === targetFen) {
            analyzingFen = null;
            if (boardComponent && boardComponent.evalBar) {
              boardComponent.evalBar.setEval({ score: 0, mate: null });
            }
          }
        });
      }
    }
  }

  function stepperPrev() {
    if (stepperIndex > 0) {
      stepperIndex--;
      applyStepper();
    }
  }

  function stepperNext() {
    if (stepperIndex < stepperMax) {
      stepperIndex++;
      applyStepper();
    }
  }

  function askPromotion() {
    return new Promise(resolve => {
        const dialog = document.createElement('div');
        dialog.style.position = 'absolute';
        dialog.style.top = '50%';
        dialog.style.left = '50%';
        dialog.style.transform = 'translate(-50%, -50%)';
        dialog.style.background = 'var(--bg-card)';
        dialog.style.padding = '1rem';
        dialog.style.borderRadius = '8px';
        dialog.style.border = '1px solid var(--border-color)';
        dialog.style.zIndex = '1000';
        dialog.style.display = 'flex';
        dialog.style.gap = '0.5rem';
        dialog.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        dialog.style.flexDirection = 'column';
        dialog.style.alignItems = 'center';

        const title = document.createElement('div');
        title.textContent = 'Promote to:';
        title.style.marginBottom = '0.5rem';
        title.style.fontWeight = 'bold';
        dialog.appendChild(title);

        const btnContainer = document.createElement('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '0.5rem';

        const pieces = ['q', 'r', 'b', 'n'];
        const names = {'q': '♕ Queen', 'r': '♖ Rook', 'b': '♗ Bishop', 'n': '♘ Knight'};
        
        pieces.forEach(p => {
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.style.padding = '0.5rem 1rem';
            btn.textContent = names[p];
            btn.onclick = () => {
                dialog.remove();
                resolve(p);
            };
            btnContainer.appendChild(btn);
        });

        dialog.appendChild(btnContainer);
        
        boardCol.style.position = 'relative';
        boardCol.appendChild(dialog);
    });
  }

  // ── Load puzzle ────────────────────────────────────────────────
  function loadPuzzle() {
    if (filteredPuzzles.length === 0) {
      titleEl.textContent = 'No puzzles';
      promptEl.textContent = 'No puzzles match the selected filters.';
      contextEl.textContent = '';
      feedbackEl.style.display = 'none';
      boardComponent.clearArrows();
      boardComponent.setInteractive(null);
      stepperMax = 0;
      explorationLine = [];
      return;
    }

    const puzzle = filteredPuzzles[puzzleIndex];
    answered = false;
    boardComponent.disableEvalBar();

    titleEl.textContent = `Puzzle ${puzzleIndex + 1} / ${filteredPuzzles.length}`;
    feedbackEl.style.display = 'none';
    showAnswerBtn.disabled = false;
    showAnswerBtn.textContent = 'Show Answer';

    prevBtn.disabled = puzzleIndex <= 0;
    nextBtn.disabled = puzzleIndex >= filteredPuzzles.length - 1;

    // Update chess.com game link
    if (puzzle.gameUrl) {
      gameLinkEl.innerHTML = `<a href="${escapeHtml(puzzle.gameUrl)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">View on Chess.com ↗</a>`;
    } else {
      gameLinkEl.innerHTML = '';
    }

    // Build stepper data from game analysis
    gameAnalysis = (store.state.analysisResults[puzzle.gameId] || []);
    const puzzleIdParts = puzzle.id.split('_');
    puzzleMoveIndex = parseInt(puzzleIdParts[puzzleIdParts.length - 1], 10);

    if (isNaN(puzzleMoveIndex) || puzzleMoveIndex >= gameAnalysis.length) {
      puzzleMoveIndex = gameAnalysis.length > 0 ? gameAnalysis.length - 1 : 0;
    }

    stepperIndex = puzzleMoveIndex;
    stepperMax = puzzleMoveIndex;
    explorationLine = [];

    // Set up onMove — accepts moves at the puzzle position
    boardComponent.onMove(async (from, to) => {
      if (destroyed) return;
      
      if (!answered) {
        if (stepperIndex !== puzzleMoveIndex) return;

      const puzzle = filteredPuzzles[puzzleIndex];
      let playerMoveUci = from + to;
      const bestMoveUci = puzzle.bestMove || '';

      // Check for promotion first
      let promotion;
      try {
        const tempChess = new Chess(puzzle.fen);
        const moves = tempChess.moves({ verbose: true });
        const isPromo = moves.some(m => m.from === from && m.to === to && m.promotion);
        if (isPromo) {
          promotion = await askPromotion();
          if (!promotion) {
            boardComponent.setPosition(puzzle.fen); // Reset visual
            return;
          }
          playerMoveUci += promotion;
        }
      } catch {
        return;
      }

      // Fast path: exact UCI match
      if (playerMoveUci === bestMoveUci) {
        acceptMove(puzzle, 'best');
        return;
      }

      // Evaluation check: classify the player's move
      try {
        const chessAfter = new Chess(puzzle.fen);
        chessAfter.move({ from, to, promotion });

        const chessBest = new Chess(puzzle.fen);
        const bmFrom = bestMoveUci.substring(0, 2);
        const bmTo = bestMoveUci.substring(2, 4);
        const bestMoves = chessBest.moves({ verbose: true });
        const isBestPromo = bestMoves.some(m => m.from === bmFrom && m.to === bmTo && m.promotion);
        const bmPromo = bestMoveUci.length > 4 ? bestMoveUci[4] : (isBestPromo ? 'q' : undefined);
        chessBest.move({ from: bmFrom, to: bmTo, promotion: bmPromo });

        const [playerEval, bestEval] = await Promise.all([
          stockfish.analyze(chessAfter.fen(), 14),
          stockfish.analyze(chessBest.fen(), 14),
        ]);

        const playerScore = playerEval.score != null ? playerEval.score : 0;
        const bestScore = bestEval.score != null ? bestEval.score : 0;

        const diff = puzzle.playerColor === 'white'
          ? bestScore - playerScore
          : playerScore - bestScore;

        const classification = classifyMove(playerMoveUci, bestMoveUci, diff);

        if (classification === 'inaccuracy' || classification === 'mistake' || classification === 'blunder') {
          showWrongFeedback(classification);
          stepperIndex = puzzleMoveIndex;
          applyStepper();
          updateStats();
          return;
        }

        acceptMove(puzzle, classification);
        return;
        } catch {
          // Stockfish failed — fall through to try again
        }

        // Wrong — try again
        showWrongFeedback();
        stepperIndex = puzzleMoveIndex;
        applyStepper();
        updateStats();
      } else {
        // Free exploration phase
        let currentFen = '';
        if (stepperIndex <= puzzleMoveIndex) {
          currentFen = gameAnalysis[stepperIndex].fen;
        } else {
          currentFen = explorationLine[stepperIndex - puzzleMoveIndex - 1].fen;
        }

        try {
          const chess = new Chess(currentFen);
          const moves = chess.moves({ verbose: true });
          const isPromo = moves.some(m => m.from === from && m.to === to && m.promotion);
          let promotion;
          if (isPromo) {
            promotion = await askPromotion();
            if (!promotion) {
              boardComponent.setPosition(currentFen);
              return;
            }
          }
          const move = chess.move({ from, to, promotion });
          
          if (move) {
            const newFen = chess.fen();
            
            const keepCount = Math.max(0, stepperIndex - puzzleMoveIndex);
            explorationLine = explorationLine.slice(0, keepCount);
            
            explorationLine.push({
              fen: newFen,
              from,
              to,
              san: move.san,
              evalBefore: null
            });
            
            stepperMax = puzzleMoveIndex + explorationLine.length;
            stepperIndex = stepperMax;
            
            applyStepper();
          } else {
            applyStepper();
          }
        } catch {
          applyStepper();
        }
      }
    });

    function acceptMove(puzzle, classification) {
      answered = true;
      stats.attempted++;
      stats.correct++;

      const bestMoveUci = puzzle.bestMove || '';
      if (bestMoveUci.length >= 4) {
        try {
          const chess = new Chess(puzzle.fen);
          const from = bestMoveUci.substring(0, 2);
          const to = bestMoveUci.substring(2, 4);
          const promo = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;
          const move = chess.move({ from, to, promotion: promo });
          
          explorationLine = [{
            fen: chess.fen(),
            from,
            to,
            san: move.san,
            evalBefore: null
          }];
        } catch {
          explorationLine = [];
        }
      } else {
        explorationLine = [];
      }

      stepperMax = puzzleMoveIndex + explorationLine.length;
      stepperIndex = stepperMax;

      if (explorationLine.length > 0) {
        const gameEntry = gameAnalysis[puzzleMoveIndex];
        if (gameEntry && gameEntry.evalBefore) {
          explorationLine[0].evalBefore = gameEntry.evalBefore;
        }
      }

      showCorrectFeedback(puzzle, classification);
      applyStepper();
      updateStats();
    }

    applyStepper();
  }

  // ── Feedback helpers ──────────────────────────────────────────
  function showCorrectFeedback(puzzle, classification) {
    const originalMoveInfo = puzzle.playerMove
      ? `<p class="trainer-original-move">Your original move in game: <strong>${escapeHtml(puzzle.playerMove)}</strong></p>`
      : '';

    let feedbackText;
    if (classification === 'best') {
      feedbackText = '✅ Correct! This is the best move.';
    } else if (classification === 'excellent') {
      feedbackText = '✅ Correct! Very close to the best move.';
    } else {
      feedbackText = '✅ Correct! Solid move, though not the best.';
    }

    feedbackEl.className = 'trainer-feedback feedback feedback-correct animate-fadeIn';
    feedbackEl.style.display = '';
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span class="feedback-text">${feedbackText}</span>
      </div>
      ${originalMoveInfo}
    `;
  }

  function showWrongFeedback(classification) {
    const text = classification
      ? `${classification.charAt(0).toUpperCase() + classification.slice(1)} — try again!`
      : 'Not quite — try again!';
    feedbackEl.className = 'trainer-feedback feedback feedback-incorrect animate-fadeIn';
    feedbackEl.style.display = '';
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span class="feedback-icon">❌</span>
        <span class="feedback-text">${text}</span>
      </div>
    `;
  }

  // ── Show answer ────────────────────────────────────────────────
  function onShowAnswer() {
    if (filteredPuzzles.length === 0) return;
    const puzzle = filteredPuzzles[puzzleIndex];

    answered = true;
    stats.attempted++;
    showAnswerBtn.disabled = true;

    const bestMoveUci = puzzle.bestMove || '';
    const bestMoveSan = uciToSan(puzzle.fen, bestMoveUci);

    if (bestMoveUci.length >= 4) {
      try {
        const chess = new Chess(puzzle.fen);
        const from = bestMoveUci.substring(0, 2);
        const to = bestMoveUci.substring(2, 4);
        const promo = bestMoveUci.length > 4 ? bestMoveUci[4] : undefined;
        const move = chess.move({ from, to, promotion: promo });
        
        explorationLine = [{
          fen: chess.fen(),
          from,
          to,
          san: move.san,
          evalBefore: null
        }];
      } catch {
        explorationLine = [];
      }
    } else {
      explorationLine = [];
    }

    stepperMax = puzzleMoveIndex + explorationLine.length;
    stepperIndex = stepperMax;

    if (explorationLine.length > 0) {
      const gameEntry = gameAnalysis[puzzleMoveIndex];
      if (gameEntry && gameEntry.evalBefore) {
        explorationLine[0].evalBefore = gameEntry.evalBefore;
      }
    }

    const originalMoveInfo = puzzle.playerMove
      ? `<p class="trainer-original-move">Your original move in game: <strong>${escapeHtml(puzzle.playerMove)}</strong></p>`
      : '';

    feedbackEl.className = 'trainer-feedback feedback animate-fadeIn';
    feedbackEl.style.display = '';
    feedbackEl.innerHTML = `
      <div class="feedback-header">
        <span class="feedback-icon">💡</span>
        <span class="feedback-text">The best move was <strong>${bestMoveSan}</strong></span>
      </div>
      ${originalMoveInfo}
    `;

    applyStepper();
    updateStats();
  }
  showAnswerBtn.addEventListener('click', onShowAnswer);

  // ── Puzzle Navigation (buttons only, not arrow keys) ───────────
  function onPrevPuzzle() {
    if (puzzleIndex > 0) {
      puzzleIndex--;
      loadPuzzle();
    }
  }
  function onNextPuzzle() {
    if (puzzleIndex < filteredPuzzles.length - 1) {
      puzzleIndex++;
      loadPuzzle();
    }
  }
  prevBtn.addEventListener('click', onPrevPuzzle);
  nextBtn.addEventListener('click', onNextPuzzle);

  // Arrow keys now control the move stepper, not puzzle navigation
  function onKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepperPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepperNext();
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // ── Stats ──────────────────────────────────────────────────────
  function updateStats() {
    statAttempted.textContent = String(stats.attempted);
    const pct = stats.attempted > 0 ? Math.round((stats.correct / stats.attempted) * 100) : 0;
    statCorrect.textContent = `${pct}%`;
  }

  // ── Re-filter when puzzles change ──────────────────────────────
  function refilterPuzzles() {
    const puzzles = store.state.puzzles || [];
    const { puzzleFilters, filters } = store.state;

    let filtered = [...puzzles];

    // Severity filter
    if (puzzleFilters.severity && puzzleFilters.severity.length > 0) {
      filtered = filtered.filter(p =>
        puzzleFilters.severity.includes(p.classification)
      );
    }

    // Eval before filter
    if (puzzleFilters.evalBefore && puzzleFilters.evalBefore !== 'any') {
      filtered = filtered.filter(p => {
        const score = p.evalBefore ? p.evalBefore.score : 0;
        const playerScore = p.playerColor === 'white' ? score : -score;
        if (puzzleFilters.evalBefore === 'advantage_or_equal') return playerScore >= 0;
        if (puzzleFilters.evalBefore === 'advantage') return playerScore > 0;
        return true;
      });
    }

    // Eval after filter
    if (puzzleFilters.evalAfter && puzzleFilters.evalAfter !== 'any') {
      filtered = filtered.filter(p => {
        const score = p.evalAfter ? p.evalAfter.score : 0;
        const playerScore = p.playerColor === 'white' ? score : -score;
        if (puzzleFilters.evalAfter === 'equal_or_disadvantage') return playerScore <= 0;
        if (puzzleFilters.evalAfter === 'disadvantage') return playerScore < 0;
        return true;
      });
    }

    // Game-level filters
    if (filters.timeClasses && filters.timeClasses.length > 0) {
      filtered = filtered.filter(p =>
        filters.timeClasses.includes(p.timeClass)
      );
    }
    if (filters.dateFrom) {
      const from = filters.dateFrom instanceof Date ? filters.dateFrom : new Date(filters.dateFrom);
      filtered = filtered.filter(p => {
        const d = p.date instanceof Date ? p.date : new Date(p.date);
        return d >= from;
      });
    }
    if (filters.dateTo) {
      const to = filters.dateTo instanceof Date ? filters.dateTo : new Date(filters.dateTo);
      filtered = filtered.filter(p => {
        const d = p.date instanceof Date ? p.date : new Date(p.date);
        return d <= to;
      });
    }
    if (filters.minElo != null) {
      filtered = filtered.filter(p => p.playerRating >= filters.minElo);
    }
    if (filters.maxElo != null) {
      filtered = filtered.filter(p => p.playerRating <= filters.maxElo);
    }
    if (filters.minOpponentElo != null) {
      filtered = filtered.filter(p => p.opponentRating >= filters.minOpponentElo);
    }
    if (filters.maxOpponentElo != null) {
      filtered = filtered.filter(p => p.opponentRating <= filters.maxOpponentElo);
    }
    if (filters.results && filters.results.length > 0) {
      filtered = filtered.filter(p =>
        filters.results.includes(p.result)
      );
    }

    filteredPuzzles = filtered;
    if (puzzleIndex >= filteredPuzzles.length) {
      puzzleIndex = Math.max(0, filteredPuzzles.length - 1);
    }
    puzzleIndex = Math.max(0, puzzleIndex);
    answered = false;
    loadPuzzle();
  }

  // ── Store subscriptions ─────────────────────────────────────────
  unsubs.push(store.on('puzzles', () => {
    refilterPuzzles();
  }));

  unsubs.push(store.on('filters', () => {
    refilterPuzzles();
  }));

  unsubs.push(store.on('puzzleFilters', () => {
    refilterPuzzles();
  }));

  // ── Initial load ───────────────────────────────────────────────
  refilterPuzzles();
  updateStats();

  return {
    destroy() {
      destroyed = true;
      unsubs.forEach(fn => fn && fn());
      showAnswerBtn.removeEventListener('click', onShowAnswer);
      prevBtn.removeEventListener('click', onPrevPuzzle);
      nextBtn.removeEventListener('click', onNextPuzzle);
      document.removeEventListener('keydown', onKeyDown);
      if (boardComponent) {
        boardComponent.disableEvalBar();
        boardComponent.destroy();
      }
      section.remove();
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────
function buildContext(puzzle) {
  const parts = [];
  if (puzzle.opponentName) {
    let text = `From game vs. <strong>${escapeHtml(puzzle.opponentName)}</strong>`;
    if (puzzle.opponentRating) text += ` (${puzzle.opponentRating})`;
    parts.push(text);
  }
  if (puzzle.date) parts.push(`on ${formatDate(puzzle.date)}`);
  if (puzzle.moveNumber) parts.push(`• Move ${puzzle.moveNumber}`);
  if (puzzle.classification) {
    const cls = puzzle.classification;
    const badgeClass = cls === 'blunder' ? 'badge-blunder' : cls === 'mistake' ? 'badge-mistake' : 'badge-inaccuracy';
    parts.push(`<span class="badge ${badgeClass}">${cls.charAt(0).toUpperCase() + cls.slice(1)}</span>`);
  }
  return parts.join(' ');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
