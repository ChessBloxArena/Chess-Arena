import { beforeEach, describe, expect, it } from 'vitest';
import { readAudioPreferences, saveAudioPreferences } from './audioPreferences';

describe('audio preferences', () => {
  const store: Storage = (() => {
    let values: Record<string, string> = {};

    return {
      get length() {
        return Object.keys(values).length;
      },
      clear: () => {
        values = {};
      },
      getItem: (key: string) => values[key] ?? null,
      key: (index: number) => Object.keys(values)[index] ?? null,
      removeItem: (key: string) => {
        delete values[key];
      },
      setItem: (key: string, value: string) => {
        values[key] = value;
      },
    };
  })();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: store,
    });
    localStorage.clear();
  });

  it('defaults music and sfx on', () => {
    expect(readAudioPreferences()).toEqual({
      musicOn: true,
      sfxOn: true,
    });
  });

  it('persists partial preference updates', () => {
    saveAudioPreferences({ musicOn: false });

    expect(readAudioPreferences()).toEqual({
      musicOn: false,
      sfxOn: true,
    });

    saveAudioPreferences({ sfxOn: false });

    expect(readAudioPreferences()).toEqual({
      musicOn: false,
      sfxOn: false,
    });
  });
});
