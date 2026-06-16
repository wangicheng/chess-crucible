/**
 * @fileoverview PGN (Portable Game Notation) parsing utility functions.
 * Provides helpers for extracting headers, moves, and FEN positions from PGN strings.
 * @module utils/pgn
 */

import { Chess } from 'chess.js';

/**
 * @typedef {Object} PgnHeaders
 * @property {string} [Event] - Event name
 * @property {string} [Site] - Site or platform
 * @property {string} [Date] - Date in YYYY.MM.DD format
 * @property {string} [Round] - Round number
 * @property {string} [White] - White player name
 * @property {string} [Black] - Black player name
 * @property {string} [Result] - Game result: '1-0', '0-1', '1/2-1/2', '*'
 * @property {string} [WhiteElo] - White player's rating
 * @property {string} [BlackElo] - Black player's rating
 * @property {string} [TimeControl] - Time control string
 * @property {string} [ECO] - ECO opening code
 * @property {string} [Opening] - Opening name
 * @property {string} [Termination] - How the game ended
 * @property {string} [UTCDate] - UTC date
 * @property {string} [UTCTime] - UTC time
 * @property {string} [Variant] - Chess variant
 * @property {string} [FEN] - Starting FEN (if not standard position)
 * @property {string} [SetUp] - '1' if FEN tag is present
 */

/**
 * Parse PGN header tags into a key-value object.
 *
 * Handles standard PGN headers like [Event "..."], [White "..."], etc.
 * Also handles multi-line headers and escaped quotes within values.
 *
 * @param {string} pgn - PGN string containing headers
 * @returns {PgnHeaders} Object with header tag names as keys
 *
 * @example
 * const headers = parsePgnHeaders('[White "Magnus Carlsen"]\n[Black "Hikaru"]\n1. e4 e5');
 * // { White: 'Magnus Carlsen', Black: 'Hikaru' }
 */
export function parsePgnHeaders(pgn) {
  if (!pgn || typeof pgn !== 'string') {
    return {};
  }

  const headers = {};
  // Match [Key "Value"] patterns, handling escaped quotes
  const headerRegex = /\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g;
  let match;

  while ((match = headerRegex.exec(pgn)) !== null) {
    const key = match[1];
    // Unescape any escaped characters in the value
    const value = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    headers[key] = value;
  }

  return headers;
}

/**
 * Extract an array of SAN (Standard Algebraic Notation) move strings from a PGN.
 *
 * Uses chess.js to parse the PGN and extract validated moves.
 * Falls back to regex-based extraction if chess.js parsing fails.
 *
 * @param {string} pgn - PGN string
 * @returns {string[]} Array of SAN move strings (e.g., ['e4', 'e5', 'Nf3', 'Nc6'])
 *
 * @example
 * const moves = getMovesFromPgn('1. e4 e5 2. Nf3 Nc6');
 * // ['e4', 'e5', 'Nf3', 'Nc6']
 */
export function getMovesFromPgn(pgn) {
  if (!pgn || typeof pgn !== 'string') {
    return [];
  }

  // Try parsing with chess.js first for validated moves
  try {
    const chess = new Chess();
    const headers = parsePgnHeaders(pgn);

    // Handle custom starting position
    if (headers.FEN && headers.SetUp === '1') {
      chess.load(headers.FEN);
    }

    chess.loadPgn(pgn);
    return chess.history();
  } catch {
    // Fall back to regex extraction
    return _extractMovesRegex(pgn);
  }
}

/**
 * Convert a PGN into an array of FEN strings representing every position in the game.
 *
 * The first element is the starting position (standard or from the FEN header).
 * Each subsequent element is the position after each move.
 *
 * @param {string} pgn - PGN string
 * @returns {string[]} Array of FEN strings (length = number of moves + 1)
 *
 * @example
 * const fens = pgnToFens('1. e4 e5');
 * // [
 * //   'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
 * //   'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
 * //   'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'
 * // ]
 */
export function pgnToFens(pgn) {
  if (!pgn || typeof pgn !== 'string') {
    return [];
  }

  const chess = new Chess();
  const headers = parsePgnHeaders(pgn);

  // Handle custom starting position
  if (headers.FEN && headers.SetUp === '1') {
    try {
      chess.load(headers.FEN);
    } catch {
      // If the FEN is invalid, start from the standard position
      chess.reset();
    }
  }

  try {
    chess.loadPgn(pgn);
  } catch {
    // Return just the starting position if PGN is unparseable
    return [chess.fen()];
  }

  const moves = chess.history();

  // Replay moves to capture FEN at each position
  chess.reset();

  // Reload the starting position if needed
  if (headers.FEN && headers.SetUp === '1') {
    try {
      chess.load(headers.FEN);
    } catch {
      chess.reset();
    }
  }

  const fens = [chess.fen()];

  for (const san of moves) {
    try {
      chess.move(san);
      fens.push(chess.fen());
    } catch {
      // Stop if a move fails (shouldn't happen with validated PGN)
      break;
    }
  }

  return fens;
}

/**
 * Fallback regex-based move extraction for malformed PGNs.
 *
 * Strips headers, comments, NAGs, and move numbers, then extracts
 * SAN move tokens. This is less reliable than chess.js parsing but
 * handles some non-standard PGN formats.
 *
 * @param {string} pgn - PGN string
 * @returns {string[]} Array of SAN move strings
 * @private
 */
function _extractMovesRegex(pgn) {
  // Remove header tags
  let moveText = pgn.replace(/\[\s*\w+\s+"[^"]*"\s*\]\s*/g, '');

  // Remove comments (both { } and ; style)
  moveText = moveText.replace(/\{[^}]*\}/g, '');
  moveText = moveText.replace(/;[^\n]*/g, '');

  // Remove NAGs (Numeric Annotation Glyphs like $1, $2)
  moveText = moveText.replace(/\$\d+/g, '');

  // Remove variations (parenthesized)
  // Handle nested parentheses by iterating
  let prevText;
  do {
    prevText = moveText;
    moveText = moveText.replace(/\([^()]*\)/g, '');
  } while (moveText !== prevText);

  // Remove result
  moveText = moveText.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/, '');

  // Remove move numbers (e.g., '1.', '1...', '12.')
  moveText = moveText.replace(/\d+\.{1,3}\s*/g, '');

  // Split into tokens and filter for valid SAN moves
  const tokens = moveText.trim().split(/\s+/).filter(Boolean);

  // Basic SAN validation: moves start with a letter (piece or pawn file)
  // or are castling (O-O, O-O-O)
  const sanRegex = /^(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O-O|O-O)[+#]?$/;

  return tokens.filter((token) => sanRegex.test(token));
}
