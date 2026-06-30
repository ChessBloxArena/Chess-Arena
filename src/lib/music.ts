export const GAME_SOUNDTRACK = { title: 'Cloud Nine', src: '/audio/cloud-nine.m4a' } as const;
let audio: HTMLAudioElement | null = null;
let requested = false;
let playing = false;
let requestedVolume = .30;
let requestVersion = 0;

function removeGestureRetry() {
  document.removeEventListener('pointerdown', retryAfterGesture, true);
  document.removeEventListener('keydown', retryAfterGesture, true);
}
function retryAfterGesture() {
  if (requested) playCurrentTrack();
}
function getAudio() {
  if (!audio) {
    audio = new Audio(GAME_SOUNDTRACK.src);
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = requestedVolume;
    audio.hidden = true;
    audio.dataset.soundtrack = GAME_SOUNDTRACK.title;
    audio.setAttribute('aria-hidden', 'true');
    document.body.appendChild(audio);
    audio.addEventListener('error', () => { playing = false; });
  }
  return audio;
}
function playCurrentTrack() {
  const version = requestVersion;
  const player = getAudio();
  void player.play().then(() => {
    if (version !== requestVersion) return;
    if (!requested) { player.pause(); return; }
    playing = true;
    removeGestureRetry();
  }).catch(() => {
    if (version === requestVersion) playing = false;
    // A browser may require a tap on direct entry. Keep the user's saved choice
    // and retry on their next interaction; never show another acceptance modal.
  });
}
export function startMusic() {
  if (requested) return;
  requested = true;
  requestVersion += 1;
  document.addEventListener('pointerdown', retryAfterGesture, true);
  document.addEventListener('keydown', retryAfterGesture, true);
  playCurrentTrack();
}
export function stopMusic() {
  requested = false;
  playing = false;
  requestVersion += 1;
  removeGestureRetry();
  audio?.pause();
}
export function isMusicPlaying() { return playing; }
export function setMusicVolume(volume: number) {
  if (!Number.isFinite(volume)) return;
  requestedVolume = Math.max(0, Math.min(1, volume));
  if (audio) audio.volume = requestedVolume;
}
// A Vite refresh must not leave an older soundtrack playing in the background.
if (import.meta.hot) import.meta.hot.dispose(() => { stopMusic(); audio?.remove(); audio = null; });
