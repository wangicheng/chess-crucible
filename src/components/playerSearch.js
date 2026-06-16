// ── Player Search Component ──────────────────────────────────────
import { store } from '../stores/gameStore.js';
import { chesscom } from '../services/chesscom.js';

const RECENT_KEY = 'chess-crucible-recent-searches';
const MAX_RECENT = 5;

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecentSearch(username) {
  let recent = getRecentSearches().filter(u => u.toLowerCase() !== username.toLowerCase());
  recent.unshift(username);
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}

export function createPlayerSearch(container) {
  const section = document.createElement('section');
  section.className = 'player-search animate-fadeInUp';
  section.id = 'player-search-view';

  section.innerHTML = `
    <div class="search-hero">
      <h1 class="search-hero-title" id="search-title">Analyze Your Chess Games</h1>
      <p class="search-hero-subtitle" id="search-subtitle">
        Enter your Chess.com username to download and analyze your games
      </p>
      <form class="search-form" id="search-form" autocomplete="off">
        <div class="search-input-wrapper">
          <input
            type="text"
            class="input input-lg search-input"
            id="search-input"
            placeholder="Chess.com username…"
            spellcheck="false"
            autocomplete="off"
          />
          <button type="submit" class="btn btn-primary search-go-btn" id="search-go-btn">
            Go →
          </button>
        </div>
      </form>
      <div class="search-status" id="search-status"></div>
      <div class="recent-searches" id="recent-searches"></div>
    </div>
  `;

  container.appendChild(section);

  const form = section.querySelector('#search-form');
  const input = section.querySelector('#search-input');
  const goBtn = section.querySelector('#search-go-btn');
  const statusEl = section.querySelector('#search-status');
  const recentEl = section.querySelector('#recent-searches');

  let aborted = false;

  // ── Render recent searches ─────────────────────────────────────
  function renderRecent() {
    const recent = getRecentSearches();
    if (recent.length === 0) {
      recentEl.innerHTML = '';
      return;
    }
    recentEl.innerHTML = `<span class="recent-label">Recent:</span>`;
    recent.forEach(name => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'pill';
      pill.id = `recent-${name}`;
      pill.textContent = name;
      pill.addEventListener('click', () => {
        input.value = name;
        startSearch(name);
      });
      recentEl.appendChild(pill);
    });
  }

  // ── Show status ────────────────────────────────────────────────
  function showProgress(text, percent) {
    statusEl.innerHTML = `
      <div class="search-progress animate-fadeIn">
        <div class="spinner" id="search-spinner"></div>
        <p class="search-progress-text" id="search-progress-text">${text}</p>
        ${percent != null ? `
          <div class="progress" id="search-progress-bar">
            <div class="progress-fill" style="width:${percent}%"></div>
          </div>
        ` : ''}
      </div>
    `;
  }

  function showError(message) {
    statusEl.innerHTML = `
      <div class="search-error animate-fadeIn">
        <span class="search-error-icon">⚠️</span>
        <p class="search-error-text" id="search-error-text">${message}</p>
      </div>
    `;
  }

  function clearStatus() {
    statusEl.innerHTML = '';
  }

  // ── Search handler ─────────────────────────────────────────────
  async function startSearch(username) {
    if (!username.trim()) return;
    username = username.trim();

    aborted = false;
    input.disabled = true;
    goBtn.disabled = true;
    clearStatus();
    showProgress('Connecting to Chess.com…', null);

    try {
      const games = await chesscom.fetchPlayerGames(username, (progress) => {
        if (aborted) return;
        const { loaded, total } = progress;
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        showProgress(`Downloading games… ${loaded}${total ? ` / ${total}` : ''}`, pct);
      });

      if (aborted) return;

      if (!games || games.length === 0) {
        showError('No games found for this player. Check the username and try again.');
        return;
      }

      showProgress(`Loaded ${games.length} games!`, 100);

      // Save to store and IndexedDB (games are already normalized by fetchPlayerGames)
      games.sort((a, b) => new Date(b.date) - new Date(a.date));
      store.setState({ games, username });
      await store.saveGames(games);

      // Restore any previously saved analysis from IndexedDB
      const restored = await store.restoreAnalysisForGames();
      if (restored) {
        console.log(`Restored analysis for ${Object.keys(store.state.analysisResults).length} games`);
      }

      store.applyFilters();

      // Persist recent search
      saveRecentSearch(username);

      // Navigate to games view
      window.location.hash = '#games';
    } catch (err) {
      if (!aborted) {
        console.error('[playerSearch]', err);
        if (err.message && err.message.includes('404')) {
          showError(`Player "${username}" not found on Chess.com. Check the spelling and try again.`);
        } else {
          showError(`Failed to fetch games: ${err.message || 'Unknown error'}`);
        }
      }
    } finally {
      if (!aborted) {
        input.disabled = false;
        goBtn.disabled = false;
      }
    }
  }

  // ── Events ─────────────────────────────────────────────────────
  function onSubmit(e) {
    e.preventDefault();
    startSearch(input.value);
  }
  form.addEventListener('submit', onSubmit);

  // Focus input on mount
  requestAnimationFrame(() => input.focus());

  // Render initial recent list
  renderRecent();

  return {
    destroy() {
      aborted = true;
      form.removeEventListener('submit', onSubmit);
      section.remove();
    },
  };
}
