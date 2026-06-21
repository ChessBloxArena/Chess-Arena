import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { COURT_ROLES } from './memeCourtGeometry';
import { PIECE_DEFEAT_DURATION, samplePieceDefeat } from './pieceDefeat';
import { buildMoveFeedback } from './moveFeedback';

describe('Intact piece defeat choreography', () => {
  it('starts at rest, stays finite, clears each victim and holds the defeated king', () => {
    for (const role of COURT_ROLES) {
      const start = samplePieceDefeat(role, 0);
      expect(start.opacity).toBe(1);
      expect(Object.entries(start).filter(([key]) => key !== 'opacity').every(([,v]) => v === 0)).toBe(true);
      for(let t=0;t<2;t+=.02) {
        const pose=samplePieceDefeat(role,t);
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(pose.opacity).toBeGreaterThanOrEqual(0);
        expect(pose.opacity).toBeLessThanOrEqual(1);
        expect(pose.slide).toBeLessThan(.8);
      }
      expect(samplePieceDefeat(role,PIECE_DEFEAT_DURATION).opacity).toBe(role==='k'?1:0);
      expect(samplePieceDefeat(role,20)).toEqual(samplePieceDefeat(role,PIECE_DEFEAT_DURATION));
    }
  });
  it('gives all six roles distinct poses and supports a settled reduced-motion king', () => {
    const signatures=COURT_ROLES.map(role=>JSON.stringify(samplePieceDefeat(role,.7)));
    expect(new Set(signatures).size).toBe(6);
    expect(samplePieceDefeat('k',0,true)).toEqual(samplePieceDefeat('k',PIECE_DEFEAT_DURATION));
    expect(samplePieceDefeat('k',0,true).leftLeg).not.toBe(samplePieceDefeat('k',0,true).rightLeg);
  });
  it('uses a real checkmate for the king, and identifies en passant at the victim square', () => {
    const mate = new Chess('7k/8/5KQ1/8/8/8/8/8 w - - 0 1');
    const feedback = buildMoveFeedback(mate,mate.move('Qg7#'));
    expect(feedback.isCheckmate).toBe(true);
    expect(feedback.targetKingSquare).toBe('h8');
    expect(feedback.captured).toBeUndefined();
    const ep=new Chess();
    for(const san of ['e4','a6','e5','d5']) ep.move(san);
    const capture=buildMoveFeedback(ep,ep.move('exd6'));
    expect(capture.capturedSquare).toBe('d5');
    expect(capture.captured).toBe('p');
  });
});
