// Shared landing timing keeps all six court moves, captures, sound and CPU replies in sync.
export const PUSH_DURATION = 0.88;
export const PUSH_IMPACT_TIME = 0.66;
export const PUSH_APPROACH_TIME = 0.10;
export function pushProgress(elapsed: number) {
  const t = Math.max(0, Math.min(1, (elapsed - PUSH_APPROACH_TIME) / (PUSH_IMPACT_TIME - PUSH_APPROACH_TIME)));
  return t * t * (3 - 2 * t);
}
