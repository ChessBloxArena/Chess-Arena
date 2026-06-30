import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeLocalGameConfig, readLocalGameConfig, saveLocalGameConfig } from './localGameConfig';

function createMemoryStorage(): Storage {
  let values: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(values).length;
    },
    clear: vi.fn(() => {
      values = {};
    }),
    getItem: vi.fn((key: string) => values[key] ?? null),
    key: vi.fn((index: number) => Object.keys(values)[index] ?? null),
    removeItem: vi.fn((key: string) => {
      delete values[key];
    }),
    setItem: vi.fn((key: string, value: string) => {
      values[key] = value;
    }),
  };
}

describe('local game config', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves and restores CPU launch settings for refresh recovery', () => {
    saveLocalGameConfig({
      mode: 'cpu',
      difficulty: 'hard',
      soundEnabled: true,
      cpuCharacter: 'vinnie',
      playerName: 'PLAYER',
    });

    expect(readLocalGameConfig()).toEqual({
      mode: 'cpu',
      difficulty: 'hard',
      soundEnabled: true,
      cpuCharacter: 'vinnie',
      playerName: 'PLAYER',
    });
  });

  it('ignores invalid stored route state instead of crashing game load', () => {
    expect(normalizeLocalGameConfig({ mode: 'bot', difficulty: 'wild' })).toBeNull();
    expect(normalizeLocalGameConfig({ mode: 'cpu', difficulty: 'wild', cpuCharacter: 'unknown' })).toEqual({
      mode: 'cpu',
      difficulty: 'medium',
      cpuCharacter: 'ivan',
    });
  });
});
