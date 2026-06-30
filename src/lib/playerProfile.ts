const PLAYER_NAME_KEY = 'chess_player_name_v1';
const DEFAULT_PLAYER_NAME = 'PLAYER 1';
const MAX_PLAYER_NAME_LENGTH = 14;

export function normalizePlayerNameInput(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_PLAYER_NAME_LENGTH);
}

export function getPlayerDisplayName(value: string | null | undefined): string {
  const normalized = normalizePlayerNameInput(value ?? '').trim();
  return normalized || DEFAULT_PLAYER_NAME;
}

export function readStoredPlayerName(): string {
  try {
    return normalizePlayerNameInput(localStorage.getItem(PLAYER_NAME_KEY) ?? DEFAULT_PLAYER_NAME);
  } catch {
    return DEFAULT_PLAYER_NAME;
  }
}

export function saveStoredPlayerName(value: string): void {
  try {
    localStorage.setItem(PLAYER_NAME_KEY, normalizePlayerNameInput(value));
  } catch {
    // Private browsing or blocked storage should not stop a match from starting.
  }
}
