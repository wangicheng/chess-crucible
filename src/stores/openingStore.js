/**
 * @fileoverview Store for Opening Practice SRS (Spaced Repetition System) data.
 * Persists data using IndexedDB.
 * @module stores/openingStore
 */

const DB_NAME = 'ChessCrucibleOpening';
const DB_VERSION = 1;

/**
 * @typedef {Object} MoveStats
 * @property {string} fen - Normalized FEN (without move counters)
 * @property {string} move - The candidate move (SAN or UCI)
 * @property {number} e - Mistake rate (E(m))
 * @property {number} u - Games passed since last encountered (U(m))
 * @property {number} v - Total visits (V(m))
 * @property {number} consecutiveSuccesses - Consecutive successful defenses
 * @property {number} cooldownTarget - Required games to pass before urgency rises
 */

export class OpeningStore {
  constructor() {
    this.db = null;
    this.stats = new Map(); // In-memory cache of stats keyed by fen_move
    this.currentGameId = null; // To track if we've incremented U(m) for a game
  }

  async init() {
    if (typeof indexedDB === 'undefined') {
      console.warn('IndexedDB not available, operating in memory-only mode for OpeningStore');
      return;
    }

    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('stats')) {
          db.createObjectStore('stats', { keyPath: 'id' }); // id = fen_move
        }
      };

      request.onsuccess = async (e) => {
        this.db = e.target.result;
        this.db.onerror = (event) => console.error('OpeningStore IndexedDB error:', event.target.error);
        await this.loadAllStats();
        resolve();
      };

      request.onerror = (e) => {
        console.error('Failed to open OpeningStore IndexedDB:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  async loadAllStats() {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('stats', 'readonly');
      const store = tx.objectStore('stats');
      const request = store.getAll();

      request.onsuccess = () => {
        this.stats.clear();
        for (const stat of request.result) {
          this.stats.set(stat.id, stat);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  _saveStat(stat) {
    if (!this.db) return;
    const tx = this.db.transaction('stats', 'readwrite');
    tx.objectStore('stats').put(stat);
  }

  _saveAllStats() {
    if (!this.db) return;
    const tx = this.db.transaction('stats', 'readwrite');
    const store = tx.objectStore('stats');
    for (const stat of this.stats.values()) {
      store.put(stat);
    }
  }

  normalizeFen(fen) {
    // Remove halfmove clock and fullmove number to match positions accurately
    const parts = fen.split(' ');
    if (parts.length >= 4) {
      return parts.slice(0, 4).join(' ');
    }
    return fen;
  }

  getStatId(fen, move) {
    return `${this.normalizeFen(fen)}__${move}`;
  }

  getStat(fen, move) {
    const id = this.getStatId(fen, move);
    if (this.stats.has(id)) {
      return this.stats.get(id);
    }
    // Default stats
    return {
      id,
      fen: this.normalizeFen(fen),
      move,
      e: 0.5, // Initial mistake rate assumption
      u: 0,
      v: 0,
      consecutiveSuccesses: 0,
      cooldownTarget: 0,
    };
  }

  /**
   * Called when starting a new practice game to age all moves.
   */
  incrementGlobalUrgency() {
    for (const stat of this.stats.values()) {
      stat.u += 1;
    }
    this._saveAllStats();
  }

  /**
   * Called when user successfully defends against a move.
   */
  recordSuccess(fen, move) {
    const stat = this.getStat(fen, move);
    stat.v += 1;
    stat.e = Math.max(0, stat.e - 0.1); // Decrease mistake rate
    stat.consecutiveSuccesses += 1;
    stat.u = 0; // Reset urgency
    
    // Scale cooldown (e.g. 1 -> 5, 2 -> 15, 3 -> 40)
    if (stat.consecutiveSuccesses === 1) stat.cooldownTarget = 5;
    else if (stat.consecutiveSuccesses === 2) stat.cooldownTarget = 15;
    else if (stat.consecutiveSuccesses >= 3) stat.cooldownTarget = 40;

    this.stats.set(stat.id, stat);
    this._saveStat(stat);
  }

  /**
   * Called when user makes a mistake against a move.
   */
  recordFailure(fen, move) {
    const stat = this.getStat(fen, move);
    stat.v += 1;
    stat.e = Math.min(1.0, stat.e + 0.2); // Increase mistake rate
    stat.consecutiveSuccesses = 0;
    stat.u = 0;
    stat.cooldownTarget = 0; // Reset cooldown

    this.stats.set(stat.id, stat);
    this._saveStat(stat);
  }

  /**
   * Called when user fails a later move in the sequence, retroactively failing earlier moves
   * that were previously marked as successful in the current run.
   */
  recordRetroactiveFailure(fen, move) {
    const stat = this.getStat(fen, move);
    // V remains the same (already incremented by recordSuccess)
    // Revert the -0.1 from success, and add +0.2 for failure
    stat.e = Math.min(1.0, stat.e + 0.3);
    stat.consecutiveSuccesses = 0;
    stat.u = 0;
    stat.cooldownTarget = 0;
    this.stats.set(stat.id, stat);
    this._saveStat(stat);
  }

  /**
   * Called when user encounters a move but the game ends or it's just visited.
   */
  recordEncounter(fen, move) {
    const stat = this.getStat(fen, move);
    stat.v += 1;
    stat.u = 0; // reset urgency because it was just seen
    this.stats.set(stat.id, stat);
    this._saveStat(stat);
  }
}

export const openingStore = new OpeningStore();
