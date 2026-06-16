// ── Main Entry Point ──────────────────────────────────────────────
// CSS imports (Vite handles these)
import './styles/index.css';
import './styles/board.css';
import './styles/components.css';
import './styles/animations.css';

// Chessground styles
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

import { store } from './stores/gameStore.js';
import { createApp } from './components/app.js';

// ── Route map ────────────────────────────────────────────────────
const VALID_VIEWS = new Set(['search', 'games', 'review', 'train', 'opening']);

function viewFromHash() {
  const raw = window.location.hash.replace('#', '').split('?')[0];
  return VALID_VIEWS.has(raw) ? raw : 'search';
}

// ── Bootstrap ────────────────────────────────────────────────────
async function boot() {
  await store.init();

  // Restore previous session from IndexedDB
  const restored = await store.tryRestoreSession();
  if (restored) {
    console.log(`[main] Restored session for ${restored} (${store.state.games.length} games)`);
  }

  const root = document.getElementById('app');
  if (!root) {
    console.error('[main] #app element not found');
    return;
  }

  // Set initial view:
  //   - from URL hash if valid
  //   - 'games' if session restored (skip search)
  //   - 'search' otherwise
  const hash = window.location.hash.replace('#', '').split('?')[0];
  const initialView = VALID_VIEWS.has(hash) ? hash : (restored ? 'games' : 'search');
  store.setState({ currentView: initialView });

  // Render root component
  const app = createApp(root);

  // Hash-based routing
  function onHashChange() {
    const view = viewFromHash();
    store.setState({ currentView: view });
  }

  window.addEventListener('hashchange', onHashChange);

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    window.removeEventListener('hashchange', onHashChange);
    app.destroy();
  });
}

boot();
