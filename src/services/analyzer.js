/**
 * @fileoverview Game analysis engine using Stockfish for move evaluation.
 * Replays games move by move, evaluates positions, classifies move quality,
 * and generates training puzzles from identified mistakes.
 * @module services/analyzer
 */

import { Chess } from 'chess.js';
import { stockfish } from './stockfish.js';

/**
 * @typedef {Object} MoveAnalysis
 * @property {number} moveIndex - Zero-based index in the game's move list
 * @property {number} moveNumber - Human-readable move number (1-based)
 * @property {'white'|'black'} color - Color of the player who made the move
 * @property {string} san - Standard Algebraic Notation of the move
 * @property {string} from - Source square (e.g., 'e2')
 * @property {string} to - Target square (e.g., 'e4')
 * @property {string} fen - FEN before the move
 * @property {string} fenAfter - FEN after the move
 * @property {import('./stockfish.js').AnalysisResult} evalBefore - Engine evaluation before the move
 * @property {import('./stockfish.js').AnalysisResult} evalAfter - Engine evaluation after the move
 * @property {number} evalDrop - Centipawn loss from the moving side's perspective
 * @property {string} bestMove - Engine's best move in UCI notation
 * @property {string[]} bestLine - Engine's principal variation
 * @property {'best'|'excellent'|'good'|'inaccuracy'|'mistake'|'blunder'} classification - Move quality
 */

/**
 * @typedef {Object} GameAnalysisResult
 * @property {string} gameId - Unique game identifier
 * @property {import('./chesscom.js').NormalizedGame} game - The analyzed game
 * @property {MoveAnalysis[]} moves - Analysis for each move in the game
 */

/**
 * @typedef {Object} Puzzle
 * @property {string} id - Unique puzzle identifier (gameId_moveIndex)
 * @property {string} gameId - Source game identifier
 * @property {string} fen - Position where the mistake occurred
 * @property {'white'|'black'} playerColor - The player's color
 * @property {string} playerMove - The move the player actually made (SAN)
 * @property {string} bestMove - The engine's best move (UCI)
 * @property {string[]} bestLine - Engine's principal variation
 * @property {import('./stockfish.js').AnalysisResult} evalBefore - Eval before the mistake
 * @property {import('./stockfish.js').AnalysisResult} evalAfter - Eval after the mistake
 * @property {number} evalDrop - Centipawn loss
 * @property {'inaccuracy'|'mistake'|'blunder'} classification - Severity
 * @property {number} moveNumber - Move number in the game
 * @property {string} opponentName - Opponent's username
 * @property {number} opponentRating - Opponent's rating
 * @property {number} playerRating - Player's rating
 * @property {string} timeClass - Game time class
 * @property {string} result - Game result (win/loss/draw)
 * @property {Date} date - Date the game was played
 * @property {string} gameUrl - Chess.com URL
 */

/**
 * @typedef {Object} AnalysisProgress
 * @property {number} movesAnalyzed - Moves analyzed so far
 * @property {number} totalMoves - Total moves to analyze
 */

/**
 * @typedef {Object} BatchProgress
 * @property {number} gamesAnalyzed - Games fully analyzed
 * @property {number} totalGames - Total games to analyze
 * @property {number} [currentGameIndex] - Index of the game currently being analyzed
 * @property {number} [movesAnalyzed] - Moves analyzed in the current game
 * @property {number} [totalMoves] - Total moves in the current game
 */

/** Move classification thresholds in centipawns */
const EVAL_THRESHOLDS = {
  excellent: 10,
  good: 50,
  inaccuracy: 100,
  mistake: 200,
  // anything above 200 cp loss is a blunder
};

/** Severity ordering for puzzle filtering */
const SEVERITY_ORDER = {
  inaccuracy: 1,
  mistake: 2,
  blunder: 3,
};

/**
 * Game analysis engine.
 * Uses the Stockfish service to evaluate every position in a game,
 * classify move quality, and generate training puzzles from mistakes.
 */
export class GameAnalyzer {
  /**
   * Analyze a single game move by move.
   *
   * For each move, the engine evaluates the position before the move (to determine
   * the best available move) and after the move (to see what the player actually
   * achieved). The difference in evaluation from the moving side's perspective
   * determines the move classification.
   *
   * @param {string} pgn - PGN string of the game
   * @param {'white'|'black'} playerColor - The player's color (for reference; all moves are analyzed)
   * @param {number} [depth=14] - Stockfish search depth
   * @param {Function} [onProgress] - Progress callback: ({ movesAnalyzed, totalMoves }) => void
   * @returns {Promise<MoveAnalysis[]>} Array of analyzed moves
   * @throws {Error} If PGN is invalid or Stockfish fails
   */
  async analyzeGame(pgn, playerColor, depth = 14, onProgress = null) {
    if (!pgn || typeof pgn !== 'string') {
      throw new Error('Invalid PGN: PGN string is required');
    }

    const chess = new Chess();

    try {
      chess.loadPgn(pgn);
    } catch (err) {
      throw new Error(`Failed to parse PGN: ${err.message}`);
    }

    const history = chess.history({ verbose: true });

    if (history.length === 0) {
      return [];
    }

    // Reset and replay moves one by one
    chess.reset();
    const results = [];

    for (let i = 0; i < history.length; i++) {
      const move = history[i];
      const fenBefore = chess.fen();
      const currentColor = chess.turn() === 'w' ? 'white' : 'black';

      // Analyze position before the move to find the best move + eval
      let analysisBefore;
      try {
        analysisBefore = await stockfish.analyze(fenBefore, depth);
      } catch (err) {
        throw new Error(`Stockfish analysis failed at move ${i + 1}: ${err.message}`);
      }

      // Make the move
      chess.move(move.san);
      const fenAfter = chess.fen();

      // Analyze position after the move
      let analysisAfter;
      try {
        analysisAfter = await stockfish.analyze(fenAfter, depth);
      } catch (err) {
        throw new Error(`Stockfish analysis failed after move ${i + 1}: ${err.message}`);
      }

      // Calculate eval drop from the moving side's perspective.
      //
      // StockfishService.analyze() normalizes all scores to WHITE's perspective.
      //   analysisBefore.score = position eval from white's perspective (before move)
      //   analysisAfter.score = position eval from white's perspective (after move)
      //
      // _evalFromPerspective converts from white's-perspective to the mover's perspective:
      //   For white: returns score as-is
      //   For black: negates the score (black wants negative white eval = good for black)
      //
      // evalDrop = evalBeforeMover - evalAfterMover
      // A positive value means the move made the position worse for the mover.

      const evalBeforeMover = this._evalFromPerspective(analysisBefore, currentColor);
      const evalAfterMover = this._evalFromPerspective(analysisAfter, currentColor);
      const evalDrop = evalBeforeMover - evalAfterMover;

      // Classify the move
      const classification = this._classifyMove(
        analysisBefore.bestMove,
        move,
        evalDrop
      );

      results.push({
        moveIndex: i,
        moveNumber: Math.floor(i / 2) + 1,
        color: currentColor,
        san: move.san,
        from: move.from,
        to: move.to,
        fen: fenBefore,
        fenAfter,
        evalBefore: analysisBefore,
        evalAfter: analysisAfter,
        evalDrop,
        bestMove: analysisBefore.bestMove,
        bestLine: analysisBefore.pv,
        classification,
      });

      if (onProgress) {
        onProgress({ movesAnalyzed: i + 1, totalMoves: history.length });
      }
    }

    return results;
  }

  /**
   * Convert an engine evaluation to the perspective of a given color.
   * Handles both centipawn and mate scores.
   *
   * @param {import('./stockfish.js').AnalysisResult} analysis - Engine analysis result
   * @param {'white'|'black'} color - Color perspective
   * @returns {number} Evaluation in centipawns from the given color's perspective
   * @private
   */
  _evalFromPerspective(analysis, color) {
    if (analysis.mate !== null) {
      // Mate score: positive mate = white delivers mate
      if (color === 'white') {
        return analysis.mate > 0 ? 100000 : -100000;
      } else {
        return analysis.mate < 0 ? 100000 : -100000;
      }
    }

    // Centipawn score from white's perspective
    return color === 'white' ? analysis.score : -analysis.score;
  }

  /**
   * Classify a move based on whether it matches the engine's best move
   * and the centipawn loss.
   *
   * @param {string} engineBestMove - Engine's best move in UCI notation
   * @param {Object} playedMove - The move that was actually played (verbose chess.js move)
   * @param {number} evalDrop - Centipawn loss from the moving side's perspective
   * @returns {'best'|'excellent'|'good'|'inaccuracy'|'mistake'|'blunder'} Move classification
   * @private
   */
  _classifyMove(engineBestMove, playedMove, evalDrop) {
    // Check if the played move matches the engine's best move
    // Compare in UCI format (e.g., 'e2e4')
    const playedUci = playedMove.from + playedMove.to + (playedMove.promotion || '');

    if (engineBestMove === playedUci || engineBestMove === playedMove.lan) {
      return 'best';
    }

    // Classify by eval drop (centipawns)
    if (evalDrop <= EVAL_THRESHOLDS.excellent) {
      return 'excellent';
    } else if (evalDrop <= EVAL_THRESHOLDS.good) {
      return 'good';
    } else if (evalDrop <= EVAL_THRESHOLDS.inaccuracy) {
      return 'inaccuracy';
    } else if (evalDrop <= EVAL_THRESHOLDS.mistake) {
      return 'mistake';
    } else {
      return 'blunder';
    }
  }

  /**
   * Analyze multiple games in batch.
   *
   * @param {import('./chesscom.js').NormalizedGame[]} games - Array of normalized games
   * @param {string} playerName - Player username (for reference)
   * @param {number} [depth=14] - Stockfish search depth
   * @param {Function} [onProgress] - Progress callback: (BatchProgress) => void
   * @returns {Promise<GameAnalysisResult[]>} Array of game analysis results
   * @throws {Error} If any game analysis fails critically
   */
  async analyzeGames(games, playerName, depth = 14, onProgress = null) {
    if (!games || !Array.isArray(games) || games.length === 0) {
      return [];
    }

    const allResults = [];

    for (let g = 0; g < games.length; g++) {
      const game = games[g];

      try {
        const result = await this.analyzeGame(
          game.pgn,
          game.playerColor,
          depth,
          (moveProgress) => {
            if (onProgress) {
              onProgress({
                gamesAnalyzed: g,
                totalGames: games.length,
                currentGameIndex: g,
                ...moveProgress,
              });
            }
          }
        );

        allResults.push({ gameId: game.id, game, moves: result });
      } catch (err) {
        // Log the error but continue with remaining games
        console.error(`Failed to analyze game ${game.id}:`, err);
        allResults.push({
          gameId: game.id,
          game,
          moves: [],
          error: err.message,
        });
      }

      if (onProgress) {
        const completedGame = allResults[allResults.length - 1] || null;
        onProgress({
          gamesAnalyzed: g + 1,
          totalGames: games.length,
          movesAnalyzed: 0,
          totalMoves: 0,
          completedGame,
        });
      }
    }

    return allResults;
  }

  /**
   * Extract training puzzles from analysis results.
   *
   * Puzzles are generated from positions where the player made a suboptimal move
   * (inaccuracy, mistake, or blunder). The returned puzzles are shuffled randomly
   * using the Fisher-Yates algorithm.
   *
   * @param {GameAnalysisResult[]} analysisResults - Results from analyzeGames()
   * @param {string} playerName - Player username (unused, kept for API compat)
   * @param {'inaccuracy'|'mistake'|'blunder'} [minSeverity='inaccuracy'] - Minimum severity to include
   * @returns {Puzzle[]} Shuffled array of puzzles
   */
  generatePuzzles(analysisResults, playerName, minSeverity = 'inaccuracy') {
    if (!analysisResults || !Array.isArray(analysisResults)) {
      return [];
    }

    const minSev = SEVERITY_ORDER[minSeverity] || 1;
    const puzzles = [];

    for (const gameResult of analysisResults) {
      const game = gameResult.game;
      if (!game || !gameResult.moves) continue;

      for (const move of gameResult.moves) {
        // Only include moves by the player that are mistakes or worse
        if (move.color !== game.playerColor) continue;

        const sev = SEVERITY_ORDER[move.classification];
        if (!sev || sev < minSev) continue;

        puzzles.push({
          id: `${gameResult.gameId}_${move.moveIndex}`,
          gameId: gameResult.gameId,
          fen: move.fen,
          playerColor: game.playerColor,
          playerMove: move.san,
          bestMove: move.bestMove,
          bestLine: move.bestLine,
          evalBefore: move.evalBefore,
          evalAfter: move.evalAfter,
          evalDrop: move.evalDrop,
          classification: move.classification,
          moveNumber: move.moveNumber,
          opponentName: game.opponentName,
          opponentRating: game.opponentRating,
          playerRating: game.playerRating,
          timeClass: game.timeClass,
          result: game.result,
          date: game.date,
          gameUrl: game.url,
        });
      }
    }

    // Shuffle randomly using Fisher-Yates algorithm
    for (let i = puzzles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [puzzles[i], puzzles[j]] = [puzzles[j], puzzles[i]];
    }

    return puzzles;
  }
}

/** Singleton instance of the game analyzer */
export const analyzer = new GameAnalyzer();
