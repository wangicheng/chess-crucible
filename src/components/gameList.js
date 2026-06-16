// ── Game List Component ──────────────────────────────────────────
import { store } from '../stores/gameStore.js';
import { stockfish } from '../services/stockfish.js';
import { analyzer } from '../services/analyzer.js';
import { formatDate, formatTimeControl } from '../utils/format.js';
import { createGameFilters } from './gameFilters.js';

export function createGameList(container) {
  const section = document.createElement('section');
  section.className = 'game-list-view animate-fadeInUp';
  section.id = 'game-list-view';

  section.innerHTML = `
    <div class="game-list-layout">
      <aside class="game-list-sidebar" id="game-list-sidebar"></aside>
      <div class="game-list-main" id="game-list-main">
        <header class="game-list-header" id="game-list-header">
          <div class="game-list-header-left">
            <h2 class="game-list-title" id="game-list-title">Games</h2>
            <span class="badge" id="game-count-badge">0</span>
          </div>
          <button class="btn btn-primary" id="analyze-all-btn">
            ⚡ Analyze All
          </button>
        </header>
        <div class="game-list-items" id="game-list-items"></div>
      </div>
    </div>
    <div class="overlay" id="analysis-overlay" style="display:none">
      <div class="modal analysis-modal" id="analysis-modal">
        <h3 class="analysis-modal-title" id="analysis-modal-title">Analyzing Games</h3>
        <p class="analysis-modal-text" id="analysis-modal-text">Preparing…</p>
        <div class="progress" id="analysis-progress">
          <div class="progress-fill" id="analysis-progress-fill" style="width:0%"></div>
        </div>
        <p class="analysis-modal-sub" id="analysis-modal-sub"></p>
        <div class="analysis-modal-actions" id="analysis-modal-actions" style="display:none">
          <button class="btn btn-primary" id="analysis-start-training-btn">🎯 Start Training</button>
          <button class="btn btn-secondary" id="analysis-close-btn">Close</button>
        </div>
      </div>
    </div>
  `;

  container.appendChild(section);

  // ── References ─────────────────────────────────────────────────
  const sidebar = section.querySelector('#game-list-sidebar');
  const listItems = section.querySelector('#game-list-items');
  const countBadge = section.querySelector('#game-count-badge');
  const analyzeAllBtn = section.querySelector('#analyze-all-btn');
  const overlay = section.querySelector('#analysis-overlay');
  const modalTitle = section.querySelector('#analysis-modal-title');
  const modalText = section.querySelector('#analysis-modal-text');
  const progressFill = section.querySelector('#analysis-progress-fill');
  const modalSub = section.querySelector('#analysis-modal-sub');
  const modalActions = section.querySelector('#analysis-modal-actions');
  const startTrainingBtn = section.querySelector('#analysis-start-training-btn');
  const closeBtn = section.querySelector('#analysis-close-btn');

  // ── Filters component ─────────────────────────────────────────
  const filtersComponent = createGameFilters(sidebar);

  const unsubs = [];
  let destroyed = false;

  // ── Render game list ───────────────────────────────────────────
  function renderGames(games) {
    if (!games || games.length === 0) {
      listItems.innerHTML = `
        <div class="empty-state" id="game-list-empty">
          <p>No games match your filters.</p>
        </div>
      `;
      countBadge.textContent = '0';
      return;
    }

    countBadge.textContent = String(games.length);
    listItems.innerHTML = '';

    games.forEach((game, idx) => {
      const item = document.createElement('div');
      item.className = 'game-item animate-fadeIn';
      item.id = `game-item-${game.id || idx}`;
      item.dataset.gameId = game.id || idx;

      const resultClass =
        game.result === 'win' ? 'badge-win' :
        game.result === 'loss' ? 'badge-loss' : 'badge-draw';
      const resultLabel =
        game.result === 'win' ? 'W' :
        game.result === 'loss' ? 'L' : 'D';

      const hasAnalysis = store.state.analysisResults && store.state.analysisResults[game.id];

      item.innerHTML = `
        <div class="game-item-main">
          <div class="game-item-opponent">
            <span class="game-item-name">${escapeHtml(game.opponentName || 'Unknown')}</span>
            <span class="game-item-rating">(${game.opponentRating || '?'})</span>
          </div>
          <div class="game-item-meta">
            <span class="badge ${resultClass}">${resultLabel}</span>
            <span class="game-item-tc">${formatTimeControl(game.timeClass)}</span>
            <span class="game-item-date">${formatDate(game.date)}</span>
            ${hasAnalysis ? '<span class="game-item-analyzed" title="Analyzed">📊</span>' : ''}
          </div>
        </div>
        <span class="game-item-arrow">›</span>
      `;

      listItems.appendChild(item);
    });
  }

  // ── Event delegation for game clicks ───────────────────────────
  function onListClick(e) {
    const item = e.target.closest('.game-item');
    if (!item) return;
    const gameId = item.dataset.gameId;
    store.setState({ currentGameId: gameId });
    window.location.hash = '#review';
  }
  listItems.addEventListener('click', onListClick);

  // ── Analyze All ────────────────────────────────────────────────
  async function onAnalyzeAll() {
    const allGames = store.state.filteredGames || store.state.games || [];
    if (allGames.length === 0) return;

    overlay.style.display = '';
    modalActions.style.display = 'none';
    modalTitle.textContent = 'Analyzing Games';
    modalText.textContent = 'Starting analysis…';
    progressFill.style.width = '0%';
    modalSub.textContent = '';

    /** Accumulated results for puzzle generation at the end */
    const allResults = [];

    // Separate already-analyzed games from unanalyzed ones
    const alreadyCount = allGames.filter(g => store.state.analysisResults?.[g.id]).length;
    const unanalyzedGames = allGames.filter(g => !store.state.analysisResults?.[g.id]);
    const totalCount = allGames.length;

    // Build results from already-analyzed games for puzzle generation
    for (const game of allGames) {
      if (store.state.analysisResults?.[game.id]) {
        allResults.push({
          gameId: game.id,
          game,
          moves: store.state.analysisResults[game.id],
        });
      }
    }

    // If all games are already analyzed, show complete immediately
    if (unanalyzedGames.length === 0) {
      const puzzles = analyzer.generatePuzzles(allResults, store.state.username);
      store.setState({ puzzles });
      progressFill.style.width = '100%';
      modalTitle.textContent = 'Analysis Complete';
      modalText.textContent = `All ${totalCount} game${totalCount !== 1 ? 's' : ''} already analyzed — ${puzzles.length} puzzle${puzzles.length !== 1 ? 's' : ''} available.`;
      modalSub.textContent = '';
      modalActions.style.display = '';
      return;
    }

    // Pre-fill progress to reflect already-analyzed portion
    if (alreadyCount > 0) {
      progressFill.style.width = `${Math.round((alreadyCount / totalCount) * 100)}%`;
      modalText.textContent = `${alreadyCount} of ${totalCount} games already analyzed, analyzing remaining…`;
    }

    try {
      await stockfish.init();
      const results = await analyzer.analyzeGames(unanalyzedGames, store.state.username, 14, (progress) => {
        if (destroyed) return;
        const { gamesAnalyzed, totalGames, currentGameIndex, movesAnalyzed, totalMoves, completedGame } = progress;

        // Save each game's analysis immediately when it finishes
        if (completedGame && completedGame.gameId) {
          const moves = completedGame.moves;
          if (moves && moves.length > 0) {
            store.saveAnalysis(completedGame.gameId, moves);
          }
          const currentResults = { ...store.state.analysisResults };
          currentResults[completedGame.gameId] = moves || [];
          store.setState({ analysisResults: currentResults });
          allResults.push(completedGame);
        }

        // Progress: already-analyzed games + completed games + fraction through current game
        const baseProgress = currentGameIndex != null ? currentGameIndex : gamesAnalyzed;
        const moveFraction = totalMoves > 0 ? movesAnalyzed / totalMoves : 0;
        const effectiveProgress = alreadyCount + baseProgress + moveFraction;
        const gamePct = totalCount > 0
          ? Math.round((effectiveProgress / totalCount) * 100)
          : 0;
        progressFill.style.width = `${Math.min(100, gamePct)}%`;

        const displayIndex = alreadyCount + (currentGameIndex != null ? currentGameIndex : gamesAnalyzed);
        if (currentGameIndex != null) {
          modalText.textContent = `Analyzing game ${displayIndex + 1} of ${totalCount}`;
        } else {
          modalText.textContent = `${displayIndex} of ${totalCount} games analyzed`;
        }
        modalSub.textContent = totalMoves > 0 ? `Move ${movesAnalyzed} / ${totalMoves}` : '';
      });

      if (destroyed) return;

      // Generate puzzles from all completed analysis
      const resultsForPuzzles = allResults.length > 0 ? allResults : results;
      const puzzles = analyzer.generatePuzzles(resultsForPuzzles, store.state.username);
      store.setState({ puzzles });

      progressFill.style.width = '100%';
      modalTitle.textContent = 'Analysis Complete';
      const analyzedCount = allResults.length;
      modalText.textContent = `Analyzed ${analyzedCount} game${analyzedCount !== 1 ? 's' : ''} — ${puzzles.length} puzzle${puzzles.length !== 1 ? 's' : ''} generated.`;
      modalSub.textContent = '';
      modalActions.style.display = '';
    } catch (err) {
      if (!destroyed) {
        console.error('[gameList] analysis error', err);
        // Partial results were already saved incrementally
        const partialCount = allResults.length - alreadyCount;
        modalTitle.textContent = 'Analysis Interrupted';
        modalText.textContent = partialCount > 0
          ? `Saved analysis for ${partialCount} of ${unanalyzedGames.length} remaining games before interruption.`
          : err.message || 'An error occurred during analysis.';
        modalActions.style.display = '';
        startTrainingBtn.style.display = 'none';
      }
    }
  }
  analyzeAllBtn.addEventListener('click', onAnalyzeAll);

  // ── Overlay buttons ────────────────────────────────────────────
  function onStartTraining() {
    overlay.style.display = 'none';
    window.location.hash = '#train';
  }
  function onCloseOverlay() {
    overlay.style.display = 'none';
    renderGames(store.state.filteredGames || store.state.games);
  }
  startTrainingBtn.addEventListener('click', onStartTraining);
  closeBtn.addEventListener('click', onCloseOverlay);

  // ── Store subscriptions ────────────────────────────────────────
  unsubs.push(store.on('filteredGames', renderGames));
  unsubs.push(store.on('games', (games) => {
    if (!store.state.filteredGames) renderGames(games);
  }));

  // Initial render
  renderGames(store.state.filteredGames || store.state.games || []);

  return {
    destroy() {
      destroyed = true;
      unsubs.forEach(fn => fn && fn());
      listItems.removeEventListener('click', onListClick);
      analyzeAllBtn.removeEventListener('click', onAnalyzeAll);
      startTrainingBtn.removeEventListener('click', onStartTraining);
      closeBtn.removeEventListener('click', onCloseOverlay);
      filtersComponent.destroy();
      section.remove();
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
