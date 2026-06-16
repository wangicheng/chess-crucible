// ── Game Filters Component ───────────────────────────────────────
import { store } from '../stores/gameStore.js';

const TIME_CONTROLS = [
  { key: 'bullet', label: 'Bullet' },
  { key: 'blitz', label: 'Blitz' },
  { key: 'rapid', label: 'Rapid' },
  { key: 'daily', label: 'Daily' },
];

const RESULTS = [
  { key: 'win', label: 'Win' },
  { key: 'loss', label: 'Loss' },
  { key: 'draw', label: 'Draw' },
];

export function createGameFilters(container) {
  const panel = document.createElement('div');
  panel.className = 'filters-panel';
  panel.id = 'game-filters-panel';

  panel.innerHTML = `
    <button class="filters-toggle btn btn-ghost" id="filters-toggle-btn">
      <span>Filters</span>
      <span class="badge" id="filters-active-count" style="display:none">0</span>
      <span class="filters-toggle-icon" id="filters-toggle-icon">▾</span>
    </button>
    <div class="filters-body" id="filters-body">

      <!-- Time Control -->
      <fieldset class="filter-section" id="filter-tc-section">
        <legend class="filter-section-title">Time Control</legend>
        <div class="filter-pills" id="filter-tc-pills">
          ${TIME_CONTROLS.map(tc => `
            <button type="button" class="pill" id="filter-tc-${tc.key}" data-tc="${tc.key}">
              ${tc.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Date Range -->
      <fieldset class="filter-section" id="filter-date-section">
        <legend class="filter-section-title">Date Range</legend>
        <div class="filter-row">
          <label class="filter-label" for="filter-date-from">From</label>
          <input type="month" class="input" id="filter-date-from" />
        </div>
        <div class="filter-row">
          <label class="filter-label" for="filter-date-to">To</label>
          <input type="month" class="input" id="filter-date-to" />
        </div>
      </fieldset>

      <!-- Rating Range -->
      <fieldset class="filter-section" id="filter-rating-section">
        <legend class="filter-section-title">Rating Range</legend>
        <div class="filter-row-inline">
          <input type="number" class="input" id="filter-rating-min" placeholder="Min" min="0" max="4000" step="50" />
          <span class="filter-dash">–</span>
          <input type="number" class="input" id="filter-rating-max" placeholder="Max" min="0" max="4000" step="50" />
        </div>
      </fieldset>

      <!-- Opponent Rating -->
      <fieldset class="filter-section" id="filter-opp-rating-section">
        <legend class="filter-section-title">Opponent Rating</legend>
        <div class="filter-row-inline">
          <input type="number" class="input" id="filter-opp-rating-min" placeholder="Min" min="0" max="4000" step="50" />
          <span class="filter-dash">–</span>
          <input type="number" class="input" id="filter-opp-rating-max" placeholder="Max" min="0" max="4000" step="50" />
        </div>
      </fieldset>

      <!-- Result -->
      <fieldset class="filter-section" id="filter-result-section">
        <legend class="filter-section-title">Result</legend>
        <div class="filter-pills" id="filter-result-pills">
          ${RESULTS.map(r => `
            <button type="button" class="pill active" id="filter-result-${r.key}" data-result="${r.key}">
              ${r.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Actions -->
      <div class="filter-actions">
        <button class="btn btn-primary btn-sm" id="filters-apply-btn">Apply Filters</button>
        <button class="btn btn-ghost btn-sm" id="filters-clear-btn">Clear All</button>
      </div>
    </div>
  `;

  container.appendChild(panel);

  // ── Element references ─────────────────────────────────────────
  const toggleBtn = panel.querySelector('#filters-toggle-btn');
  const toggleIcon = panel.querySelector('#filters-toggle-icon');
  const body = panel.querySelector('#filters-body');
  const activeCountBadge = panel.querySelector('#filters-active-count');
  const applyBtn = panel.querySelector('#filters-apply-btn');
  const clearBtn = panel.querySelector('#filters-clear-btn');

  const tcPills = panel.querySelector('#filter-tc-pills');
  const resultPills = panel.querySelector('#filter-result-pills');
  const dateFrom = panel.querySelector('#filter-date-from');
  const dateTo = panel.querySelector('#filter-date-to');
  const ratingMin = panel.querySelector('#filter-rating-min');
  const ratingMax = panel.querySelector('#filter-rating-max');
  const oppRatingMin = panel.querySelector('#filter-opp-rating-min');
  const oppRatingMax = panel.querySelector('#filter-opp-rating-max');

  let collapsed = window.innerWidth < 768;
  body.style.display = collapsed ? 'none' : '';
  toggleIcon.textContent = collapsed ? '▸' : '▾';

  // ── Toggle ─────────────────────────────────────────────────────
  function onToggle() {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : '';
    toggleIcon.textContent = collapsed ? '▸' : '▾';
  }
  toggleBtn.addEventListener('click', onToggle);

  // ── Time control pills ─────────────────────────────────────────
  const selectedTC = new Set();
  function onTcClick(e) {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const key = pill.dataset.tc;
    if (selectedTC.has(key)) {
      selectedTC.delete(key);
      pill.classList.remove('active');
    } else {
      selectedTC.add(key);
      pill.classList.add('active');
    }
  }
  tcPills.addEventListener('click', onTcClick);

  // ── Result pills ────────────────────────────────────────────────
  const selectedResults = new Set(RESULTS.map(r => r.key));
  function onResultClick(e) {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const key = pill.dataset.result;
    if (selectedResults.has(key)) {
      if (selectedResults.size <= 1) return;
      selectedResults.delete(key);
      pill.classList.remove('active');
    } else {
      selectedResults.add(key);
      pill.classList.add('active');
    }
  }
  resultPills.addEventListener('click', onResultClick);

  // ── Gather filters ─────────────────────────────────────────────
  function gatherFilters() {
    const results = [...selectedResults];

    return {
      timeClasses: selectedTC.size > 0 ? [...selectedTC] : [],
      dateFrom: dateFrom.value || null,
      dateTo: dateTo.value || null,
      minElo: ratingMin.value ? Number(ratingMin.value) : null,
      maxElo: ratingMax.value ? Number(ratingMax.value) : null,
      minOpponentElo: oppRatingMin.value ? Number(oppRatingMin.value) : null,
      maxOpponentElo: oppRatingMax.value ? Number(oppRatingMax.value) : null,
      results: results.length < RESULTS.length ? results : [],
      ratedOnly: false,
    };
  }

  function countActive(filters) {
    let n = 0;
    if (filters.timeClasses && filters.timeClasses.length > 0) n++;
    if (filters.dateFrom || filters.dateTo) n++;
    if (filters.minElo != null || filters.maxElo != null) n++;
    if (filters.minOpponentElo != null || filters.maxOpponentElo != null) n++;
    if (filters.results && filters.results.length > 0 && filters.results.length < RESULTS.length) n++;
    return n;
  }

  function updateActiveCount() {
    const f = gatherFilters();
    const n = countActive(f);
    if (n > 0) {
      activeCountBadge.textContent = String(n);
      activeCountBadge.style.display = '';
    } else {
      activeCountBadge.style.display = 'none';
    }
  }

  // ── Apply / Clear ──────────────────────────────────────────────
  function onApply() {
    const filters = gatherFilters();
    store.setState({ filters });
    store.applyFilters();
    updateActiveCount();
  }
  applyBtn.addEventListener('click', onApply);

  function onClear() {
    // Reset pills
    selectedTC.clear();
    tcPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));

    // Reset inputs
    dateFrom.value = '';
    dateTo.value = '';
    ratingMin.value = '';
    ratingMax.value = '';
    oppRatingMin.value = '';
    oppRatingMax.value = '';

    // Reset result pills
    selectedResults.clear();
    resultPills.querySelectorAll('.pill').forEach(p => {
      selectedResults.add(p.dataset.result);
      p.classList.add('active');
    });

    store.resetFilters();
    updateActiveCount();
  }
  clearBtn.addEventListener('click', onClear);

  // ── Sync from store (if filters already set) ───────────────────
  const unsubs = [];
  unsubs.push(store.on('filters', (filters) => {
    if (!filters) return;
    // Sync time controls
    selectedTC.clear();
    tcPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if (filters.timeClasses && filters.timeClasses.length > 0) {
      filters.timeClasses.forEach(tc => {
        selectedTC.add(tc);
        const pill = panel.querySelector(`#filter-tc-${tc}`);
        if (pill) pill.classList.add('active');
      });
    }

    // Sync dates
    dateFrom.value = filters.dateFrom || '';
    dateTo.value = filters.dateTo || '';

    // Sync ratings
    ratingMin.value = filters.minElo != null ? filters.minElo : '';
    ratingMax.value = filters.maxElo != null ? filters.maxElo : '';
    oppRatingMin.value = filters.minOpponentElo != null ? filters.minOpponentElo : '';
    oppRatingMax.value = filters.maxOpponentElo != null ? filters.maxOpponentElo : '';

    // Sync results
    selectedResults.clear();
    resultPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    RESULTS.forEach(r => {
      const active = !filters.results || filters.results.includes(r.key);
      const pill = panel.querySelector(`#filter-result-${r.key}`);
      if (active) {
        selectedResults.add(r.key);
        if (pill) pill.classList.add('active');
      } else {
        if (pill) pill.classList.remove('active');
      }
    });

    updateActiveCount();
  }));

  // Initial count
  updateActiveCount();

  return {
    destroy() {
      unsubs.forEach(fn => fn && fn());
      toggleBtn.removeEventListener('click', onToggle);
      tcPills.removeEventListener('click', onTcClick);
      resultPills.removeEventListener('click', onResultClick);
      applyBtn.removeEventListener('click', onApply);
      clearBtn.removeEventListener('click', onClear);
      panel.remove();
    },
  };
}
