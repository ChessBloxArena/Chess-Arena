import { PUSH_IMPACT_TIME } from './pushMotion';

export const CAPTURE_IMPACT = PUSH_IMPACT_TIME;
export const CAPTURE_HOLD_END = CAPTURE_IMPACT + .14;
export const CAPTURE_CLEAR = 1.20;
export const CAPTURE_DURATION = 1.52;
export const CAPTURE_STANDOFF = .94;
export const captureStandoff = (role: string) => role === 'p' ? .76 : role === 'k' ? .86 : CAPTURE_STANDOFF;
export interface CaptureAnimation { startedAt: number; piece: string; victimHeight: number }

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const phase = (t: number, a: number, b: number) => smooth((t - a) / (b - a));

/** One clock for attacker, victim and impact. The destination stays reserved until clear. */
export function sampleCaptureMotion(role: string, elapsed: number, distance: number, victimHeight = 1.84, reduced = false) {
  const pose = { progress: 1, lift: 0, yaw: 0, lean: 0, roll: 0, compression: 0, face: 0, leftJab: 0, rightJab: 0, twist: 0 };
  if (reduced || elapsed >= CAPTURE_DURATION) return pose;
  const t = Math.max(0, elapsed);
  const heldTime = t >= CAPTURE_IMPACT && t <= CAPTURE_HOLD_END ? CAPTURE_IMPACT : t;
  const wind = phase(heldTime, 0, .14);
  const strike = phase(heldTime, .43, CAPTURE_IMPACT);
  const retract = 1 - phase(t, CAPTURE_HOLD_END, 1.06);
  const jab = strike * retract;
  const occupy = phase(t, CAPTURE_CLEAR, CAPTURE_DURATION);
  pose.face = phase(t, 0, .25) * (1 - phase(t, 1.24, CAPTURE_DURATION));
  if (role === 'n') {
    // Feet meet the top of the victim, rebound, then land only after the square clears.
    pose.progress = phase(heldTime, .14, .48);
    const apex = victimHeight + 1.35;
    const contactHeight = victimHeight + .055;
    if (t < .40) pose.lift = apex * phase(t, .12, .40);
    else if (t <= CAPTURE_HOLD_END) pose.lift = apex + (contactHeight - apex) * phase(heldTime, .43, CAPTURE_IMPACT);
    else if (t < 1.04) pose.lift = contactHeight + .90 * phase(t, CAPTURE_HOLD_END, 1.04);
    else pose.lift = (contactHeight + .90) * (1 - phase(t, 1.04, 1.43));
    pose.compression = .16 * Math.sin(Math.PI * phase(t, 0, .14)) + .17 * Math.sin(Math.PI * phase(t, 1.43, CAPTURE_DURATION));
    pose.leftJab = pose.rightJab = .8 * wind * (1 - phase(t, 1.10, 1.43));
    pose.lean = -.14 * Math.sin(Math.PI * phase(heldTime, .14, CAPTURE_IMPACT));
    return pose;
  }
  const contact = Math.max(0, 1 - captureStandoff(role) / Math.max(distance, captureStandoff(role)));
  pose.progress = contact * phase(heldTime, .14, .43) + (1 - contact) * occupy;
  // Lift the plinth clear of neighboring plinths while turning to face the target.
  pose.lift = .18 * wind * (1 - occupy);
  pose.lean = .26 * jab;
  pose.compression = .09 * Math.sin(Math.PI * phase(t, 0, .14));
  switch (role) {
    case 'r': pose.leftJab = pose.rightJab = jab; pose.lean = .32 * jab; break;
    case 'b': pose.leftJab = pose.rightJab = jab; pose.lift += .13 * wind * (1 - occupy); pose.twist = -.12 * jab; break;
    case 'q': pose.leftJab = jab; pose.rightJab = .25 * jab; pose.twist = -.65 * jab; pose.yaw = Math.PI * 2 * phase(heldTime, .14, .43); break;
    case 'k': pose.leftJab = .82 * jab; pose.rightJab = jab; pose.lean = .22 * jab; break;
    default: pose.rightJab = jab; pose.leftJab = .32 * jab; pose.twist = -.22 * jab;
  }
  return pose;
}

export function sampleCaptureVictim(attacker: string, elapsed: number, reduced = false) {
  const pose = { forward: 0, sideways: 0, lift: 0, scaleY: 1, scaleXZ: 1, opacity: 1, defeatTime: 0 };
  if (reduced || elapsed >= CAPTURE_CLEAR) return { ...pose, opacity: 0 };
  if (elapsed <= CAPTURE_HOLD_END) return pose;
  const out = phase(elapsed, CAPTURE_HOLD_END, 1.12);
  pose.defeatTime = (elapsed - CAPTURE_HOLD_END) * 3;
  pose.opacity = 1 - phase(elapsed, .98, CAPTURE_CLEAR);
  if (attacker === 'n') {
    const squash = phase(elapsed, CAPTURE_HOLD_END, .94);
    pose.scaleY = 1 - .9 * squash;
    pose.scaleXZ = 1 + .12 * squash;
    pose.sideways = .35 * out;
  } else {
    pose.forward = .40 * out;
    pose.sideways = 1.25 * out;
    pose.lift = 1.25 * Math.sin(Math.PI * out) + .65 * out;
  }
  return pose;
}
