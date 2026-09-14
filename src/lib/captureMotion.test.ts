import { describe, expect, it } from 'vitest';
import { CAPTURE_CLEAR, CAPTURE_DURATION, CAPTURE_HOLD_END, CAPTURE_IMPACT, captureStandoff, sampleCaptureMotion, sampleCaptureVictim } from './captureMotion';
import { COURT_HEIGHTS, COURT_ROLES, getCourtModel } from './memeCourtGeometry';

describe('synchronized capture choreography', () => {
  it('holds the contact pose, then clears the victim before occupying its square', () => {
    for (const role of COURT_ROLES) {
      const impact = sampleCaptureMotion(role, CAPTURE_IMPACT, 1.28);
      expect(sampleCaptureMotion(role, CAPTURE_IMPACT + .07, 1.28)).toEqual(impact);
      for (let t = 0; t <= CAPTURE_DURATION; t += 1 / 120) {
        const attacker = sampleCaptureMotion(role, t, 1.28);
        const victim = sampleCaptureVictim(role, t);
        expect(Object.values(attacker).every(Number.isFinite)).toBe(true);
        expect(Object.values(victim).every(Number.isFinite)).toBe(true);
        expect(attacker.progress).toBeGreaterThanOrEqual(0);
        expect(attacker.progress).toBeLessThanOrEqual(1);
        if (role !== 'n' && t < CAPTURE_CLEAR) expect((1 - attacker.progress) * 1.28).toBeGreaterThanOrEqual(captureStandoff(role) - 1e-8);
        if (role === 'n' && t >= .48 && t <= CAPTURE_HOLD_END) expect(attacker.lift).toBeGreaterThanOrEqual(1.84);
      }
      expect(sampleCaptureVictim(role, CAPTURE_CLEAR).opacity).toBe(0);
      const rest = sampleCaptureMotion(role, CAPTURE_DURATION, 1.28);
      expect(rest.progress).toBe(1);
      expect(Object.entries(rest).filter(([key]) => key !== 'progress').every(([, value]) => value === 0)).toBe(true);
      expect(sampleCaptureMotion(role, .3, 1.28, 1.84, true)).toEqual(rest);
      expect(sampleCaptureVictim(role, .3, true).opacity).toBe(0);
    }
  });

  it('stomps above every victim height and gives six distinct attack poses', () => {
    for (const height of Object.values(COURT_HEIGHTS)) expect(sampleCaptureMotion('n', CAPTURE_IMPACT, 2.86, height).lift).toBeGreaterThan(height);
    const poses = COURT_ROLES.map(role => JSON.stringify(sampleCaptureMotion(role, CAPTURE_IMPACT, 2.56)));
    expect(new Set(poses).size).toBe(6);
    expect(sampleCaptureVictim('n', .94).scaleY).toBeCloseTo(.1);
    expect(sampleCaptureVictim('p', 1.12).sideways).toBeGreaterThan(1);
  });

  it('has independent arm geometry connected to finite shoulder and elbow pivots', () => {
    for (const role of COURT_ROLES) {
      const model = getCourtModel(role, '#fff1d7', '#b89b60');
      for (const side of ['left', 'right'] as const) {
        const joints = model.arms[side];
        expect(Object.values(joints).flat().every(Number.isFinite)).toBe(true);
        expect(model.parts[`${side}Arm`].attributes.position.count).toBeGreaterThan(0);
        expect(model.parts[`${side}Forearm`].attributes.position.count).toBeGreaterThan(0);
      }
    }
  });
});
