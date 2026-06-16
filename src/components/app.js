// ── App Root Component ───────────────────────────────────────────
import { store } from '../stores/gameStore.js';
import { createPlayerSearch } from './playerSearch.js';
import { createGameList } from './gameList.js';
import { createGameReview } from './gameReview.js';
import { createPuzzleTrainer } from './puzzleTrainer.js';
import { createOpeningTrainer } from './openingTrainer.js';

// ── Navbar ───────────────────────────────────────────────────────
function renderNavbar(container) {
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.id = 'main-navbar';

  const brand = document.createElement('a');
  brand.className = 'navbar-brand';
  brand.href = '#search';
  brand.id = 'navbar-brand';
  brand.textContent = '♚ Chess Crucible';

  const links = document.createElement('div');
  links.className = 'navbar-links';
  links.id = 'navbar-links';

  const navItems = [
    { view: 'search', label: 'Search', icon: '🔍', id: 'nav-search' },
    { view: 'games', label: 'Games', icon: '♟', id: 'nav-games' },
    { view: 'train', label: 'Train', icon: '🎯', id: 'nav-train' },
    { view: 'opening', label: 'Opening', icon: '📖', id: 'nav-opening' },
  ];

  navItems.forEach(({ view, label, icon, id }) => {
    const a = document.createElement('a');
    a.href = `#${view}`;
    a.className = 'nav-link';
    a.id = id;
    a.dataset.view = view;
    a.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>`;
    links.appendChild(a);
  });

  const userBadge = document.createElement('span');
  userBadge.className = 'navbar-user';
  userBadge.id = 'navbar-user';
  userBadge.style.display = 'none';

  nav.appendChild(brand);
  nav.appendChild(links);
  nav.appendChild(userBadge);
  container.appendChild(nav);

  function updateActive(view) {
    links.querySelectorAll('.nav-link').forEach(el => {
      el.classList.toggle('active', el.dataset.view === view);
    });
  }

  function updateUsername(username) {
    if (username) {
      userBadge.textContent = `👤 ${username}`;
      userBadge.style.display = '';
    } else {
      userBadge.style.display = 'none';
    }
  }

  return { updateActive, updateUsername };
}

// ── View factory map ─────────────────────────────────────────────
const VIEW_CREATORS = {
  search: createPlayerSearch,
  games: createGameList,
  review: createGameReview,
  train: createPuzzleTrainer,
  opening: createOpeningTrainer,
};

// ── App ──────────────────────────────────────────────────────────
export function createApp(container) {
  container.innerHTML = '';

  // Navbar
  const navbar = renderNavbar(container);

  // Main content area
  const main = document.createElement('main');
  main.className = 'main-content';
  main.id = 'main-content';
  container.appendChild(main);

  let currentComponent = null;
  const unsubs = [];

  function renderView(view) {
    // Destroy existing view
    if (currentComponent && currentComponent.destroy) {
      currentComponent.destroy();
    }
    main.innerHTML = '';
    currentComponent = null;

    // Update navbar
    navbar.updateActive(view);

    // Create new view
    const creator = VIEW_CREATORS[view];
    if (creator) {
      currentComponent = creator(main);
    } else {
      main.innerHTML = '<div class="empty-state">View not found</div>';
    }
  }

  // Subscribe to view changes
  unsubs.push(store.on('currentView', (view) => {
    renderView(view);
  }));

  // Subscribe to username changes
  unsubs.push(store.on('username', (username) => {
    navbar.updateUsername(username);
  }));

  // Initial render
  renderView(store.state.currentView || 'search');
  navbar.updateUsername(store.state.username);

  return {
    destroy() {
      unsubs.forEach(fn => fn && fn());
      if (currentComponent && currentComponent.destroy) {
        currentComponent.destroy();
      }
      container.innerHTML = '';
    },
  };
}
