// ── Move List Component ──────────────────────────────────────────
export function createMoveList(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'move-list';
  wrapper.id = 'move-list';
  container.appendChild(wrapper);

  let moves = [];
  let activeIndex = -1;
  let clickCallback = null;

  // ── Render ─────────────────────────────────────────────────────
  function render() {
    wrapper.innerHTML = '';

    if (moves.length === 0) {
      wrapper.innerHTML = '<div class="move-list-empty">No moves</div>';
      return;
    }

    // Render as rows: move number | white move | black move
    const table = document.createElement('div');
    table.className = 'move-list-table';

    for (let i = 0; i < moves.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-list-row';

      // Move number
      const num = document.createElement('span');
      num.className = 'move-number';
      num.textContent = `${Math.floor(i / 2) + 1}.`;
      row.appendChild(num);

      // White move
      const whiteMove = moves[i];
      const whiteEl = document.createElement('span');
      whiteEl.className = buildMoveClass(i, whiteMove);
      whiteEl.dataset.moveIndex = String(i);
      whiteEl.id = `move-${i}`;
      whiteEl.textContent = whiteMove.san;
      row.appendChild(whiteEl);

      // Black move (if exists)
      if (i + 1 < moves.length) {
        const blackMove = moves[i + 1];
        const blackEl = document.createElement('span');
        blackEl.className = buildMoveClass(i + 1, blackMove);
        blackEl.dataset.moveIndex = String(i + 1);
        blackEl.id = `move-${i + 1}`;
        blackEl.textContent = blackMove.san;
        row.appendChild(blackEl);
      } else {
        // Empty cell for alignment
        const emptyEl = document.createElement('span');
        emptyEl.className = 'move placeholder';
        row.appendChild(emptyEl);
      }

      table.appendChild(row);
    }

    wrapper.appendChild(table);
  }

  function buildMoveClass(index, move) {
    const classes = ['move'];
    if (index === activeIndex) classes.push('active');
    if (move.classification) {
      const cls = move.classification.toLowerCase();
      if (['blunder', 'mistake', 'inaccuracy'].includes(cls)) {
        classes.push(cls);
      }
    }
    return classes.join(' ');
  }

  // ── Update active ──────────────────────────────────────────────
  function updateActive(newIndex) {
    // Remove old active
    if (activeIndex >= 0) {
      const oldEl = wrapper.querySelector(`#move-${activeIndex}`);
      if (oldEl) oldEl.classList.remove('active');
    }
    activeIndex = newIndex;
    // Add new active
    if (activeIndex >= 0) {
      const newEl = wrapper.querySelector(`#move-${activeIndex}`);
      if (newEl) newEl.classList.add('active');
    }
  }

  // ── Event delegation ──────────────────────────────────────────
  function onClick(e) {
    const moveEl = e.target.closest('.move:not(.placeholder)');
    if (!moveEl || moveEl.dataset.moveIndex == null) return;
    const idx = parseInt(moveEl.dataset.moveIndex, 10);
    if (!isNaN(idx) && clickCallback) {
      clickCallback(idx);
    }
  }
  wrapper.addEventListener('click', onClick);

  // ── Auto-scroll ────────────────────────────────────────────────
  function scrollToMove(index) {
    if (index < 0) return;
    const el = wrapper.querySelector(`#move-${index}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  // ── API ────────────────────────────────────────────────────────
  return {
    setMoves(newMoves) {
      moves = newMoves || [];
      activeIndex = -1;
      render();
    },

    setActiveIndex(index) {
      updateActive(index);
    },

    onMoveClick(callback) {
      clickCallback = callback;
    },

    scrollToMove,

    destroy() {
      wrapper.removeEventListener('click', onClick);
      wrapper.remove();
    },
  };
}
