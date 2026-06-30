import { describe, expect, it } from 'vitest';
import { ARENA_THEME_BY_ID, DEFAULT_ARENA_THEME_ID, normalizeArenaThemeId } from './arenaThemes';

describe('arenaThemes', () => {
  it('normalizes unknown theme ids to the default', () => {
    expect(normalizeArenaThemeId('royal')).toBe('royal');
    expect(normalizeArenaThemeId('missing')).toBe(DEFAULT_ARENA_THEME_ID);
    expect(normalizeArenaThemeId(null)).toBe(DEFAULT_ARENA_THEME_ID);
  });

  it('defines scene palettes for every selectable theme', () => {
    expect(Object.keys(ARENA_THEME_BY_ID).sort()).toEqual(['arcade', 'inferno', 'royal', 'tournament']);
    expect(ARENA_THEME_BY_ID.inferno.scene.invalid).toBe('#ff3355');
  });
});
