import { PUSH_IMPACT_TIME } from './pushMotion';
let audioCtx: AudioContext | null = null;
let master: GainNode | null = null;
let soundEnabled = true;
type WindowWithWebKitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as WindowWithWebKitAudio).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
    master = audioCtx.createGain();
    master.gain.value = soundEnabled ? 1 : 0;
    master.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined);
  return audioCtx;
}

export function setSoundEnabled(enabled: boolean) {
  soundEnabled = enabled;
  // This also silences notes already scheduled in a check/start flourish.
  if (master && audioCtx) master.gain.setTargetAtTime(enabled ? 1 : 0, audioCtx.currentTime, .008);
}
export function isSoundEnabled() { return soundEnabled; }

/** Soft, tuned wooden/glass partials. Audio-clock scheduling avoids timer jitter. */
function chime(freq: number, duration: number, volume: number, delay = 0, wooden = false) {
  if (!soundEnabled) return;
  const ctx = getCtx();
  if (!ctx || !master) return;
  const at = ctx.currentTime + delay;
  const partials = wooden ? [[1, 1], [1.49, .27], [2.12, .1]] : [[1, 1], [2, .14], [3, .035]];
  for (const [ratio, strength] of partials) {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * ratio, at);
    if (wooden) osc.frequency.exponentialRampToValueAtTime(freq * ratio * .78, at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume * strength, at + .004);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(master);
    osc.start(at); osc.stop(at + duration + .012);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
}

export function playMenuClick() { chime(740, .065, .045, 0, true); }
export function playMenuSelect() { chime(587.33, .16, .045); chime(880, .2, .034, .065); }
const landingDelay = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : PUSH_IMPACT_TIME;

export function playMoveSound() { const at = landingDelay(); chime(330, .12, .072, at, true); chime(659.25, .19, .026, at + .025); }
export function playCaptureSound() { const at = landingDelay(); chime(155, .19, .11, at, true); chime(587.33, .24, .047, at + .04); chime(880, .32, .036, at + .095); }
export function playIllegalMoveSound() { chime(246.94, .12, .047); chime(220, .16, .032, .075); }
export function playCheckSound() { const at = landingDelay(); chime(739.99, .25, .051, at); chime(587.33, .22, .039, at + .13); chime(739.99, .4, .045, at + .27); }
export function playTurnReadySound() { chime(659.25, .17, .035); chime(880, .26, .026, .085); }
export function playGameOverSound() { [293.66,369.99,440,587.33].forEach((f,i) => chime(f, .85, .041, i*.13)); }
export function playStartSound() { [440,554.37,659.25,880].forEach((f,i) => chime(f, .36, .037, i*.09)); }
