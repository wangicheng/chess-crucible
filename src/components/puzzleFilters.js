// ── Puzzle Filters Component ────────────────────────────────────
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

const SEVERITY_LEVELS = [
  { key: 'all', label: 'All', severity: ['inaccuracy', 'mistake', 'blunder'] },
  { key: 'mistake', label: 'Mistakes+', severity: ['mistake', 'blunder'] },
  { key: 'blunder', label: 'Blunders', severity: ['blunder'] },
];

const EVAL_BEFORE_OPTIONS = [
  { key: 'any', label: 'All' },
  { key: 'advantage_or_equal', label: 'Up / Even' },
  { key: 'advantage', label: 'Up' },
];

const EVAL_AFTER_OPTIONS = [
  { key: 'any', label: 'All' },
  { key: 'equal_or_disadvantage', label: 'Even / Down' },
  { key: 'disadvantage', label: 'Down' },
];

export function createPuzzleFilters(container) {
  const panel = document.createElement('div');
  panel.className = 'filters-panel';
  panel.id = 'puzzle-filters-panel';

  panel.innerHTML = `
    <button class="filters-toggle btn btn-ghost" id="puzzle-filters-toggle-btn">
      <span>Filters</span>
      <span class="badge" id="puzzle-filters-active-count" style="display:none">0</span>
      <span class="filters-toggle-icon" id="puzzle-filters-toggle-icon">▾</span>
    </button>
    <div class="filters-body" id="puzzle-filters-body">

      <!-- Severity -->
      <fieldset class="filter-section" id="pfilter-severity-section">
        <legend class="filter-section-title">Severity</legend>
        <div class="filter-pills" id="pfilter-severity-pills">
          ${SEVERITY_LEVELS.map(s => `
            <button type="button" class="pill${s.key === 'all' ? ' active' : ''}" id="pfilter-severity-${s.key}" data-severity="${s.key}">
              ${s.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Eval Before Mistake -->
      <fieldset class="filter-section" id="pfilter-evalbefore-section">
        <legend class="filter-section-title">Position Before</legend>
        <div class="filter-pills" id="pfilter-evalbefore-pills">
          ${EVAL_BEFORE_OPTIONS.map(o => `
            <button type="button" class="pill${o.key === 'any' ? ' active' : ''}" id="pfilter-evalbefore-${o.key}" data-evalbefore="${o.key}">
              ${o.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Eval After Mistake -->
      <fieldset class="filter-section" id="pfilter-evalafter-section">
        <legend class="filter-section-title">Position After</legend>
        <div class="filter-pills" id="pfilter-evalafter-pills">
          ${EVAL_AFTER_OPTIONS.map(o => `
            <button type="button" class="pill${o.key === 'any' ? ' active' : ''}" id="pfilter-evalafter-${o.key}" data-evalafter="${o.key}">
              ${o.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Time Control -->
      <fieldset class="filter-section" id="pfilter-tc-section">
        <legend class="filter-section-title">Time Control</legend>
        <div class="filter-pills" id="pfilter-tc-pills">
          ${TIME_CONTROLS.map(tc => `
            <button type="button" class="pill" id="pfilter-tc-${tc.key}" data-tc="${tc.key}">
              ${tc.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Date Range -->
      <fieldset class="filter-section" id="pfilter-date-section">
        <legend class="filter-section-title">Date Range</legend>
        <div class="filter-row">
          <label class="filter-label" for="pfilter-date-from">From</label>
          <input type="month" class="input" id="pfilter-date-from" />
        </div>
        <div class="filter-row">
          <label class="filter-label" for="pfilter-date-to">To</label>
          <input type="month" class="input" id="pfilter-date-to" />
        </div>
      </fieldset>

      <!-- Rating Range -->
      <fieldset class="filter-section" id="pfilter-rating-section">
        <legend class="filter-section-title">Rating Range</legend>
        <div class="filter-row-inline">
          <input type="number" class="input" id="pfilter-rating-min" placeholder="Min" min="0" max="4000" step="50" />
          <span class="filter-dash">–</span>
          <input type="number" class="input" id="pfilter-rating-max" placeholder="Max" min="0" max="4000" step="50" />
        </div>
      </fieldset>

      <!-- Opponent Rating -->
      <fieldset class="filter-section" id="pfilter-opp-rating-section">
        <legend class="filter-section-title">Opponent Rating</legend>
        <div class="filter-row-inline">
          <input type="number" class="input" id="pfilter-opp-rating-min" placeholder="Min" min="0" max="4000" step="50" />
          <span class="filter-dash">–</span>
          <input type="number" class="input" id="pfilter-opp-rating-max" placeholder="Max" min="0" max="4000" step="50" />
        </div>
      </fieldset>

      <!-- Result -->
      <fieldset class="filter-section" id="pfilter-result-section">
        <legend class="filter-section-title">Result</legend>
        <div class="filter-pills" id="pfilter-result-pills">
          ${RESULTS.map(r => `
            <button type="button" class="pill active" id="pfilter-result-${r.key}" data-result="${r.key}">
              ${r.label}
            </button>
          `).join('')}
        </div>
      </fieldset>

      <!-- Actions -->
      <div class="filter-actions">
        <button class="btn btn-primary btn-sm" id="pfilter-apply-btn">Apply Filters</button>
        <button class="btn btn-ghost btn-sm" id="pfilter-clear-btn">Clear All</button>
      </div>
    </div>
  `;

  container.appendChild(panel);

  // ── Element references ─────────────────────────────────────────
  const toggleBtn = panel.querySelector('#puzzle-filters-toggle-btn');
  const toggleIcon = panel.querySelector('#puzzle-filters-toggle-icon');
  const body = panel.querySelector('#puzzle-filters-body');
  const activeCountBadge = panel.querySelector('#puzzle-filters-active-count');
  const applyBtn = panel.querySelector('#pfilter-apply-btn');
  const clearBtn = panel.querySelector('#pfilter-clear-btn');

  const severityPills = panel.querySelector('#pfilter-severity-pills');
  const evalBeforePills = panel.querySelector('#pfilter-evalbefore-pills');
  const evalAfterPills = panel.querySelector('#pfilter-evalafter-pills');
  const tcPills = panel.querySelector('#pfilter-tc-pills');
  const resultPills = panel.querySelector('#pfilter-result-pills');
  const dateFrom = panel.querySelector('#pfilter-date-from');
  const dateTo = panel.querySelector('#pfilter-date-to');
  const ratingMin = panel.querySelector('#pfilter-rating-min');
  const ratingMax = panel.querySelector('#pfilter-rating-max');
  const oppRatingMin = panel.querySelector('#pfilter-opp-rating-min');
  const oppRatingMax = panel.querySelector('#pfilter-opp-rating-max');

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

  // ── Severity pills (single-select) ────────────────────────────
  let selectedSeverity = 'all';
  function onSeverityClick(e) {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const key = pill.dataset.severity;
    if (key === selectedSeverity) return;
    severityPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    selectedSeverity = key;
    pill.classList.add('active');
  }
  severityPills.addEventListener('click', onSeverityClick);

  // ── Eval Before pills (single-select) ─────────────────────────
  let selectedEvalBefore = 'any';
  function onEvalBeforeClick(e) {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const key = pill.dataset.evalbefore;
    if (key === selectedEvalBefore) return;
    evalBeforePills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    selectedEvalBefore = key;
    pill.classList.add('active');
  }
  evalBeforePills.addEventListener('click', onEvalBeforeClick);

  // ── Eval After pills (single-select) ──────────────────────────
  let selectedEvalAfter = 'any';
  function onEvalAfterClick(e) {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    const key = pill.dataset.evalafter;
    if (key === selectedEvalAfter) return;
    evalAfterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    selectedEvalAfter = key;
    pill.classList.add('active');
  }
  evalAfterPills.addEventListener('click', onEvalAfterClick);

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
    if (selectedSeverity !== 'all') n++;
    if (selectedEvalBefore !== 'any') n++;
    if (selectedEvalAfter !== 'any') n++;
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
    const level = SEVERITY_LEVELS.find(s => s.key === selectedSeverity);
    store.setState({
      puzzleFilters: {
        severity: level ? level.severity : SEVERITY_LEVELS[0].severity,
        evalBefore: selectedEvalBefore,
        evalAfter: selectedEvalAfter,
      },
    });
    store.applyFilters();
    store.applyPuzzleFilters();
    updateActiveCount();
  }
  applyBtn.addEventListener('click', onApply);

  function onClear() {
    // Reset severity
    selectedSeverity = 'all';
    severityPills.querySelectorAll('.pill').forEach(p => {
      p.classList.toggle('active', p.dataset.severity === 'all');
    });

    // Reset eval before
    selectedEvalBefore = 'any';
    evalBeforePills.querySelectorAll('.pill').forEach(p => {
      p.classList.toggle('active', p.dataset.evalbefore === 'any');
    });

    // Reset eval after
    selectedEvalAfter = 'any';
    evalAfterPills.querySelectorAll('.pill').forEach(p => {
      p.classList.toggle('active', p.dataset.evalafter === 'any');
    });

    // Reset TC pills
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
    store.resetPuzzleFilters();
    updateActiveCount();
  }
  clearBtn.addEventListener('click', onClear);

  // ── Sync from store ────────────────────────────────────────────
  const unsubs = [];
  unsubs.push(store.on('filters', (filters) => {
    if (!filters) return;
    // Sync time controls
    selectedTC.clear();
    tcPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if (filters.timeClasses && filters.timeClasses.length > 0) {
      filters.timeClasses.forEach(tc => {
        selectedTC.add(tc);
        const pill = panel.querySelector(`#pfilter-tc-${tc}`);
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
      const pill = panel.querySelector(`#pfilter-result-${r.key}`);
      if (active) {
        selectedResults.add(r.key);
        if (pill) pill.classList.add('active');
      } else {
        if (pill) pill.classList.remove('active');
      }
    });

    updateActiveCount();
  }));

  unsubs.push(store.on('puzzleFilters', (pf) => {
    if (!pf) return;
    // Sync severity
    if (pf.severity) {
      severityPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      const level = SEVERITY_LEVELS.find(l =>
        l.severity.length === pf.severity.length &&
        l.severity.every(s => pf.severity.includes(s))
      );
      selectedSeverity = level ? level.key : 'all';
      const pill = panel.querySelector(`#pfilter-severity-${selectedSeverity}`);
      if (pill) pill.classList.add('active');
    }
    // Sync eval before
    if (pf.evalBefore) {
      evalBeforePills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      selectedEvalBefore = pf.evalBefore;
      const pill = panel.querySelector(`#pfilter-evalbefore-${pf.evalBefore}`);
      if (pill) pill.classList.add('active');
    }
    // Sync eval after
    if (pf.evalAfter) {
      evalAfterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      selectedEvalAfter = pf.evalAfter;
      const pill = panel.querySelector(`#pfilter-evalafter-${pf.evalAfter}`);
      if (pill) pill.classList.add('active');
    }
    updateActiveCount();
  }));

  // Initial sync with current store state
  const currentFilters = store.state.filters;
  if (currentFilters) {
    selectedTC.clear();
    tcPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    if (currentFilters.timeClasses && currentFilters.timeClasses.length > 0) {
      currentFilters.timeClasses.forEach(tc => {
        selectedTC.add(tc);
        const pill = panel.querySelector(`#pfilter-tc-${tc}`);
        if (pill) pill.classList.add('active');
      });
    }
    dateFrom.value = currentFilters.dateFrom || '';
    dateTo.value = currentFilters.dateTo || '';
    ratingMin.value = currentFilters.minElo != null ? currentFilters.minElo : '';
    ratingMax.value = currentFilters.maxElo != null ? currentFilters.maxElo : '';
    oppRatingMin.value = currentFilters.minOpponentElo != null ? currentFilters.minOpponentElo : '';
    oppRatingMax.value = currentFilters.maxOpponentElo != null ? currentFilters.maxOpponentElo : '';
    selectedResults.clear();
    resultPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    RESULTS.forEach(r => {
      const active = !currentFilters.results || currentFilters.results.includes(r.key);
      const pill = panel.querySelector(`#pfilter-result-${r.key}`);
      if (active) {
        selectedResults.add(r.key);
        if (pill) pill.classList.add('active');
      } else {
        if (pill) pill.classList.remove('active');
      }
    });
  }

  const currentPuzzleFilters = store.state.puzzleFilters;
  if (currentPuzzleFilters) {
    if (currentPuzzleFilters.severity) {
      severityPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      const level = SEVERITY_LEVELS.find(l =>
        l.severity.length === currentPuzzleFilters.severity.length &&
        l.severity.every(s => currentPuzzleFilters.severity.includes(s))
      );
      selectedSeverity = level ? level.key : 'all';
      const pill = panel.querySelector(`#pfilter-severity-${selectedSeverity}`);
      if (pill) pill.classList.add('active');
    }
    if (currentPuzzleFilters.evalBefore) {
      evalBeforePills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      selectedEvalBefore = currentPuzzleFilters.evalBefore;
      const pill = panel.querySelector(`#pfilter-evalbefore-${currentPuzzleFilters.evalBefore}`);
      if (pill) pill.classList.add('active');
    }
    if (currentPuzzleFilters.evalAfter) {
      evalAfterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      selectedEvalAfter = currentPuzzleFilters.evalAfter;
      const pill = panel.querySelector(`#pfilter-evalafter-${currentPuzzleFilters.evalAfter}`);
      if (pill) pill.classList.add('active');
    }
  }

  updateActiveCount();

  return {
    destroy() {
      unsubs.forEach(fn => fn && fn());
      toggleBtn.removeEventListener('click', onToggle);
      severityPills.removeEventListener('click', onSeverityClick);
      evalBeforePills.removeEventListener('click', onEvalBeforeClick);
      evalAfterPills.removeEventListener('click', onEvalAfterClick);
      tcPills.removeEventListener('click', onTcClick);
      resultPills.removeEventListener('click', onResultClick);
      applyBtn.removeEventListener('click', onApply);
      clearBtn.removeEventListener('click', onClear);
      panel.remove();
    },
  };
}
