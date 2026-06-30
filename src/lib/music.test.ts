import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let player: HTMLAudioElement;
let play: ReturnType<typeof vi.fn>;
let music: typeof import('./music');
async function flush() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(async () => {
  vi.resetModules();
  play = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('Audio', vi.fn((src: string) => {
    player = document.createElement('audio'); player.src = src;
    player.play = play; player.pause = vi.fn();
    return player;
  }));
  music = await import('./music');
});
afterEach(() => { music.stopMusic(); player?.remove(); vi.unstubAllGlobals(); });
describe('Cloud Nine playback', () => {
  it('loads the new loop and reuses one player across mute and resume', async () => {
    music.startMusic(); await flush();
    expect(player.src).toContain('/audio/cloud-nine.m4a');
    expect(player.loop).toBe(true);
    expect(music.isMusicPlaying()).toBe(true);
    music.stopMusic(); expect(player.pause).toHaveBeenCalled();
    expect(music.isMusicPlaying()).toBe(false);
    music.startMusic(); await flush();
    expect(document.querySelectorAll('[data-soundtrack]')).toHaveLength(1);
    expect(play).toHaveBeenCalledTimes(2);
  });
  it('retries blocked autoplay on a gesture, but never restarts after mute', async () => {
    play.mockRejectedValueOnce(new DOMException('Tap required', 'NotAllowedError'));
    music.startMusic(); await flush(); expect(music.isMusicPlaying()).toBe(false);
    document.dispatchEvent(new Event('pointerdown')); await flush();
    expect(music.isMusicPlaying()).toBe(true);
    music.stopMusic(); document.dispatchEvent(new Event('pointerdown')); await flush();
    expect(play).toHaveBeenCalledTimes(2);
  });
  it('ignores completion of an old play request after the user stops music', async () => {
    let finish!: () => void;
    play.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    music.startMusic(); music.stopMusic(); finish(); await flush();
    expect(music.isMusicPlaying()).toBe(false);
    expect(player.pause).toHaveBeenCalled();
  });
});
