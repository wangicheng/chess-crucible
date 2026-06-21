/**
 * @fileoverview Stockfish Web Worker service for chess position analysis.
 * Communicates with Stockfish via the UCI protocol through a Web Worker.
 * Loads the engine from CDN using a blob worker for Vite compatibility.
 * @module services/stockfish
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {number} score - Evaluation in centipawns from WHITE's perspective
 * @property {number|null} mate - Moves to mate (positive = white mates, negative = black mates), null if no mate
 * @property {string} bestMove - Best move in UCI notation (e.g., 'e2e4')
 * @property {string[]} pv - Principal variation (array of UCI move strings)
 * @property {number} depth - Search depth reached
 */

/**
 * @typedef {Object} MultiPVResult
 * @property {number} score - Evaluation in centipawns from WHITE's perspective
 * @property {number|null} mate - Moves to mate, null if no mate
 * @property {string[]} pv - Principal variation
 * @property {number} depth - Search depth reached
 * @property {number} pvNumber - PV line number (1-based)
 */

/**
 * Singleton service for interacting with the Stockfish chess engine via a Web Worker.
 * Handles UCI protocol communication, queuing of analysis requests, and result parsing.
 */
export class StockfishService {
  constructor() {
    /** @type {Worker|null} */
    this.worker = null;
    /** @type {boolean} */
    this.ready = false;
    /** @type {Array<{resolve: Function, reject: Function, command: Function}>} */
    this.queue = [];
    /** @type {boolean} */
    this.isAnalyzing = false;
  }

  /**
   * Initialize the Stockfish engine worker.
   * Creates a blob worker that loads Stockfish from CDN, sends UCI initialization
   * commands, and resolves when the engine is ready.
   * @returns {Promise<void>} Resolves when the engine is fully initialized
   * @throws {Error} If the worker fails to initialize or times out
   */
  async init() {
    if (this.ready && this.worker) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(`${import.meta.env.BASE_URL}stockfish-worker.js`);
      } catch (err) {
        reject(new Error(`Failed to create Stockfish worker: ${err.message}`));
        return;
      }

      let phase = 'uci'; // 'uci' -> 'setoption' -> 'isready'

      const timeout = setTimeout(() => {
        this.worker?.terminate();
        this.worker = null;
        reject(new Error('Stockfish initialization timed out after 30 seconds'));
      }, 30000);

      this.worker.onerror = (e) => {
        clearTimeout(timeout);
        this.worker?.terminate();
        this.worker = null;
        reject(new Error(`Stockfish worker error: ${e.message}`));
      };

      this.worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data);

        if (phase === 'uci' && line.includes('uciok')) {
          phase = 'setoption';
          this.worker.postMessage('setoption name Hash value 64');
          this.worker.postMessage('setoption name Threads value 4');
          this.worker.postMessage('isready');
          phase = 'isready';
        } else if (phase === 'isready' && line.includes('readyok')) {
          clearTimeout(timeout);
          this.ready = true;
          resolve();
        }
      };

      // Start the UCI handshake
      this.worker.postMessage('uci');
    });
  }

  /**
   * Normalize engine score from side-to-move perspective to WHITE's perspective.
   * UCI engines always report scores from the perspective of the side to move.
   * @param {number} score - Raw score from engine (side-to-move perspective)
   * @param {number|null} mate - Raw mate value from engine
   * @param {string} fen - FEN string to determine active color
   * @returns {{ score: number, mate: number|null }}
   * @private
   */
  _normalizeScore(score, mate, fen) {
    const activeColor = fen.split(' ')[1];
    if (activeColor === 'b') {
      return {
        score: -score,
        mate: mate !== null ? -mate : null,
      };
    }
    return { score, mate };
  }

  /**
   * Send a raw UCI command to the engine.
   * @param {string} cmd - UCI command string
   * @private
   */
  _send(cmd) {
    if (!this.worker) {
      throw new Error('Stockfish worker not initialized. Call init() first.');
    }
    this.worker.postMessage(cmd);
  }

  /**
   * Parse a UCI info line into a structured object.
   * @param {string} line - UCI info line (e.g., 'info depth 20 score cp 35 pv e2e4 e7e5')
   * @returns {Object|null} Parsed info or null if the line should be skipped
   * @private
   */
  _parseInfoLine(line) {
    // Skip lowerbound/upperbound lines (aspiration window failures)
    if (line.includes('lowerbound') || line.includes('upperbound')) {
      return null;
    }

    if (!line.startsWith('info') || !line.includes('score')) {
      return null;
    }

    const tokens = line.split(/\s+/);
    const result = {
      depth: 0,
      score: 0,
      mate: null,
      pv: [],
      multipv: 1,
    };

    for (let i = 0; i < tokens.length; i++) {
      switch (tokens[i]) {
        case 'depth':
          result.depth = parseInt(tokens[i + 1], 10);
          i++;
          break;
        case 'multipv':
          result.multipv = parseInt(tokens[i + 1], 10);
          i++;
          break;
        case 'score':
          if (tokens[i + 1] === 'cp') {
            result.score = parseInt(tokens[i + 2], 10);
            result.mate = null;
            i += 2;
          } else if (tokens[i + 1] === 'mate') {
            result.mate = parseInt(tokens[i + 2], 10);
            result.score = result.mate > 0 ? 100000 : -100000;
            i += 2;
          }
          break;
        case 'pv': {
          // Everything after 'pv' until end of line is the principal variation
          result.pv = tokens.slice(i + 1);
          i = tokens.length; // break out of loop
          break;
        }
      }
    }

    return result;
  }

  /**
   * Parse a bestmove line.
   * @param {string} line - UCI bestmove line (e.g., 'bestmove e2e4 ponder e7e5')
   * @returns {{bestMove: string, ponder: string|null}|null}
   * @private
   */
  _parseBestMove(line) {
    if (!line.startsWith('bestmove')) return null;
    const tokens = line.split(/\s+/);
    return {
      bestMove: tokens[1] || '(none)',
      ponder: tokens[3] || null,
    };
  }

  /**
   * Process the next item in the analysis queue.
   * @private
   */
  _processQueue() {
    if (this.queue.length === 0) {
      this.isAnalyzing = false;
      return;
    }

    this.isAnalyzing = true;
    const { resolve, reject, command } = this.queue.shift();

    try {
      command(resolve, reject);
    } catch (err) {
      reject(err);
      this._processQueue();
    }
  }

  /**
   * Enqueue an analysis task and return a promise for its result.
   * @param {Function} commandFn - Function that takes (resolve, reject) and sends UCI commands
   * @returns {Promise<*>}
   * @private
   */
  _enqueue(commandFn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, command: commandFn });

      if (!this.isAnalyzing) {
        this._processQueue();
      }
    });
  }

  /**
   * Analyze a chess position at the given depth.
   * @param {string} fen - FEN string of the position to analyze
   * @param {number} [depth=14] - Search depth
   * @returns {Promise<AnalysisResult>} Analysis result with score from WHITE's perspective
   * @throws {Error} If the engine is not initialized or analysis fails
   */
  async analyze(fen, depth = 14, onProgress = null) {
    if (!this.ready) {
      throw new Error('Stockfish not initialized. Call init() first.');
    }

    return this._enqueue((resolve, reject) => {
      let bestInfo = null;
      let bestMoveResult = null;

      const timeout = setTimeout(() => {
        this.worker.removeEventListener('message', handler);
        reject(new Error(`Analysis timed out after 60 seconds for position: ${fen}`));
        this._processQueue();
      }, 60000);

      const handler = (e) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data);

        // Parse info lines
        const info = this._parseInfoLine(line);
        if (info) {
          // Keep the deepest info line
          if (!bestInfo || info.depth >= bestInfo.depth) {
            bestInfo = info;
            
            if (onProgress) {
              try {
                const normalized = this._normalizeScore(
                  bestInfo.score,
                  bestInfo.mate,
                  fen
                );
                onProgress({
                  score: normalized.score,
                  mate: normalized.mate,
                  bestMove: bestInfo.pv.length > 0 ? bestInfo.pv[0] : null,
                  pv: bestInfo.pv,
                  depth: bestInfo.depth,
                });
              } catch (err) {
                // Ignore onProgress errors to prevent crashing the worker message handler
              }
            }
          }
        }

        // Parse bestmove line (signals end of analysis)
        const bm = this._parseBestMove(line);
        if (bm) {
          // Ignore spurious bestmove that can occur when stopping an idle engine
          if (!bestInfo) {
            return;
          }

          clearTimeout(timeout);
          this.worker.removeEventListener('message', handler);
          bestMoveResult = bm;

          const normalized = this._normalizeScore(
            bestInfo ? bestInfo.score : 0,
            bestInfo ? bestInfo.mate : null,
            fen
          );

          const result = {
            score: normalized.score,
            mate: normalized.mate,
            bestMove: bestMoveResult.bestMove,
            pv: bestInfo ? bestInfo.pv : [],
            depth: bestInfo ? bestInfo.depth : 0,
          };

          resolve(result);
          this._processQueue();
        }
      };

      this.worker.addEventListener('message', handler);

      // Send analysis commands
      this._send('ucinewgame');
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  /**
   * Analyze a position with multiple principal variations.
   * Useful for showing alternative good moves.
   * @param {string} fen - FEN string of the position to analyze
   * @param {number} [numPVs=3] - Number of principal variations to calculate
   * @param {number} [depth=14] - Search depth
   * @returns {Promise<MultiPVResult[]>} Array of results sorted by PV number
   * @throws {Error} If the engine is not initialized or analysis fails
   */
  async analyzeMultiPV(fen, numPVs = 3, depth = 14) {
    if (!this.ready) {
      throw new Error('Stockfish not initialized. Call init() first.');
    }

    return this._enqueue((resolve, reject) => {
      /** @type {Map<number, Object>} */
      const pvResults = new Map();

      const timeout = setTimeout(() => {
        this.worker.removeEventListener('message', handler);
        // Reset MultiPV
        this._send('setoption name MultiPV value 1');
        reject(new Error(`MultiPV analysis timed out for position: ${fen}`));
        this._processQueue();
      }, 60000);

      const handler = (e) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data);

        const info = this._parseInfoLine(line);
        if (info) {
          const pvNum = info.multipv;
          const existing = pvResults.get(pvNum);
          // Keep the deepest info per PV
          if (!existing || info.depth >= existing.depth) {
            pvResults.set(pvNum, info);
          }
        }

        const bm = this._parseBestMove(line);
        if (bm) {
          if (pvResults.size === 0) {
            return;
          }

          clearTimeout(timeout);
          this.worker.removeEventListener('message', handler);

          // Reset MultiPV to 1
          this._send('setoption name MultiPV value 1');

          // Sort by PV number and format results
          const results = [];
          for (let i = 1; i <= numPVs; i++) {
            const pvData = pvResults.get(i);
            if (pvData) {
              const normalized = this._normalizeScore(
                pvData.score,
                pvData.mate,
                fen
              );
              results.push({
                score: normalized.score,
                mate: normalized.mate,
                pv: pvData.pv,
                depth: pvData.depth,
                pvNumber: i,
              });
            }
          }

          resolve(results);
          this._processQueue();
        }
      };

      this.worker.addEventListener('message', handler);

      // Set MultiPV and start analysis
      this._send(`setoption name MultiPV value ${numPVs}`);
      this._send('ucinewgame');
      this._send(`position fen ${fen}`);
      this._send(`go depth ${depth}`);
    });
  }

  /**
   * Evaluate a specific move in a position.
   * Makes the move, analyzes the resulting position, and returns the evaluation
   * from WHITE's perspective.
   * @param {string} fen - FEN string of the position before the move
   * @param {string} move - Move in UCI notation (e.g., 'e2e4') or SAN (e.g., 'e4')
   * @returns {Promise<AnalysisResult>} Analysis result with score from WHITE's perspective
   * @throws {Error} If the move is invalid or analysis fails
   */
  async evaluateMove(fen, move) {
    if (!this.ready) {
      throw new Error('Stockfish not initialized. Call init() first.');
    }

    // Use chess.js to make the move and get the new FEN
    // We dynamically import chess.js to avoid a hard dependency at the module level
    const { Chess } = await import('chess.js');
    const chess = new Chess(fen);

    // Try both SAN and UCI formats
    let madeMove = null;
    try {
      madeMove = chess.move(move);
    } catch {
      // Try as UCI move (e.g., 'e2e4')
      try {
        madeMove = chess.move({
          from: move.substring(0, 2),
          to: move.substring(2, 4),
          promotion: move.length > 4 ? move[4] : undefined,
        });
      } catch {
        throw new Error(`Invalid move "${move}" in position "${fen}"`);
      }
    }

    if (!madeMove) {
      throw new Error(`Invalid move "${move}" in position "${fen}"`);
    }

    const newFen = chess.fen();

    // Analyze the resulting position
    // The score is already from WHITE's perspective
    return this.analyze(newFen);
  }

  /**
   * Send the 'stop' command to halt the current analysis.
   * The engine will return the best result found so far.
   */
  stop() {
    if (this.worker && this.isAnalyzing) {
      this.worker.postMessage('stop');
    }
  }

  /**
   * Destroy the Stockfish worker and clean up all resources.
   * After calling this, you must call init() again to use the service.
   */
  destroy() {
    if (this.worker) {
      this.worker.postMessage('quit');
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
    this.isAnalyzing = false;
    this.queue = [];
  }
}

/** Singleton instance of the Stockfish service */
export const stockfish = new StockfishService();
