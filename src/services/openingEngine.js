/**
 * @fileoverview Opening Engine for selecting the next move to challenge the user.
 * Uses Lichess Opening Explorer, Stockfish evaluations, and Unified Attack Score.
 * @module services/openingEngine
 */

import { openingStore } from '../stores/openingStore.js';
// We assume stockfish service is available for quick eval if needed, though for traps we might just rely on winrates.
// import { stockfish } from './stockfish.js';

const CACHE = new Map();

// Configuration weights for the Attack Score
const WEIGHTS = {
  e: 100, // Mistake rate
  u: 50,  // Urgency (cooldown passed)
  p: 20,  // Frequency probability
  v: 30,  // Novelty (1 / 1 + V)
};

export class OpeningEngine {
  constructor() {
    this.token = import.meta.env.VITE_LICHESS_TOKEN || null;
    this.openingsDict = null;
    this.dictPromise = null;
  }

  async loadDictionary() {
    if (!this.dictPromise) {
      this.dictPromise = fetch('/openings.json')
        .then(res => res.json())
        .then(data => {
          this.openingsDict = data;
        })
        .catch(err => {
          console.error('Failed to load openings dictionary', err);
          this.openingsDict = {};
        });
    }
    await this.dictPromise;
  }

  async fetchLichessExplorer(url) {
    if (CACHE.has(url)) return CACHE.get(url);
    
    const headers = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Lichess API rate limit reached.');
        }
        return null;
      }
      const data = await response.json();
      CACHE.set(url, data);
      return data;
    } catch (err) {
      console.error('Lichess API error:', err);
      return null;
    }
  }

  getEloRange(elo) {
    const numElo = parseInt(elo, 10);
    if (isNaN(numElo)) return '1400,1600';
    if (numElo < 1200) return '0,1000,1200';
    if (numElo < 1400) return '1200,1400';
    if (numElo < 1600) return '1400,1600';
    if (numElo < 1800) return '1600,1800';
    if (numElo < 2000) return '1800,2000';
    if (numElo < 2200) return '2000,2200';
    if (numElo < 2500) return '2200,2500';
    return '2500';
  }

  async getCandidateMoves(fen, userElo) {
    await this.loadDictionary();
    const eloParam = this.getEloRange(userElo);
    const mastersUrl = `https://explorer.lichess.org/masters?variant=standard&fen=${encodeURIComponent(fen)}`;
    const lichessUrl = `https://explorer.lichess.org/lichess?variant=standard&speeds=blitz,rapid,classical&ratings=${eloParam}&fen=${encodeURIComponent(fen)}`;

    const [mastersData, lichessData] = await Promise.all([
      this.fetchLichessExplorer(mastersUrl),
      this.fetchLichessExplorer(lichessUrl)
    ]);

    const candidates = new Map();

    const processMoves = (data, isMaster) => {
      if (!data || !data.moves) return;
      const totalGames = data.moves.reduce((sum, m) => sum + m.white + m.draws + m.black, 0);
      if (totalGames === 0) return;

      for (const m of data.moves) {
        const games = m.white + m.draws + m.black;
        const frequency = games / totalGames;
        
        if (isMaster && frequency < 0.01) continue;
        if (!isMaster && frequency < 0.05) continue;

        if (!candidates.has(m.san)) {
          candidates.set(m.san, { san: m.san, uci: m.uci, masterFreq: 0, peerFreq: 0 });
        }
        
        const candidate = candidates.get(m.san);
        if (isMaster) candidate.masterFreq = frequency;
        else candidate.peerFreq = frequency;
      }
    };

    processMoves(mastersData, true);
    processMoves(lichessData, false);

    let openingName = null;
    const baseFen = fen.split(' ').slice(0, 4).join(' ');
    
    if (this.openingsDict && this.openingsDict[baseFen]) {
      openingName = this.openingsDict[baseFen];
    } else if (mastersData && mastersData.opening && mastersData.opening.name) {
      openingName = mastersData.opening.name;
    } else if (lichessData && lichessData.opening && lichessData.opening.name) {
      openingName = lichessData.opening.name;
    }

    return {
      candidates: Array.from(candidates.values()),
      openingName
    };
  }

  calculateScore(fen, candidate) {
    const stat = openingStore.getStat(fen, candidate.san);
    
    const eScore = stat.e;
    const effectiveU = Math.max(0, stat.u - stat.cooldownTarget);
    // cap U score so it doesn't overpower everything forever
    const uScore = Math.min(10, effectiveU) / 10; 
    
    // P(m) is the highest frequency from either master or peer
    const pScore = Math.max(candidate.masterFreq, candidate.peerFreq);
    
    const vScore = 1 / (1 + stat.v);

    let baseScore = 
      WEIGHTS.e * eScore + 
      WEIGHTS.u * uScore + 
      WEIGHTS.p * pScore + 
      WEIGHTS.v * vScore;

    return baseScore;
  }

  async getEngineMove(fen, userElo) {
    const { candidates, openingName } = await this.getCandidateMoves(fen, userElo);
    
    if (candidates.length === 0) {
      return { move: null, openingName }; // Fallback to stockfish or random move in the UI if no opening book moves
    }

    const scoredCandidates = candidates.map(c => {
      const score = this.calculateScore(fen, c);
      return { ...c, score };
    });

    // Roulette wheel selection
    const totalScore = scoredCandidates.reduce((sum, c) => sum + c.score, 0);
    if (totalScore <= 0 || Number.isNaN(totalScore)) {
      // Uniform random if scores are zero or NaN
      return scoredCandidates[Math.floor(Math.random() * scoredCandidates.length)];
    }

    let rand = Math.random() * totalScore;
    for (const c of scoredCandidates) {
      rand -= c.score;
      if (rand <= 0) {
        return { move: c, openingName };
      }
    }
    return { move: scoredCandidates[scoredCandidates.length - 1], openingName };
  }
}

export const openingEngine = new OpeningEngine();
