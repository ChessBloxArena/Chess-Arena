import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { buildMoveFeedback } from './moveFeedback';

describe('buildMoveFeedback', () => {
  it('tracks the king square when a move gives check', () => {
    const game = new Chess('4k3/8/8/8/8/8/4R3/4K3 w - - 0 1');
    const checkingMove = game.move('Re7+');

    expect(checkingMove).toBeTruthy();
    const feedback = buildMoveFeedback(game, checkingMove!);

    expect(feedback.isCheck).toBe(true);
    expect(feedback.tone).toBe('check');
    expect(feedback.targetKingSquare).toBe('e8');
  });

  it('tracks the real captured square for en passant', () => {
    const game = new Chess();
    game.move('e4');
    game.move('a6');
    game.move('e5');
    game.move('d5');
    const enPassantMove = game.move('exd6');

    expect(enPassantMove).toBeTruthy();
    const feedback = buildMoveFeedback(game, enPassantMove!);

    expect(feedback.isCapture).toBe(true);
    expect(feedback.captured).toBe('p');
    expect(feedback.to).toBe('d6');
    expect(feedback.capturedSquare).toBe('d5');
  });
});
