import { PUSH_APPROACH_TIME, PUSH_IMPACT_TIME, pushProgress } from './pushMotion';

export const PIECE_MOVE_DURATION = 1.08;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** All six signatures land on the shared capture/SFX beat, then settle in place. */
export function samplePieceMotion(role: string, elapsed: number, reducedMotion = false) {
  const motion = { progress: 1, lift: 0, yaw: 0, lean: 0, roll: 0, sway: 0, compression: 0 };
  if (reducedMotion || elapsed >= PIECE_MOVE_DURATION) return motion;
  const t = clamp((elapsed - PUSH_APPROACH_TIME) / (PUSH_IMPACT_TIME - PUSH_APPROACH_TIME));
  const p = pushProgress(elapsed);
  const arc = Math.sin(Math.PI * t);
  const landing = clamp((elapsed - PUSH_IMPACT_TIME) / (PIECE_MOVE_DURATION - PUSH_IMPACT_TIME));
  const settle = Math.sin(landing * Math.PI * 3) * Math.pow(1 - landing, 2);
  const windup = Math.sin(clamp(elapsed / PUSH_APPROACH_TIME) * Math.PI);
  motion.progress = p;
  switch (role) {
    case 'r': // A planted wind-up, forward shoulder charge, and a heavy landing.
      motion.progress = 1 - Math.pow(1 - t, 3);
      motion.lean = .23 * arc;
      motion.lift = .04 * arc;
      motion.compression = .06 * windup + .055 * settle;
      break;
    case 'n': // A single high vault clears the occupied ranks below.
      motion.lift = 2.15 * arc;
      motion.lean = -.25 * Math.sin(t * Math.PI * 2) * arc;
      motion.yaw = .30 * arc;
      motion.compression = .09 * windup + .09 * settle;
      break;
    case 'b': // A calm levitation with a sideways robe sweep.
      motion.lift = .32 * arc;
      motion.sway = .13 * Math.sin(t * Math.PI * 2) * arc;
      motion.yaw = -.52 * arc;
      motion.roll = .07 * Math.sin(t * Math.PI * 2);
      break;
    case 'q': // One complete, eased pirouette ending in the exact resting pose.
      motion.lift = .17 * arc;
      motion.yaw = Math.PI * 2 * p;
      motion.roll = -.08 * arc;
      motion.compression = .025 * settle;
      break;
    case 'k': // Two slow, weighty steps with a small royal shoulder rock.
      motion.lift = .095 * Math.abs(Math.sin(t * Math.PI * 2));
      motion.roll = .075 * Math.sin(t * Math.PI * 4) * arc;
      motion.lean = .07 * arc;
      motion.compression = .04 * windup + .045 * settle;
      break;
    default: // An eager two-hop shuffle, with a softer second hop.
      motion.lift = .32 * Math.abs(Math.sin(t * Math.PI * 2)) * (1 - .2 * t);
      motion.roll = .11 * Math.sin(t * Math.PI * 2) * arc;
      motion.lean = .1 * arc;
      motion.compression = .06 * windup + .04 * settle;
  }
  // A full turn is equivalent to zero; normalize after landing to avoid drift.
  if (t === 1) motion.yaw = 0;
  return motion;
}
