/** Authored intact-body defeat poses, sampled in seconds after the capture lands. */
export const PIECE_DEFEAT_DURATION = 1.15;
export interface DefeatPose {
  slide: number; lift: number; pitch: number; roll: number; yaw: number;
  bodyPitch: number; bodyDrop: number; leftLeg: number; rightLeg: number;
  headPitch: number; headRoll: number; opacity: number;
}
export interface DefeatClock { elapsed: number; active: boolean }
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const phase = (t: number, start: number, end: number) => smooth((t - start) / (end - start));

export function samplePieceDefeat(role: string, elapsed: number, reducedMotion = false): DefeatPose {
  const t = reducedMotion ? 1 : clamp(elapsed / PIECE_DEFEAT_DURATION);
  const settle = phase(t, .12, .73);
  const pose: DefeatPose = { slide: 0, lift: 0, pitch: 0, roll: 0, yaw: 0, bodyPitch: 0, bodyDrop: 0,
    leftLeg: 0, rightLeg: 0, headPitch: 0, headRoll: 0, opacity: role === 'k' ? 1 : 1 - phase(t, .64, 1) };
  switch (role) {
    case 'r': // A heavy sideways topple; the tower hat follows with a delayed wobble.
      pose.slide = .66 * settle; pose.lift = .22 * settle;
      pose.roll = -1.32 * settle + Math.sin(t * 24) * .045 * Math.sin(Math.PI * t);
      pose.headRoll = .19 * Math.sin(t * 20) * Math.sin(Math.PI * t);
      break;
    case 'n': // Feet up, a backward tumble, then settle on the shoulder.
      pose.slide = .73 * settle; pose.lift = .58 * Math.sin(Math.PI * settle) + .23 * settle;
      pose.pitch = -1.80 * settle; pose.roll = -.95 * phase(t, .34, .83);
      pose.leftLeg = -.7 * Math.sin(Math.PI * settle); pose.rightLeg = -.45 * Math.sin(Math.PI * settle);
      pose.headPitch = -.15 * settle;
      break;
    case 'b': // Hands remain joined through a deep bow and a gentle kneeling dissolve.
      pose.slide = .40 * settle; pose.bodyPitch = 1.02 * settle; pose.bodyDrop = -.23 * settle;
      pose.leftLeg = .72 * settle; pose.rightLeg = .72 * settle; pose.headPitch = .30 * settle;
      break;
    case 'q': // An interrupted pirouette becomes a theatrical sideways faint.
      pose.yaw = Math.PI * 1.3 * phase(t, 0, .63); pose.slide = .71 * settle;
      pose.roll = 1.30 * phase(t, .25, .8); pose.lift = .24 * settle;
      pose.headRoll = -.25 * phase(t, .34, .84); pose.headPitch = -.17 * settle;
      break;
    case 'k': // A king is never captured: one knee, bowed head, crown still attached.
      pose.bodyDrop = -.24 * settle; pose.bodyPitch = .28 * settle;
      pose.leftLeg = -.78 * settle; pose.rightLeg = 1.10 * settle;
      pose.headPitch = .52 * phase(t, .30, .92); pose.headRoll = .09 * settle;
      break;
    default: // Two startled little steps and a seated flop.
      pose.slide = .64 * settle; pose.lift = .12 * Math.sin(t * Math.PI * 3) * (1 - settle);
      pose.bodyDrop = -.25 * settle; pose.bodyPitch = -.30 * settle;
      pose.leftLeg = -1.20 * settle; pose.rightLeg = -1.04 * settle;
      pose.headPitch = -.19 * settle; pose.headRoll = .12 * Math.sin(t * 17) * (1 - settle);
  }
  return pose;
}
