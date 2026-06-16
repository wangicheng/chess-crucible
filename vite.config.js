import { defineConfig } from 'vite';

export default defineConfig({
  // Use ./src as the root directory for source files
  root: './src',
  envDir: '../',

  // Serve public/ files (favicon, stockfish worker/wasm) at the root URL
  publicDir: '../public',

  // Dev server configuration
  server: {
    port: 5173,

    // Required headers for SharedArrayBuffer support (Stockfish multi-threading)
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },

  },

  // Build output configuration
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },

  // Worker configuration for Stockfish WASM workers
  worker: {
    format: 'es',
  },
});
