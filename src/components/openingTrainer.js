import { Chess } from 'chess.js';
import { createBoard } from './board.js';
import { stockfish } from '../services/stockfish.js';
import { openingEngine } from '../services/openingEngine.js';
import { openingStore } from '../stores/openingStore.js';

export function createOpeningTrainer(container) {
  let destroyed = false;
  let chess = new Chess();
  let boardComponent = null;
  
  // Game state
  let playerColor = 'white';
  let elo = 1500;
  let targetMoves = 12;
  let currentMoves = 0;
  let isEngineTurn = false;
  let isGameOver = false;
  let pausedForMistake = false;
  let isEvaluating = false;

  let historyFens = [];
  let historyMoves = [];
  let currentViewIndex = 0;
  let lastOpeningName = 'Starting Position';
  let lastEngineFen = null;
  let lastEngineMoveSan = null;
  let madeMistakeOnCurrentMove = false;
  let engineMovesInCurrentRun = [];
  
  // Elements
  const section = document.createElement('section');
  section.className = 'opening-trainer-view animate-fadeInUp';
  section.id = 'opening-trainer-view';
  
  const savedSettings = JSON.parse(localStorage.getItem('openingTrainerSettings')) || {
    color: 'white',
    elo: 1500,
    target: 12
  };
  let selectedColor = savedSettings.color;

  section.innerHTML = `
    <div class="puzzle-trainer-layout">
      <aside class="puzzle-trainer-sidebar">
        <div class="filter-group">
          <label class="filter-label">Practice Settings</label>
          <fieldset class="filter-section" style="margin-bottom: 1rem;">
            <legend class="filter-section-title">Play As</legend>
            <div class="filter-pills" id="ot-color-pills">
              <button type="button" class="pill ${savedSettings.color === 'white' ? 'active' : ''}" data-color="white">White</button>
              <button type="button" class="pill ${savedSettings.color === 'black' ? 'active' : ''}" data-color="black">Black</button>
              <button type="button" class="pill ${savedSettings.color === 'both' ? 'active' : ''}" data-color="both">Both</button>
            </div>
          </fieldset>
          <fieldset class="filter-section" style="margin-bottom: 1rem;">
            <legend class="filter-section-title">Your Elo</legend>
            <input type="number" id="ot-elo" class="input" value="${savedSettings.elo}" step="100">
          </fieldset>
          <fieldset class="filter-section" style="margin-bottom: 1rem;">
            <legend class="filter-section-title">Target Moves</legend>
            <input type="number" id="ot-target" class="input" value="${savedSettings.target}" min="1" max="50">
          </fieldset>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <button id="ot-new-game" class="btn btn-primary" style="width:100%">Start New Run</button>
            <button id="ot-undo-btn" class="btn btn-secondary" style="width:100%">Undo Move</button>
          </div>
        </div>
      </aside>
      
      <div class="puzzle-trainer-main">
        <header class="trainer-header">
          <h2 class="trainer-title">Opening Practice</h2>
        </header>
        <div class="trainer-layout">
          <div class="trainer-board-col" id="ot-board-col"></div>
          <div class="trainer-info-col">
            <div class="card trainer-prompt-card">
              <p class="trainer-prompt" id="ot-prompt">Play your opening moves. Survive ${targetMoves} moves!</p>
              <p class="trainer-context" id="ot-context">Move 0 / ${targetMoves}</p>
            </div>
            <div class="card trainer-opening-card" id="ot-opening-card" style="display:none; margin-top: 1rem; padding: 1rem; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-color);">
              <h3 class="opening-name" id="ot-opening-name" style="margin-top: 0; margin-bottom: 0.5rem; font-size: 1.1rem; color: var(--primary-color);">Starting Position</h3>
              <div class="opening-stats" id="ot-opening-stats" style="font-size: 0.9rem; color: var(--text-secondary);">
              </div>
            </div>
            <div class="trainer-feedback" id="ot-feedback" style="display:none"></div>
            <div class="trainer-actions" id="ot-actions" style="display:flex; margin-top: 1rem;">
                <button class="btn btn-ghost" id="ot-help-btn">Ask Stockfish for Help</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(section);

  const boardCol = section.querySelector('#ot-board-col');
  const promptEl = section.querySelector('#ot-prompt');
  const contextEl = section.querySelector('#ot-context');
  const feedbackEl = section.querySelector('#ot-feedback');
  const actionsEl = section.querySelector('#ot-actions');
  const helpBtn = section.querySelector('#ot-help-btn');
  const newGameBtn = section.querySelector('#ot-new-game');
  const undoBtn = section.querySelector('#ot-undo-btn');
  const colorPills = section.querySelectorAll('#ot-color-pills .pill');
  colorPills.forEach(pill => {
    pill.addEventListener('click', () => {
      colorPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedColor = pill.dataset.color;
    });
  });
  
  const eloInput = section.querySelector('#ot-elo');
  const targetInput = section.querySelector('#ot-target');

  boardComponent = createBoard(boardCol, {
    interactive: 'white',
    orientation: 'white',
    showEvalBar: true,
  });

  // Initialize openingStore (in case it wasn't already)
  openingStore.init().then(() => {
    // start fresh
    startNewGame();
  });

  // Help button
  helpBtn.addEventListener('click', async () => {
    if (destroyed || isEngineTurn || isEvaluating) return;
    helpBtn.disabled = true;
    helpBtn.textContent = 'Analyzing...';
    try {
        await stockfish.init();
        const analysis = await stockfish.analyze(chess.fen(), 14);
        const bestMoveSan = getSanFromUci(chess.fen(), analysis.bestMove);
        showFeedback(`💡 Stockfish suggests: <strong>${bestMoveSan}</strong>`, 'info');
    } catch (e) {
        showFeedback('Stockfish error', 'incorrect');
    }
    helpBtn.textContent = 'Ask Stockfish for Help';
    helpBtn.disabled = false;
  });

  function getSanFromUci(fen, uci) {
      if (!uci) return '?';
      try {
          const temp = new Chess(fen);
          let from = uci.substring(0,2);
          let to = uci.substring(2,4);
          let promotion = uci.length > 4 ? uci[4] : undefined;
          
          const piece = temp.get(from);
          if (piece && piece.type === 'k') {
              if (from === 'e1' && to === 'h1') to = 'g1';
              if (from === 'e1' && to === 'a1') to = 'c1';
              if (from === 'e8' && to === 'h8') to = 'g8';
              if (from === 'e8' && to === 'a8') to = 'c8';
          }
          
          const move = temp.move({
              from,
              to,
              promotion
          });
          return move ? move.san : uci;
      } catch {
          return uci;
      }
  }

  function startNewGame() {
    chess.reset();
    currentMoves = 0;
    isGameOver = false;
    pausedForMistake = false;
    isEngineTurn = false;
    isEvaluating = false;
    
    historyFens = [chess.fen()];
    historyMoves = [null];
    currentViewIndex = 0;
    lastOpeningName = 'Starting Position';
    lastEngineFen = null;
    lastEngineMoveSan = null;
    madeMistakeOnCurrentMove = false;
    engineMovesInCurrentRun = [];
    
    elo = parseInt(eloInput.value, 10) || 1500;
    targetMoves = parseInt(targetInput.value, 10) || 12;

    localStorage.setItem('openingTrainerSettings', JSON.stringify({
      color: selectedColor,
      elo: elo,
      target: targetMoves
    }));

    if (selectedColor === 'both') {
      playerColor = Math.random() < 0.5 ? 'white' : 'black';
    } else {
      playerColor = selectedColor;
    }

    openingStore.incrementGlobalUrgency();

    boardComponent.setPosition(chess.fen());
    boardComponent.setOrientation(playerColor);
    boardComponent.clearArrows();
    boardComponent.evalBar.setEval({ score: 0, mate: null });
    
    hideFeedback();
    updateContext();
    updateOpeningCard();

    if (playerColor === 'black') {
        enginePlay();
    } else {
        boardComponent.setInteractive('white');
        promptEl.textContent = 'Your turn. Play a move!';
    }
  }

  newGameBtn.addEventListener('click', startNewGame);

  function undoMove() {
      if (destroyed || isEvaluating || isEngineTurn || pausedForMistake || currentMoves === 0 || isGameOver) return;
      
      chess.undo();
      chess.undo();
      historyFens.pop(); historyFens.pop();
      historyMoves.pop(); historyMoves.pop();
      
      if (engineMovesInCurrentRun.length > 0) {
          engineMovesInCurrentRun.pop();
          if (engineMovesInCurrentRun.length > 0) {
              const last = engineMovesInCurrentRun[engineMovesInCurrentRun.length - 1];
              lastEngineFen = last.fen;
              lastEngineMoveSan = last.san;
          } else {
              lastEngineFen = null;
              lastEngineMoveSan = null;
          }
      }
      
      currentMoves--;
      currentViewIndex = historyFens.length - 1;
      
      boardComponent.setPosition(historyFens[currentViewIndex], historyMoves[currentViewIndex]);
      boardComponent.setInteractive(playerColor);
      
      updateContext();
      isGameOver = false;
      promptEl.textContent = 'Your turn. Play a move!';
      hideFeedback();
      
      // Update eval bar asynchronously
      stockfish.analyze(chess.fen(), 10).then(evalResult => {
          if (!destroyed && !isEvaluating) {
              boardComponent.evalBar.setEval(evalResult);
          }
      }).catch(()=>{});
  }

  undoBtn.addEventListener('click', undoMove);

  function updateContext() {
      contextEl.textContent = `Move ${currentMoves} / ${targetMoves}`;
  }

  function updateOpeningCard(stats = null) {
      const card = section.querySelector('#ot-opening-card');
      const nameEl = section.querySelector('#ot-opening-name');
      const statsEl = section.querySelector('#ot-opening-stats');
      
      if (!card) return;
      card.style.display = 'block';
      nameEl.textContent = lastOpeningName;
      
      if (stats) {
          const mistakeRate = (stats.e * 100).toFixed(0);
          statsEl.innerHTML = `
              <div style="margin-bottom: 4px;"><strong>Your Record vs This Move:</strong></div>
              <div>Encounters: ${stats.v} | Success Streak: ${stats.consecutiveSuccesses} | Mistake Rate: ${mistakeRate}%</div>
          `;
      } else {
          statsEl.innerHTML = '';
      }
  }

  function showFeedback(html, type='incorrect') {
      feedbackEl.style.display = 'block';
      feedbackEl.className = `trainer-feedback feedback feedback-${type} animate-fadeIn`;
      feedbackEl.innerHTML = html;
  }

  function hideFeedback() {
      feedbackEl.style.display = 'none';
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

  boardComponent.onMove(async (from, to) => {
    if (destroyed || isEngineTurn || isGameOver || pausedForMistake) return;

    // It's player's turn.
    const fenBefore = chess.fen();
    let moveObj;
    
    // Check legality
    try {
      const moves = chess.moves({ verbose: true });
      const isPromo = moves.some(m => m.from === from && m.to === to && m.promotion);
      let promotion;
      if (isPromo) {
          promotion = await askPromotion();
          if (!promotion) {
              boardComponent.setPosition(fenBefore);
              return;
          }
      }
      moveObj = chess.move({ from, to, promotion });
    } catch {
      boardComponent.setPosition(fenBefore); // invalid move
      return;
    }

    if (!moveObj) {
      boardComponent.setPosition(fenBefore);
      return;
    }

    isEvaluating = true;
    boardComponent.setInteractive(null); // disable until eval finishes
    boardComponent.setPosition(chess.fen(), [from, to]);
    promptEl.textContent = 'Evaluating move...';

    // Evaluate mistake
    try {
        await stockfish.init();
        const [evalBefore, evalAfter] = await Promise.all([
            stockfish.analyze(fenBefore, 12),
            stockfish.analyze(chess.fen(), 12)
        ]);

        const scoreBefore = playerColor === 'white' ? evalBefore.score : -evalBefore.score;
        const scoreAfter = playerColor === 'white' ? evalAfter.score : -evalAfter.score;
        
        // Mate handling
        let evalDrop = 0;
        if (evalBefore.mate !== null || evalAfter.mate !== null) {
             // simplify: if mate was not imminent and now is against player, huge drop
             const mateBeforeMover = evalBefore.mate !== null ? (playerColor === 'white' ? evalBefore.mate : -evalBefore.mate) : 0;
             const mateAfterMover = evalAfter.mate !== null ? (playerColor === 'white' ? evalAfter.mate : -evalAfter.mate) : 0;
             
             if (mateBeforeMover > 0 && mateAfterMover < 0) evalDrop = 1000;
             else if (mateBeforeMover === 0 && mateAfterMover < 0) evalDrop = 1000;
             // else we ignore intricate mate diffs for basic error checking
        } else {
             evalDrop = scoreBefore - scoreAfter;
        }

        // if score drop > 80 centipawns
        if (evalDrop > 80) {
             // Mistake!
             if (!madeMistakeOnCurrentMove) {
                 if (lastEngineFen && lastEngineMoveSan) {
                     openingStore.recordFailure(lastEngineFen, lastEngineMoveSan);
                     
                     // Apply retroactive failure to all previous engine nodes in this run
                     for (let i = 0; i < engineMovesInCurrentRun.length - 1; i++) {
                         const pastMove = engineMovesInCurrentRun[i];
                         openingStore.recordRetroactiveFailure(pastMove.fen, pastMove.san);
                     }
                 } else {
                     openingStore.recordFailure(fenBefore, moveObj.san);
                 }
                 madeMistakeOnCurrentMove = true;
             }
             
             pausedForMistake = true;
             boardComponent.evalBar.setEval(evalAfter);
             
             showFeedback(`
                <div class="feedback-header">
                  <span class="feedback-icon">❌</span>
                  <span class="feedback-text">Inaccuracy or Blunder! Eval dropped by ${(evalDrop/100).toFixed(1)}. Try again!</span>
                </div>
             `);
             promptEl.textContent = 'Find a better move.';

             // Revert move after a brief delay
             setTimeout(() => {
                 if (destroyed || !pausedForMistake) return;
                 chess.undo();
                 boardComponent.setPosition(historyFens[currentViewIndex], historyMoves[currentViewIndex]);
                 boardComponent.evalBar.setEval(evalBefore);
                 boardComponent.setInteractive(playerColor);
                 pausedForMistake = false;
                 isEvaluating = false;
             }, 1000);
             return; // don't advance turn
        }

        // Passed
        if (!madeMistakeOnCurrentMove) {
            if (lastEngineFen && lastEngineMoveSan) {
                openingStore.recordSuccess(lastEngineFen, lastEngineMoveSan);
            } else {
                openingStore.recordSuccess(fenBefore, moveObj.san);
            }
        }
        boardComponent.evalBar.setEval(evalAfter);
        
        historyFens.push(chess.fen());
        historyMoves.push([from, to]);
        currentViewIndex = historyFens.length - 1;
        isEvaluating = false;

        // Count move for white and black as a pair (like normal move numbers)
        // Or we just count ply. We will count plies / 2.
        if (playerColor === 'black') {
            currentMoves++;
        } else if (chess.turn() === 'b') {
            currentMoves++; 
            // Wait, if player is white, they just moved, it's black's turn. 
            // 1. e4 (currentMoves=1)
        }
        updateContext();

        if (chess.isGameOver()) {
            isGameOver = true;
            if (chess.isCheckmate()) {
                promptEl.textContent = 'Checkmate! You win!';
                showFeedback('🏆 Brilliant! You mated the engine.', 'correct');
            } else {
                promptEl.textContent = 'Game Over. Draw.';
                showFeedback('Game ended in a draw.', 'info');
            }
            return;
        }

        if (currentMoves >= targetMoves) {
            isGameOver = true;
            promptEl.textContent = 'Target Reached! Well played.';
            showFeedback('🎉 You survived the opening!', 'correct');
            return;
        }

        enginePlay();
    } catch (e) {
        console.error('Eval error', e);
        // Fallback: accept move if stockfish fails
        historyFens.push(chess.fen());
        historyMoves.push([from, to]);
        currentViewIndex = historyFens.length - 1;
        isEvaluating = false;
        
        boardComponent.setInteractive(playerColor);
        promptEl.textContent = 'Your turn.';
    }
  });

  async function enginePlay() {
      if (destroyed || isGameOver) return;
      isEngineTurn = true;
      promptEl.textContent = 'Engine is thinking...';
      hideFeedback();
      boardComponent.setInteractive(null);

      const fenBefore = chess.fen();
      const result = await openingEngine.getEngineMove(fenBefore, elo);
      const engineMove = result ? result.move : null;

      let uciMoveStr = '';
      let sanStr = '';
      let moveStats = null;

      if (engineMove) {
          uciMoveStr = engineMove.uci;
          sanStr = engineMove.san;
          moveStats = openingStore.getStat(fenBefore, sanStr);
          openingStore.recordEncounter(fenBefore, sanStr);
      } else {
          // Fallback to stockfish if no opening moves found
          try {
            await stockfish.init();
            const analysis = await stockfish.analyze(fenBefore, 10);
            if (analysis.bestMove) {
                uciMoveStr = analysis.bestMove;
            }
          } catch(e) {}
      }

      if (result && result.openingName) {
          lastOpeningName = result.openingName;
      }
      if (engineMove) {
          updateOpeningCard(moveStats);
      }

      if (uciMoveStr) {
          try {
              let from = uciMoveStr.substring(0,2);
              let to = uciMoveStr.substring(2,4);
              let promotion = uciMoveStr.length > 4 ? uciMoveStr[4] : undefined;
              
              const piece = chess.get(from);
              if (piece && piece.type === 'k') {
                  if (from === 'e1' && to === 'h1') to = 'g1';
                  if (from === 'e1' && to === 'a1') to = 'c1';
                  if (from === 'e8' && to === 'h8') to = 'g8';
                  if (from === 'e8' && to === 'a8') to = 'c8';
              }

              const moveObj = chess.move({
                  from,
                  to,
                  promotion
              });
              sanStr = moveObj.san;
              
              lastEngineFen = fenBefore;
              lastEngineMoveSan = sanStr;
              madeMistakeOnCurrentMove = false;
              engineMovesInCurrentRun.push({ fen: fenBefore, san: sanStr });
              
              boardComponent.setPosition(chess.fen(), [moveObj.from, moveObj.to]);
              
              historyFens.push(chess.fen());
              historyMoves.push([moveObj.from, moveObj.to]);
              currentViewIndex = historyFens.length - 1;

              if (playerColor === 'white' && chess.turn() === 'w') {
                  // White's turn again. Black just moved.
                  // Wait, no. If player is black, engine just moved white (ply 1). currentMoves is still 0.
              }

              // Evaluate position after engine move
              const evalResult = await stockfish.analyze(chess.fen(), 10);
              boardComponent.evalBar.setEval(evalResult);

          } catch (e) {
              console.error('Engine move error', e);
          }
      }

      if (chess.isGameOver()) {
          isGameOver = true;
          isEngineTurn = false;
          boardComponent.setInteractive(null);
          if (chess.isCheckmate()) {
              promptEl.textContent = 'Checkmate! Engine wins.';
              showFeedback('You were checkmated.', 'incorrect');
          } else {
              promptEl.textContent = 'Game Over. Draw.';
              showFeedback('Game ended in a draw.', 'info');
          }
          return;
      }

      isEngineTurn = false;
      boardComponent.setInteractive(playerColor);
      promptEl.textContent = 'Your turn. Play a move!';
  }

  function navigateHistory(dir) {
      if (destroyed || isEngineTurn || isEvaluating || pausedForMistake || historyFens.length === 0) return;
      
      const newIndex = currentViewIndex + dir;
      if (newIndex >= 0 && newIndex < historyFens.length) {
          currentViewIndex = newIndex;
          const fen = historyFens[currentViewIndex];
          const lastMove = historyMoves[currentViewIndex];
          boardComponent.setPosition(fen, lastMove);
          
          if (currentViewIndex < historyFens.length - 1) {
              boardComponent.setInteractive(null);
          } else {
              if (!isEngineTurn && !isGameOver && !pausedForMistake) {
                  boardComponent.setInteractive(playerColor);
              }
          }
      }
  }

  function handleKeyDown(e) {
      if (e.key === 'ArrowLeft') {
          navigateHistory(-1);
      } else if (e.key === 'ArrowRight') {
          navigateHistory(1);
      }
  }

  document.addEventListener('keydown', handleKeyDown);

  return {
    destroy() {
      destroyed = true;
      document.removeEventListener('keydown', handleKeyDown);
      if (boardComponent) {
        boardComponent.destroy();
      }
      section.remove();
    }
  };
}
