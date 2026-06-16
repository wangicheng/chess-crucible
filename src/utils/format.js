/**
 * @fileoverview Formatting utility functions for the chess analysis UI.
 * Provides formatters for evaluation scores, dates, time controls,
 * ratings, relative time, and eval bar percentages.
 * @module utils/format
 */

/**
 * @typedef {Object} EvalObj
 * @property {number} score - Evaluation in centipawns from WHITE's perspective
 * @property {number|null} mate - Moves to mate (positive = white mates, negative = black mates)
 */

/**
 * Format an engine evaluation object into a human-readable string.
 *
 * - Centipawn scores are converted to pawns with 1 decimal place (e.g., '+1.5', '-0.3')
 * - Mate scores use 'M' notation (e.g., 'M3', '-M5')
 * - Equal position shows '0.0'
 *
 * @param {EvalObj} evalObj - Evaluation object with score and mate properties
 * @returns {string} Formatted evaluation string
 *
 * @example
 * formatEval({ score: 150, mate: null })  // '+1.5'
 * formatEval({ score: -30, mate: null })  // '-0.3'
 * formatEval({ score: 100000, mate: 3 }) // 'M3'
 * formatEval({ score: -100000, mate: -5 }) // '-M5'
 */
export function formatEval(evalObj) {
  if (!evalObj && evalObj !== 0) return '0.0';

  // Handle primitive number (interpret as centipawns)
  if (typeof evalObj === 'number') {
    const pawns = evalObj / 100;
    const sign = pawns > 0 ? '+' : '';
    return `${sign}${pawns.toFixed(1)}`;
  }

  // Handle mate scores
  if (evalObj.mate != null) {
    if (evalObj.mate > 0) {
      return `M${evalObj.mate}`;
    } else if (evalObj.mate < 0) {
      return `-M${Math.abs(evalObj.mate)}`;
    } else {
      // mate in 0 = checkmate
      return 'M0';
    }
  }

  // Centipawn score
  const score = evalObj.score || 0;
  const pawns = score / 100;
  const sign = pawns > 0 ? '+' : '';
  return `${sign}${pawns.toFixed(1)}`;
}

/**
 * Format a Date object into a readable date string.
 *
 * @param {Date|string|number} date - Date to format
 * @returns {string} Formatted date string (e.g., 'Jan 15, 2024')
 *
 * @example
 * formatDate(new Date(2024, 0, 15)) // 'Jan 15, 2024'
 */
export function formatDate(date) {
  if (!date) return '';

  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) return '';

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Format a time class into an emoji + label string.
 *
 * @param {string} timeClass - Time class identifier: 'bullet', 'blitz', 'rapid', 'daily'
 * @returns {string} Formatted time class with emoji
 *
 * @example
 * formatTimeControl('blitz')  // '🔥 Blitz'
 * formatTimeControl('rapid')  // '⏱️ Rapid'
 */
export function formatTimeControl(timeClass) {
  const timeClassMap = {
    bullet: '⚡ Bullet',
    blitz: '🔥 Blitz',
    rapid: '⏱️ Rapid',
    daily: '📅 Daily',
  };

  if (!timeClass) return '♟️ Unknown';

  return timeClassMap[timeClass.toLowerCase()] || `♟️ ${timeClass.charAt(0).toUpperCase() + timeClass.slice(1)}`;
}

/**
 * Format a rating number into a display string.
 * Adds commas for thousands separators if needed.
 *
 * @param {number|string} rating - Player rating
 * @returns {string} Formatted rating string
 *
 * @example
 * formatRating(1500)  // '1500'
 * formatRating(2800)  // '2800'
 * formatRating(0)     // '?'
 */
export function formatRating(rating) {
  if (rating == null || rating === 0) return '?';

  const num = typeof rating === 'string' ? parseInt(rating, 10) : rating;

  if (isNaN(num)) return '?';

  // Add commas for thousands (rare in chess ratings but handles edge cases)
  return num.toLocaleString('en-US');
}

/**
 * Convert a Date into a relative time string.
 *
 * @param {Date|string|number} date - Date to convert
 * @returns {string} Relative time string (e.g., '3 days ago', '2 months ago')
 *
 * @example
 * timeAgo(new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)) // '3 days ago'
 * timeAgo(new Date(Date.now() - 60 * 1000))                // '1 minute ago'
 */
export function timeAgo(date) {
  if (!date) return '';

  const d = date instanceof Date ? date : new Date(date);

  if (isNaN(d.getTime())) return '';

  const now = Date.now();
  const diffMs = now - d.getTime();

  // Handle future dates
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30.44); // average days per month
  const years = Math.floor(days / 365.25);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (weeks < 5) return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''} ago`;
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Convert an evaluation object to a percentage for the eval bar display.
 *
 * Uses a sigmoid-like mapping so that:
 * - 50 = equal position
 * - 100 = white is completely winning
 * - 0 = black is completely winning
 *
 * The sigmoid curve is: 50 + 50 * (2 / (1 + exp(-evalCp / 400)) - 1)
 * This gives a smooth curve where ±4 pawns maps to roughly ±45% bar fill.
 *
 * @param {EvalObj} evalObj - Evaluation object
 * @returns {number} Percentage from 0 to 100 (50 = equal)
 *
 * @example
 * evalToPercentage({ score: 0, mate: null })     // 50
 * evalToPercentage({ score: 100, mate: null })   // ~56.2
 * evalToPercentage({ score: 100000, mate: 3 })   // 100
 * evalToPercentage({ score: -100000, mate: -3 }) // 0
 */
export function evalToPercentage(evalObj) {
  if (!evalObj && evalObj !== 0) return 50;

  // Handle primitive number
  if (typeof evalObj === 'number') {
    return _sigmoidPercentage(evalObj);
  }

  // Handle mate scores
  if (evalObj.mate != null) {
    if (evalObj.mate > 0) return 100; // White is delivering mate
    if (evalObj.mate < 0) return 0;   // Black is delivering mate
    // mate === 0 means checkmate on the board. We check score to determine who won.
    if (evalObj.mate === 0) return evalObj.score > 0 ? 100 : 0;
  }

  return _sigmoidPercentage(evalObj.score || 0);
}

/**
 * Apply sigmoid mapping to convert centipawns to a 0-100 percentage.
 *
 * @param {number} evalCp - Evaluation in centipawns
 * @returns {number} Percentage from 0 to 100
 * @private
 */
function _sigmoidPercentage(evalCp) {
  // Sigmoid: 50 + 50 * (2 / (1 + exp(-cp / 400)) - 1)
  const sigmoid = 2 / (1 + Math.exp(-evalCp / 400)) - 1;
  const percentage = 50 + 50 * sigmoid;

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, percentage));
}

/**
 * Format a move classification into a display label with color hint.
 *
 * @param {'best'|'excellent'|'good'|'inaccuracy'|'mistake'|'blunder'} classification
 * @returns {{ label: string, color: string, emoji: string }} Display information
 *
 * @example
 * formatClassification('blunder') // { label: 'Blunder', color: '#e74c3c', emoji: '??' }
 */
export function formatClassification(classification) {
  const classifications = {
    best: { label: 'Best', color: '#27ae60', emoji: '!!' },
    excellent: { label: 'Excellent', color: '#2ecc71', emoji: '!' },
    good: { label: 'Good', color: '#f1c40f', emoji: '' },
    inaccuracy: { label: 'Inaccuracy', color: '#f39c12', emoji: '?!' },
    mistake: { label: 'Mistake', color: '#e67e22', emoji: '?' },
    blunder: { label: 'Blunder', color: '#e74c3c', emoji: '??' },
  };

  return classifications[classification] || { label: classification || 'Unknown', color: '#95a5a6', emoji: '' };
}
