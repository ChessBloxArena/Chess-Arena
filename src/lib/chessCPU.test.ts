import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { getBestMove } from './chessCPU';

function makeSeededRandom(seedValue: number) {
  let seed = seedValue;

  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('getBestMove', () => {
  it('chooses varied sensible opening replies on stronger difficulties', () => {
    const nf3Game = new Chess();
    nf3Game.move('Nf3');

    expect(getBestMove(nf3Game, 'hard', () => 0)).toBe('d5');
    expect(getBestMove(nf3Game, 'hard', () => 0)).not.toBe('e5');

    const e4Game = new Chess();
    e4Game.move('e4');

    expect(getBestMove(e4Game, 'hard', () => 0)).toBe('c5');
    expect(getBestMove(e4Game, 'hard', () => 0.2)).toBe('e5');
  });

  it('chooses an immediate checkmate on hard difficulty', () => {
    const game = new Chess('rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2');

    expect(getBestMove(game, 'hard', () => 0.42)).toBe('Qh4#');
  });

  it('does not mutate the game while searching', () => {
    const game = new Chess();
    const startingFen = game.fen();

    getBestMove(game, 'medium', () => 0.42);

    expect(game.fen()).toBe(startingFen);
  });

  it('returns legal moves without mutating varied positions', () => {
    const random = makeSeededRandom(12_345);
    const game = new Chess();
    const positions: string[] = [game.fen()];

    for (let ply = 0; ply < 28 && !game.isGameOver(); ply += 1) {
      const legalMoves = game.moves();
      const move = legalMoves[Math.floor(random() * legalMoves.length)];
      game.move(move);
      positions.push(game.fen());
    }

    const stressCases = [
      ...positions.map((fen) => ({ fen, difficulty: 'easy' as const })),
      ...positions.filter((_, index) => index % 2 === 0).map((fen) => ({ fen, difficulty: 'medium' as const })),
      ...positions.slice(0, 6).map((fen) => ({ fen, difficulty: 'hard' as const })),
    ];

    for (const { fen, difficulty } of stressCases) {
      const candidate = new Chess(fen);
      const beforeFen = candidate.fen();
      const legalMoves = candidate.moves();
      const bestMove = getBestMove(candidate, difficulty, random);

      if (legalMoves.length === 0) {
        expect(bestMove).toBeNull();
      } else {
        expect(legalMoves).toContain(bestMove);
      }
      expect(candidate.fen()).toBe(beforeFen);
    }
  }, 15_000);

  it('keeps CPU choices legal through sampled game playouts', () => {
    const cases = [
      { difficulty: 'easy' as const, seeds: [101, 202, 303], plies: 48 },
      { difficulty: 'medium' as const, seeds: [505, 606], plies: 20 },
      { difficulty: 'hard' as const, seeds: [808], plies: 6 },
    ];

    for (const { difficulty, seeds, plies } of cases) {
      for (const seed of seeds) {
        const random = makeSeededRandom(seed);
        const game = new Chess();

        for (let ply = 0; ply < plies && !game.isGameOver(); ply += 1) {
          const beforeFen = game.fen();
          const legalMoves = game.moves();
          const move = getBestMove(game, difficulty, random);

          expect(move, `${difficulty} seed ${seed} ply ${ply}`).not.toBeNull();
          expect(legalMoves, `${difficulty} seed ${seed} ply ${ply}`).toContain(move);
          expect(game.fen(), `${difficulty} seed ${seed} ply ${ply}`).toBe(beforeFen);
          expect(game.move(move!), `${difficulty} seed ${seed} ply ${ply}`).not.toBeNull();
        }
      }
    }
  }, 20_000);
});
