/**
 * @fileoverview Central state management store with IndexedDB persistence.
 * Provides a reactive pub/sub system for UI components to subscribe to
 * state changes, and handles persistent storage of games and analysis.
 * @module stores/gameStore
 */

/**
 * @typedef {Object} StoreState
 * @property {string} username - Current Chess.com username
 * @property {import('../services/chesscom.js').NormalizedGame[]} games - All downloaded games
 * @property {import('../services/chesscom.js').GameFilters} filters - Active game filters
 * @property {import('../services/chesscom.js').NormalizedGame[]} filteredGames - Games after filtering
 * @property {Object<string, import('../services/analyzer.js').MoveAnalysis[]>} analysisResults - gameId -> analysis
 * @property {import('../services/analyzer.js').Puzzle[]} puzzles - All generated puzzles (unfiltered)
 * @property {import('../services/analyzer.js').Puzzle[]} filteredPuzzles - Puzzles after filtering
 * @property {Object} puzzleFilters - Puzzle filter settings
 * @property {string[]} puzzleFilters.severity - Severity levels to include
 * @property {import('../services/analyzer.js').BatchProgress|null} analysisProgress - Current progress
 * @property {string} currentView - Active view: 'search' | 'games' | 'review' | 'train'
 * @property {string|null} currentGameId - Currently selected game ID
 * @property {number} currentPuzzleIndex - Current puzzle index
 * @property {boolean} isLoading - Whether a loading operation is in progress
 * @property {string|null} error - Current error message
 */

/** @type {string} IndexedDB database name */
const DB_NAME = 'ChessCrucible';
/** @type {number} IndexedDB schema version */
const DB_VERSION = 1;
/** @type {string} localStorage key for game filters */
const FILTERS_STORAGE_KEY = 'chess-crucible-filters';
/** @type {string} localStorage key for puzzle filters */
const PUZZLE_FILTERS_STORAGE_KEY = 'chess-crucible-puzzle-filters';

/**
 * Central state management store with reactive pub/sub and IndexedDB persistence.
 */
export class GameStore {
  constructor() {
    /** @type {StoreState} */
    this.state = {
      username: '',
      games: [],
      filters: {
        dateFrom: null,
        dateTo: null,
        minElo: null,
        maxElo: null,
        minOpponentElo: null,
        maxOpponentElo: null,
        timeClasses: [],
        results: [],
        ratedOnly: false,
      },
      filteredGames: [],
      analysisResults: {},
      puzzles: [],
      filteredPuzzles: [],
      puzzleFilters: {
        severity: ['inaccuracy', 'mistake', 'blunder'],
        evalBefore: 'any',
        evalAfter: 'any',
      },
      analysisProgress: null,
      currentView: 'search',
      currentGameId: null,
      currentPuzzleIndex: 0,
      isLoading: false,
      error: null,
    };
    this.listeners = new Map();

    /** @type {IDBDatabase|null} */
    this.db = null;
  }

  /**
   * Restore filter settings from localStorage.
   * Called during app initialization before loading games.
   */
  _restoreFilters() {
    try {
      const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (saved) {
        const filters = JSON.parse(saved);
        Object.assign(this.state.filters, filters);
      }
      const savedPuzzle = localStorage.getItem(PUZZLE_FILTERS_STORAGE_KEY);
      if (savedPuzzle) {
        Object.assign(this.state.puzzleFilters, JSON.parse(savedPuzzle));
      }
    } catch (err) {
      console.warn('Failed to restore filters from localStorage:', err);
    }
  }

  /**
   * Persist current filter settings to localStorage.
   */
  _persistFilters() {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(this.state.filters));
      localStorage.setItem(PUZZLE_FILTERS_STORAGE_KEY, JSON.stringify(this.state.puzzleFilters));
    } catch (err) {
      console.warn('Failed to save filters to localStorage:', err);
    }
  }

  /**
   * Initialize the IndexedDB database.
   * Creates object stores if they don't exist.
   * @returns {Promise<void>}
   * @throws {Error} If IndexedDB is not available or fails to open
   */
  async init() {
    if (typeof indexedDB === 'undefined') {
      console.warn('IndexedDB not available, operating in memory-only mode');
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = /** @type {IDBDatabase} */ (e.target.result);

        if (!db.objectStoreNames.contains('games')) {
          const gameStore = db.createObjectStore('games', { keyPath: 'id' });
          gameStore.createIndex('username', 'username', { unique: false });
          gameStore.createIndex('date', 'date', { unique: false });
        }

        if (!db.objectStoreNames.contains('analysis')) {
          db.createObjectStore('analysis', { keyPath: 'gameId' });
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = (e) => {
        this.db = /** @type {IDBDatabase} */ (e.target.result);

        // Handle database connection errors
        this.db.onerror = (event) => {
          console.error('IndexedDB error:', event.target.error);
        };

        resolve();
      };

      request.onerror = (e) => {
        console.error('Failed to open IndexedDB:', e.target.error);
        reject(new Error(`Failed to open IndexedDB: ${e.target.error?.message || 'Unknown error'}`));
      };
    });
  }

  /**
   * Load saved data from IndexedDB for a given username.
   * Restores games, analysis results, puzzles, and metadata.
   *
   * @param {string} username - Chess.com username
   * @returns {Promise<void>}
   */
  async loadSavedData(username) {
    if (!this.db) return;

    const lowerUsername = username.toLowerCase();

    try {
      // Load saved games for this user
      const games = await this._dbGetAll('games');
      const userGames = games.filter(
        (g) => (g.username || '').toLowerCase() === lowerUsername
      );

      if (userGames.length === 0) return;

      // Restore game Date objects (IndexedDB serializes them as strings)
      for (const game of userGames) {
        if (game.date && !(game.date instanceof Date)) {
          game.date = new Date(game.date);
        }
      }

      userGames.sort((a, b) => new Date(b.date) - new Date(a.date));

      // Update state with games first
      this.setState({ username: lowerUsername, games: userGames });

      // Load & restore analysis, then regenerate puzzles
      await this.restoreAnalysisForGames();

      // Apply filters to update filteredGames
      this.applyFilters();
      this.applyPuzzleFilters();
    } catch (err) {
      console.error('Failed to load saved data:', err);
    }
  }

  /**
   * Try to restore the last session from IndexedDB.
   * Reads the last used username from meta and loads their data.
   * @returns {Promise<string|null>} The restored username, or null
   */
  async tryRestoreSession() {
    this._restoreFilters();
    if (!this.db) return null;
    try {
      const meta = await this._dbGet('meta', 'lastUsername');
      const username = meta?.value || '';
      if (!username) return null;
      await this.loadSavedData(username);
      return this.state.games.length > 0 ? username : null;
    } catch {
      return null;
    }
  }

  /**
   * Save games to IndexedDB.
   * Each game is stored with the username for later retrieval.
   *
   * @param {import('../services/chesscom.js').NormalizedGame[]} games - Games to save
   * @returns {Promise<void>}
   */
  async saveGames(games) {
    if (!this.db || !games || games.length === 0) return;

    try {
      const tx = this.db.transaction('games', 'readwrite');
      const objectStore = tx.objectStore('games');

      for (const game of games) {
        // Store with username for filtering
        const record = {
          ...game,
          username: this.state.username.toLowerCase(),
          // Ensure date is serializable
          date: game.date instanceof Date ? game.date.toISOString() : game.date,
        };
        objectStore.put(record);
      }

      // Save the last username to meta
      const metaTx = this.db.transaction('meta', 'readwrite');
      metaTx.objectStore('meta').put({
        key: 'lastUsername',
        value: this.state.username,
      });

      await this._txComplete(tx);
    } catch (err) {
      console.error('Failed to save games to IndexedDB:', err);
    }
  }

  /**
   * Save analysis results for a game to IndexedDB.
   *
   * @param {string} gameId - Game identifier
   * @param {import('../services/analyzer.js').MoveAnalysis[]} analysis - Analysis data
   * @returns {Promise<void>}
   */
  async saveAnalysis(gameId, analysis) {
    if (!this.db || !gameId) return;

    try {
      const tx = this.db.transaction('analysis', 'readwrite');
      tx.objectStore('analysis').put({
        gameId,
        data: analysis,
        savedAt: new Date().toISOString(),
      });

      await this._txComplete(tx);
    } catch (err) {
      console.error(`Failed to save analysis for game ${gameId}:`, err);
    }
  }

  /**
   * Update state and notify subscribed listeners.
   * Only listeners for the specific changed keys are notified,
   * plus any wildcard ('*') listeners.
   *
   * @param {Partial<StoreState>} updates - Partial state updates
   */
  setState(updates) {
    Object.assign(this.state, updates);

    // Notify listeners for each changed key
    for (const key of Object.keys(updates)) {
      const listeners = this.listeners.get(key);
      if (listeners) {
        for (const cb of listeners) {
          try {
            cb(updates[key], this.state);
          } catch (err) {
            console.error(`Listener error for key "${key}":`, err);
          }
        }
      }
    }

    // Notify wildcard listeners
    const allListeners = this.listeners.get('*');
    if (allListeners) {
      for (const cb of allListeners) {
        try {
          cb(updates, this.state);
        } catch (err) {
          console.error('Wildcard listener error:', err);
        }
      }
    }
  }

  /**
   * Subscribe to state changes.
   * Use a specific key to listen to changes on that property,
   * or '*' to listen to any state change.
   *
   * @param {string} key - State key to subscribe to, or '*' for all changes
   * @param {Function} callback - Callback: (newValue, fullState) => void
   * @returns {Function} Unsubscribe function
   */
  on(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const set = this.listeners.get(key);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          this.listeners.delete(key);
        }
      }
    };
  }

  /**
   * Restore previously saved analysis results from IndexedDB for the
   * current games list. Also regenerates puzzles from restored analysis.
   * Call this after fetching/saving games to preserve prior analysis work.
   * @returns {Promise<boolean>} True if any analysis was restored
   */
  async restoreAnalysisForGames() {
    if (!this.db) return false;

    const games = this.state.games;
    if (!games || games.length === 0) return false;

    const gameIds = new Set(games.map((g) => g.id));

    try {
      const analysisRecords = await this._dbGetAll('analysis');
      const analysisResults = {};

      for (const record of analysisRecords) {
        if (gameIds.has(record.gameId)) {
          analysisResults[record.gameId] = record.data;
        }
      }

      const keys = Object.keys(analysisResults);
      if (keys.length === 0) return false;

      this.setState({ analysisResults });

      // Reconstruct GameAnalysisResult format for puzzle generation
      const results = [];
      for (const game of games) {
        const moves = analysisResults[game.id];
        if (moves) {
          results.push({ gameId: game.id, game, moves });
        }
      }

      if (results.length > 0) {
        const { analyzer } = await import('../services/analyzer.js');
        const puzzles = analyzer.generatePuzzles(results, this.state.username);
        this.setState({ puzzles });
      }

      return true;
    } catch (err) {
      console.error('Failed to restore analysis:', err);
      return false;
    }
  }

  /**
   * Apply current filters to the games list and update filteredGames.
   * Also updates the filtered games count.
   */
  applyFilters() {
    const { games, filters } = this.state;

    const filtered = games.filter((game) => {
      // Date range
      if (filters.dateFrom) {
        const from = filters.dateFrom instanceof Date ? filters.dateFrom : new Date(filters.dateFrom);
        if (game.date < from) return false;
      }
      if (filters.dateTo) {
        const to = filters.dateTo instanceof Date ? filters.dateTo : new Date(filters.dateTo);
        if (game.date > to) return false;
      }

      // Player rating
      if (filters.minElo != null && game.playerRating < filters.minElo) return false;
      if (filters.maxElo != null && game.playerRating > filters.maxElo) return false;

      // Opponent rating
      if (filters.minOpponentElo != null && game.opponentRating < filters.minOpponentElo) return false;
      if (filters.maxOpponentElo != null && game.opponentRating > filters.maxOpponentElo) return false;

      // Time class
      if (filters.timeClasses && filters.timeClasses.length > 0) {
        if (!filters.timeClasses.includes(game.timeClass)) return false;
      }

      // Result
      if (filters.results && filters.results.length > 0) {
        if (!filters.results.includes(game.result)) return false;
      }

      // Rated only
      if (filters.ratedOnly && !game.rated) return false;

      return true;
    });

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    this.setState({ filteredGames: filtered });
    this._persistFilters();
  }

  /**
   * Apply puzzle severity and game-level filters.
   * Filters puzzles by both severity and source game attributes
   * (time class, date, rating, opponent rating, result).
   */
  applyPuzzleFilters() {
    const { puzzles, puzzleFilters, filters } = this.state;

    if (!puzzles || puzzles.length === 0) {
      this.setState({ filteredPuzzles: [] });
      this._persistFilters();
      return;
    }

    let filtered = [...puzzles];

    // Filter by severity
    if (puzzleFilters.severity && puzzleFilters.severity.length > 0) {
      filtered = filtered.filter((puzzle) =>
        puzzleFilters.severity.includes(puzzle.classification)
      );
    }

    // Filter by eval before the mistake
    if (puzzleFilters.evalBefore && puzzleFilters.evalBefore !== 'any') {
      filtered = filtered.filter((puzzle) => {
        const score = puzzle.evalBefore ? puzzle.evalBefore.score : 0;
        const playerScore = puzzle.playerColor === 'white' ? score : -score;
        if (puzzleFilters.evalBefore === 'advantage_or_equal') return playerScore >= 0;
        if (puzzleFilters.evalBefore === 'advantage') return playerScore > 0;
        return true;
      });
    }

    // Filter by eval after the mistake
    if (puzzleFilters.evalAfter && puzzleFilters.evalAfter !== 'any') {
      filtered = filtered.filter((puzzle) => {
        const score = puzzle.evalAfter ? puzzle.evalAfter.score : 0;
        const playerScore = puzzle.playerColor === 'white' ? score : -score;
        if (puzzleFilters.evalAfter === 'equal_or_disadvantage') return playerScore <= 0;
        if (puzzleFilters.evalAfter === 'disadvantage') return playerScore < 0;
        return true;
      });
    }

    // Filter by game-level attributes (same as game filters)
    if (filters.timeClasses && filters.timeClasses.length > 0) {
      filtered = filtered.filter((puzzle) =>
        filters.timeClasses.includes(puzzle.timeClass)
      );
    }

    if (filters.dateFrom) {
      const from = filters.dateFrom instanceof Date ? filters.dateFrom : new Date(filters.dateFrom);
      filtered = filtered.filter((puzzle) => {
        const d = puzzle.date instanceof Date ? puzzle.date : new Date(puzzle.date);
        return d >= from;
      });
    }
    if (filters.dateTo) {
      const to = filters.dateTo instanceof Date ? filters.dateTo : new Date(filters.dateTo);
      filtered = filtered.filter((puzzle) => {
        const d = puzzle.date instanceof Date ? puzzle.date : new Date(puzzle.date);
        return d <= to;
      });
    }

    if (filters.minElo != null) {
      filtered = filtered.filter((p) => p.playerRating >= filters.minElo);
    }
    if (filters.maxElo != null) {
      filtered = filtered.filter((p) => p.playerRating <= filters.maxElo);
    }

    if (filters.minOpponentElo != null) {
      filtered = filtered.filter((p) => p.opponentRating >= filters.minOpponentElo);
    }
    if (filters.maxOpponentElo != null) {
      filtered = filtered.filter((p) => p.opponentRating <= filters.maxOpponentElo);
    }

    if (filters.results && filters.results.length > 0) {
      filtered = filtered.filter((puzzle) =>
        filters.results.includes(puzzle.result)
      );
    }

    this.setState({ filteredPuzzles: filtered });
    this._persistFilters();
  }

  /**
   * Reset puzzle filters to their default values.
   */
  resetPuzzleFilters() {
    this.setState({
      puzzleFilters: {
        severity: ['inaccuracy', 'mistake', 'blunder'],
        evalBefore: 'any',
        evalAfter: 'any',
      },
    });
    this.applyPuzzleFilters();
  }

  /**
   * Reset all filters to their default values.
   */
  resetFilters() {
    this.setState({
      filters: {
        dateFrom: null,
        dateTo: null,
        minElo: null,
        maxElo: null,
        minOpponentElo: null,
        maxOpponentElo: null,
        timeClasses: [],
        results: [],
        ratedOnly: false,
      },
    });
    this.applyFilters();
    this.applyPuzzleFilters();
  }

  /**
   * Clear all data and reset to initial state.
   */
  reset() {
    this.setState({
      username: '',
      games: [],
      filters: {
        dateFrom: null,
        dateTo: null,
        minElo: null,
        maxElo: null,
        minOpponentElo: null,
        maxOpponentElo: null,
        timeClasses: [],
        results: [],
        ratedOnly: false,
      },
      filteredGames: [],
      analysisResults: {},
      puzzles: [],
      filteredPuzzles: [],
      puzzleFilters: {
        severity: ['inaccuracy', 'mistake', 'blunder'],
        evalBefore: 'any',
        evalAfter: 'any',
      },
      analysisProgress: null,
      currentView: 'search',
      currentGameId: null,
      currentPuzzleIndex: 0,
      isLoading: false,
      error: null,
    });
    this._persistFilters();
  }

  // ─── IndexedDB Helpers ──────────────────────────────────────────────

  /**
   * Get all records from an object store.
   * @param {string} storeName - Object store name
   * @returns {Promise<Array>}
   * @private
   */
  _dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve([]);
        return;
      }

      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Get a single record by key from an object store.
   * @param {string} storeName - Object store name
   * @param {string} key - Record key
   * @returns {Promise<*>}
   * @private
   */
  _dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        resolve(null);
        return;
      }

      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const request = tx.objectStore(storeName).get(key);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Wait for an IndexedDB transaction to complete.
   * @param {IDBTransaction} tx - Transaction to wait for
   * @returns {Promise<void>}
   * @private
   */
  _txComplete(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted'));
    });
  }
}

/** Singleton instance of the game store */
export const store = new GameStore();
