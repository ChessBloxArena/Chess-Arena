export type LocalGameMode = 'pvp' | 'cpu';
export type LocalGameDifficulty = 'easy' | 'medium' | 'hard';
export type LocalGameCpuCharacter = 'ivan' | 'vinnie';

export interface LocalGameConfig {
  mode: LocalGameMode;
  difficulty: LocalGameDifficulty;
  soundEnabled?: boolean;
  cpuCharacter?: LocalGameCpuCharacter;
  playerName?: string;
}

const LOCAL_GAME_CONFIG_KEY = 'chess_local_game_config_v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function normalizeMode(value: unknown): LocalGameMode | null {
  return value === 'pvp' || value === 'cpu' ? value : null;
}

function normalizeDifficulty(value: unknown): LocalGameDifficulty {
  return value === 'easy' || value === 'medium' || value === 'hard' ? value : 'medium';
}

function normalizeCpuCharacter(value: unknown): LocalGameCpuCharacter {
  return value === 'vinnie' ? 'vinnie' : 'ivan';
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function normalizeLocalGameConfig(value: unknown): LocalGameConfig | null {
  if (!isRecord(value)) return null;
  const mode = normalizeMode(value.mode);
  if (!mode) return null;

  const config: LocalGameConfig = {
    mode,
    difficulty: normalizeDifficulty(value.difficulty),
  };

  if (typeof value.soundEnabled === 'boolean') config.soundEnabled = value.soundEnabled;
  if (mode === 'cpu') config.cpuCharacter = normalizeCpuCharacter(value.cpuCharacter);
  if (typeof value.playerName === 'string') config.playerName = value.playerName;

  return config;
}

export function readLocalGameConfig(): LocalGameConfig | null {
  const store = sessionStore();
  if (!store) return null;

  try {
    const raw = store.getItem(LOCAL_GAME_CONFIG_KEY);
    return raw ? normalizeLocalGameConfig(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLocalGameConfig(config: LocalGameConfig): void {
  const store = sessionStore();
  if (!store) return;

  const normalized = normalizeLocalGameConfig(config);
  if (!normalized) return;

  try {
    store.setItem(LOCAL_GAME_CONFIG_KEY, JSON.stringify(normalized));
  } catch {
    // Losing refresh recovery is better than blocking match start.
  }
}
