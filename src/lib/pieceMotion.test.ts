import { describe, expect, it } from 'vitest';
import { samplePieceMotion, PIECE_MOVE_DURATION } from './pieceMotion';
import { PUSH_IMPACT_TIME } from './pushMotion';

const roles = ['p', 'r', 'n', 'b', 'q', 'k'];
describe('court move choreography', () => {
  it('lands every role on the capture beat and restores its exact rest pose', () => {
    for (const role of roles) {
      expect(samplePieceMotion(role, 0).progress).toBe(0);
      expect(samplePieceMotion(role, PUSH_IMPACT_TIME).progress).toBe(1);
      expect(samplePieceMotion(role, PUSH_IMPACT_TIME).lift).toBeCloseTo(0);
      expect(samplePieceMotion(role, PIECE_MOVE_DURATION)).toEqual({ progress: 1, lift: 0, yaw: 0, lean: 0, roll: 0, sway: 0, compression: 0 });
    }
  });
  it('gives each role a different path and lifts the knight above the cast', () => {
    expect(new Set(roles.map(role => JSON.stringify(samplePieceMotion(role, .3)))).size).toBe(6);
    expect(samplePieceMotion('n', .38).lift).toBeGreaterThan(2);
    for (const role of roles) for (let t = 0; t < 1.2; t += .01) {
      const motion = samplePieceMotion(role, t);
      expect(Object.values(motion).every(Number.isFinite)).toBe(true);
      expect(motion.progress).toBeGreaterThanOrEqual(0);
      expect(motion.progress).toBeLessThanOrEqual(1);
    }
  });
  it('skips all travel and secondary motion when reduced motion is requested', () => {
    for (const role of roles) expect(samplePieceMotion(role, .3, true)).toEqual(samplePieceMotion(role, 2));
  });
});
