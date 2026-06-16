/**
 * Stockfish worker entry point.
 * Loaded by StockfishService as a real file (not blob URL) so that
 * Stockfish's Emscripten code can resolve relative paths for WASM
 * and create pthread workers with proper hash-based URLs.
 */
importScripts('https://cdn.jsdelivr.net/npm/stockfish@16.0.0/src/stockfish-nnue-16.js');
