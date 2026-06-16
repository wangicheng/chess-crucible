/**
 * @fileoverview Chess.com API client service.
 * Communicates with our Express proxy server to fetch player games,
 * normalize game data, and provide client-side filtering.
 * @module services/chesscom
 */

/**
 * @typedef {Object} NormalizedGame
 * @property {string} id - Unique game identifier (extracted from URL)
 * @property {string} pgn - PGN string of the game
 * @property {'white'|'black'} playerColor - The searched player's color
 * @property {number} playerRating - The player's rating for this game
 * @property {string} opponentName - Opponent's username
 * @property {number} opponentRating - Opponent's rating
 * @property {'win'|'loss'|'draw'} result - Game result from player's perspective
 * @property {Date} date - Date the game was played
 * @property {string} timeClass - Time class: 'bullet', 'blitz', 'rapid', 'daily'
 * @property {string} timeControl - Time control string (e.g., '600', '300+5')
 * @property {string} url - Chess.com game URL
 * @property {boolean} rated - Whether the game was rated
 */

/**
 * @typedef {Object} GameFilters
 * @property {Date|null} dateFrom - Earliest game date
 * @property {Date|null} dateTo - Latest game date
 * @property {number|null} minElo - Minimum player rating
 * @property {number|null} maxElo - Maximum player rating
 * @property {number|null} minOpponentElo - Minimum opponent rating
 * @property {number|null} maxOpponentElo - Maximum opponent rating
 * @property {string[]} timeClasses - Time classes to include (empty = all)
 * @property {string[]} results - Results to include: 'win','loss','draw' (empty = all)
 * @property {boolean} ratedOnly - Only include rated games
 */

/**
 * @typedef {Object} ProgressInfo
 * @property {number} loaded - Number of items loaded
 * @property {number} total - Total number of items
 * @property {'archives'|'games'} phase - Current loading phase
 */

/**
 * Chess.com result strings that indicate a loss for the player.
 * @type {Set<string>}
 * @private
 */
const LOSS_RESULTS = new Set([
  'checkmated',
  'resigned',
  'timeout',
  'abandoned',
  'kingofthehill',
  'threecheck',
  'bughousepartnerlose',
]);

/**
 * Chess.com result strings that indicate a draw.
 * @type {Set<string>}
 * @private
 */
const DRAW_RESULTS = new Set([
  'stalemate',
  'agreed',
  'repetition',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

/**
 * Service for interacting with the Chess.com API through our proxy server.
 */
export class ChessComService {
  constructor() {
    /** @type {string} Base URL for the proxy API */
    this.baseUrl = '/api';
  }

  async fetchPlayerGames(username, onProgress = null) {
    if (!username || typeof username !== 'string') {
      throw new Error('Username is required');
    }

    const trimmedUsername = username.trim().toLowerCase();

    if (onProgress) {
      onProgress({ loaded: 0, total: 0, phase: 'archives' });
    }

    // Step 1: Get list of monthly archive URLs
    let archivesResponse;
    try {
      archivesResponse = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(trimmedUsername)}/games/archives`);
    } catch (err) {
      throw new Error(
        `Network error fetching archives for "${trimmedUsername}". Check your connection and try again.`
      );
    }

    if (archivesResponse.status === 404) {
      throw new Error(`Player "${trimmedUsername}" not found on Chess.com`);
    }

    if (!archivesResponse.ok) {
      throw new Error(`Failed to fetch archives: ${archivesResponse.status}`);
    }

    const archivesData = await archivesResponse.json();
    const archiveUrls = archivesData.archives || [];

    if (archiveUrls.length === 0) {
      return [];
    }

    if (onProgress) {
      onProgress({ loaded: 0, total: archiveUrls.length, phase: 'games' });
    }

    const allGames = [];

    // Step 2: Fetch each archive sequentially
    for (let i = 0; i < archiveUrls.length; i++) {
      try {
        const res = await fetch(archiveUrls[i]);
        if (!res.ok) {
           console.warn(`Failed to fetch archive ${archiveUrls[i]}`);
           continue;
        }
        const data = await res.json();
        const games = data.games || [];
        allGames.push(...games);
        
        if (onProgress) {
           onProgress({ loaded: i + 1, total: archiveUrls.length, phase: 'games' });
        }
      } catch (err) {
        console.warn(`Error fetching archive ${archiveUrls[i]}:`, err);
      }
      
      // Delay to avoid rate limiting
      if (i < archiveUrls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    const rawGames = allGames;

    // Normalize all games
    const normalizedGames = [];
    for (const game of rawGames) {
      try {
        const normalized = this.normalizeGame(game, trimmedUsername);
        if (normalized) {
          normalizedGames.push(normalized);
        }
      } catch {
        // Skip games that fail to normalize (malformed data)
        continue;
      }
    }

    return normalizedGames;
  }

  /**
   * Filter games client-side based on provided filter criteria.
   *
   * @param {NormalizedGame[]} games - Array of normalized games
   * @param {GameFilters} filters - Filter criteria
   * @returns {NormalizedGame[]} Filtered array of games
   */
  filterGames(games, filters) {
    if (!games || !Array.isArray(games)) return [];
    if (!filters) return [...games];

    return games.filter((game) => {
      // Date range filter
      if (filters.dateFrom && game.date < filters.dateFrom) return false;
      if (filters.dateTo && game.date > filters.dateTo) return false;

      // Player rating filter
      if (filters.minElo != null && game.playerRating < filters.minElo) return false;
      if (filters.maxElo != null && game.playerRating > filters.maxElo) return false;

      // Opponent rating filter
      if (filters.minOpponentElo != null && game.opponentRating < filters.minOpponentElo) return false;
      if (filters.maxOpponentElo != null && game.opponentRating > filters.maxOpponentElo) return false;

      // Time class filter (empty array = include all)
      if (filters.timeClasses && filters.timeClasses.length > 0) {
        if (!filters.timeClasses.includes(game.timeClass)) return false;
      }

      // Result filter (empty array = include all)
      if (filters.results && filters.results.length > 0) {
        if (!filters.results.includes(game.result)) return false;
      }

      // Rated only filter
      if (filters.ratedOnly && !game.rated) return false;

      return true;
    });
  }

  /**
   * Normalize a raw Chess.com game object into our internal format.
   *
   * @param {Object} game - Raw game object from Chess.com API
   * @param {string} username - The searched player's username (lowercase)
   * @returns {NormalizedGame|null} Normalized game object, or null if game is invalid
   */
  normalizeGame(game, username) {
    if (!game || !game.white || !game.black) {
      return null;
    }

    const lowerUsername = username.toLowerCase();

    // Determine player color by comparing usernames
    const whiteUsername = (game.white.username || '').toLowerCase();
    const blackUsername = (game.black.username || '').toLowerCase();

    let playerColor;
    let playerData;
    let opponentData;

    if (whiteUsername === lowerUsername) {
      playerColor = 'white';
      playerData = game.white;
      opponentData = game.black;
    } else if (blackUsername === lowerUsername) {
      playerColor = 'black';
      playerData = game.black;
      opponentData = game.white;
    } else {
      // Player not found in this game
      return null;
    }

    // Determine result from the player's perspective
    const result = this._determineResult(playerData.result, opponentData.result);

    // Extract game ID from URL
    const id = game.url
      ? game.url.split('/').filter(Boolean).pop() || String(game.end_time || Date.now())
      : String(game.end_time || Date.now());

    // Parse date
    let date;
    if (game.end_time) {
      date = new Date(game.end_time * 1000);
    } else {
      // Try to extract date from PGN headers
      date = this._parseDateFromPgn(game.pgn) || new Date();
    }

    return {
      id,
      pgn: game.pgn || '',
      playerColor,
      playerRating: playerData.rating || 0,
      opponentName: opponentData.username || 'Unknown',
      opponentRating: opponentData.rating || 0,
      result,
      date,
      timeClass: game.time_class || 'unknown',
      timeControl: game.time_control || '',
      url: game.url || '',
      rated: game.rated !== false,
    };
  }

  /**
   * Determine the game result from the player's perspective.
   *
   * @param {string} playerResult - Chess.com result string for the player
   * @param {string} opponentResult - Chess.com result string for the opponent
   * @returns {'win'|'loss'|'draw'} Game result
   * @private
   */
  _determineResult(playerResult, opponentResult) {
    if (!playerResult) return 'draw';

    // Direct win check
    if (playerResult === 'win') return 'win';

    // Check if it's a draw
    if (DRAW_RESULTS.has(playerResult)) return 'draw';

    // Check if it's a loss (explicit loss results)
    if (LOSS_RESULTS.has(playerResult)) return 'loss';

    // If the opponent won, the player lost
    if (opponentResult === 'win') return 'loss';

    // Default to draw for any unrecognized result
    return 'draw';
  }

  /**
   * Attempt to parse a date from PGN header tags.
   *
   * @param {string} pgn - PGN string
   * @returns {Date|null} Parsed date or null
   * @private
   */
  _parseDateFromPgn(pgn) {
    if (!pgn) return null;

    const dateMatch = pgn.match(/\[Date\s+"(\d{4})\.(\d{2})\.(\d{2})"\]/);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    const utcDateMatch = pgn.match(/\[UTCDate\s+"(\d{4})\.(\d{2})\.(\d{2})"\]/);
    if (utcDateMatch) {
      const [, year, month, day] = utcDateMatch;
      return new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    }

    return null;
  }
}

/** Singleton instance of the Chess.com service */
export const chesscom = new ChessComService();
