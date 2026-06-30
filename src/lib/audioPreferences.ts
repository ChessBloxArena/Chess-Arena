export interface AudioPreferences {
  musicOn: boolean;
  sfxOn: boolean;
}

const AUDIO_PREFERENCES_KEY = 'chess_audio_preferences_v1';
const DEFAULT_AUDIO_PREFERENCES: AudioPreferences = {
  musicOn: true,
  sfxOn: true,
};

function readStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function booleanFrom(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readAudioPreferences(): AudioPreferences {
  const storage = readStorage();
  if (!storage) return { ...DEFAULT_AUDIO_PREFERENCES };

  try {
    const raw = storage.getItem(AUDIO_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_AUDIO_PREFERENCES };

    const parsed = JSON.parse(raw) as Partial<AudioPreferences>;
    return {
      musicOn: booleanFrom(parsed.musicOn, DEFAULT_AUDIO_PREFERENCES.musicOn),
      sfxOn: booleanFrom(parsed.sfxOn, DEFAULT_AUDIO_PREFERENCES.sfxOn),
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFERENCES };
  }
}

export function saveAudioPreferences(nextPreferences: Partial<AudioPreferences>): AudioPreferences {
  const preferences = {
    ...readAudioPreferences(),
    ...nextPreferences,
  };
  const storage = readStorage();

  try {
    storage?.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preference writes are non-critical; keep gameplay uninterrupted.
  }

  return preferences;
}
