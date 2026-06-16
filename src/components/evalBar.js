// ── Eval Bar Component ───────────────────────────────────────────
import { formatEval, evalToPercentage } from '../utils/format.js';

export function createEvalBar(container, orientation = 'white') {
  const bar = document.createElement('div');
  bar.className = 'eval-bar';
  bar.id = 'eval-bar';

  const fill = document.createElement('div');
  fill.className = 'eval-bar-fill';
  fill.id = 'eval-bar-fill';
  fill.style.height = '50%';

  const scoreLabel = document.createElement('div');
  scoreLabel.className = 'eval-bar-score';
  scoreLabel.id = 'eval-bar-score';
  scoreLabel.textContent = '0.0';

  bar.appendChild(fill);
  bar.appendChild(scoreLabel);
  container.appendChild(bar);

  if (orientation === 'black') {
    bar.classList.add('flipped');
  }

  function setOrientation(color) {
    bar.classList.toggle('flipped', color === 'black');
  }

  function setLoading() {
    bar.style.opacity = '0.5';
    scoreLabel.textContent = '...';
  }

  function setEval(evalObj) {
    if (!evalObj) return;
    
    bar.style.opacity = '1';

    const pct = evalToPercentage(evalObj);
    const isFlipped = bar.classList.contains('flipped');
    const fillPct = isFlipped ? 100 - pct : pct;

    fill.style.height = `${fillPct}%`;
    scoreLabel.textContent = formatEval(evalObj);

    if (pct > 60) {
      scoreLabel.style.bottom = '';
      scoreLabel.style.top = `${100 - pct + 2}%`;
    } else if (pct < 40) {
      scoreLabel.style.top = '';
      scoreLabel.style.bottom = `${pct + 2}%`;
    } else {
      scoreLabel.style.top = '';
      scoreLabel.style.bottom = '48%';
    }
  }

  function destroy() {
    bar.remove();
  }

  return { setEval, setLoading, setOrientation, destroy };
}
