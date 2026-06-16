import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Chess } from 'chess.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const urls = [
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/a.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/b.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/c.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/d.tsv',
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/e.tsv'
];

async function main() {
  const fens = {};

  for (const url of urls) {
    console.log(`Downloading ${url}...`);
    const response = await fetch(url);
    const text = await response.text();
    const lines = text.split('\n');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const name = parts[1];
      const pgn = parts[2];

      const chess = new Chess();
      try {
        chess.loadPgn(pgn);
        const fen = chess.fen();
        // Just store the base FEN (without halfmove and fullmove numbers) to handle transpositions easily?
        // Wait, halfmove and fullmove are at the end. e.g. "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
        // Better to strip the last two fields to match positions exactly.
        const fenParts = fen.split(' ');
        const baseFen = fenParts.slice(0, 4).join(' '); 
        fens[baseFen] = name;
      } catch (err) {
        console.error(`Failed to parse PGN: ${pgn}`, err);
      }
    }
  }

  const outputPath = path.join(__dirname, '..', 'public', 'openings.json');
  fs.writeFileSync(outputPath, JSON.stringify(fens));
  console.log(`Saved to ${outputPath}, total entries: ${Object.keys(fens).length}`);
}

main().catch(console.error);
