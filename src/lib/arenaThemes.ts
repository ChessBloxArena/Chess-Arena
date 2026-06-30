export type ArenaThemeId = 'arcade' | 'tournament' | 'royal' | 'inferno';

export interface ArenaSceneTheme {
  lightSquare: string;
  darkSquare: string;
  line: string;
  whitePiece: string;
  blackPiece: string;
  whitePieceEdge: string;
  blackPieceEdge: string;
  whiteAccent: string;
  blackAccent: string;
  selected: string;
  legal: string;
  highlight: string;
  hover: string;
  invalid: string;
  arenaStone: string;
  fog: string;
  lightWarm: string;
  lightCool: string;
}

export interface ArenaThemeDefinition {
  id: ArenaThemeId;
  label: string;
  shortLabel: string;
  swatches: readonly string[];
  scene: ArenaSceneTheme;
}

export const ARENA_THEME_STORAGE_KEY = 'chess_arena_theme_v1';
export const ARENA_THEME_FLAG_STORAGE_KEY = 'chess_arena_themes_enabled_v1';
export const DEFAULT_ARENA_THEME_ID: ArenaThemeId = 'arcade';

export const ARENA_THEMES: readonly ArenaThemeDefinition[] = [
  {
    id: 'arcade',
    label: 'Arcade',
    shortLabel: 'ARCADE',
    swatches: ['#3ea762', '#f0c542', '#f7f2e6'],
    scene: {
      lightSquare: '#f2e6cc',
      darkSquare: '#759480',
      line: '#080808',
      whitePiece: '#fff1d7',
      blackPiece: '#283342',
      whitePieceEdge: '#050505',
      blackPieceEdge: '#fff7e7',
      whiteAccent: '#b89b60',
      blackAccent: '#78909b',
      selected: '#d6b568',
      legal: '#348460',
      highlight: '#b3c4a1',
      hover: '#bdcbaa',
      invalid: '#cd7567',
      arenaStone: '#f7f2e6',
      fog: '#cdd5df',
      lightWarm: '#fff8e8',
      lightCool: '#dfe8ff',
    },
  },
  {
    id: 'tournament',
    label: 'Tournament',
    shortLabel: 'TOURNEY',
    swatches: ['#3f8f68', '#c8a84a', '#d8caa3'],
    scene: {
      lightSquare: '#d8caa3',
      darkSquare: '#60724f',
      line: '#111713',
      whitePiece: '#fff8df',
      blackPiece: '#24352e',
      whitePieceEdge: '#111713',
      blackPieceEdge: '#f4e8c8',
      whiteAccent: '#111713',
      blackAccent: '#f4e8c8',
      selected: '#f4c84a',
      legal: '#42d37a',
      highlight: '#55bcd8',
      hover: '#dfc870',
      invalid: '#ff4f5f',
      arenaStone: '#eee4c6',
      fog: '#bdcbbb',
      lightWarm: '#fff0c0',
      lightCool: '#d8ecff',
    },
  },
  {
    id: 'royal',
    label: 'Royal',
    shortLabel: 'ROYAL',
    swatches: ['#6e4aa0', '#ffd35d', '#62d5e7'],
    scene: {
      lightSquare: '#eadff2',
      darkSquare: '#5a3d78',
      line: '#120b20',
      whitePiece: '#fff5f0',
      blackPiece: '#24162f',
      whitePieceEdge: '#120b20',
      blackPieceEdge: '#f4e9ff',
      whiteAccent: '#120b20',
      blackAccent: '#f4e9ff',
      selected: '#ffd35d',
      legal: '#37e0a2',
      highlight: '#6de3ff',
      hover: '#b592e7',
      invalid: '#ff4f87',
      arenaStone: '#eee7f2',
      fog: '#d7c9e4',
      lightWarm: '#fff1d4',
      lightCool: '#dcd7ff',
    },
  },
  {
    id: 'inferno',
    label: 'Inferno',
    shortLabel: 'INFERNO',
    swatches: ['#c44c3d', '#ffd15a', '#343033'],
    scene: {
      lightSquare: '#f1d0a6',
      darkSquare: '#64302c',
      line: '#160b09',
      whitePiece: '#fff0d8',
      blackPiece: '#312427',
      whitePieceEdge: '#160b09',
      blackPieceEdge: '#ffe7c4',
      whiteAccent: '#160b09',
      blackAccent: '#ffe7c4',
      selected: '#ffd15a',
      legal: '#68d26d',
      highlight: '#ff895e',
      hover: '#d98255',
      invalid: '#ff3355',
      arenaStone: '#ecd6bc',
      fog: '#d4b8aa',
      lightWarm: '#ffd4a5',
      lightCool: '#ffe2d9',
    },
  },
] as const;

export const ARENA_THEME_BY_ID = ARENA_THEMES.reduce<Record<ArenaThemeId, ArenaThemeDefinition>>(
  (themes, theme) => {
    themes[theme.id] = theme;
    return themes;
  },
  {} as Record<ArenaThemeId, ArenaThemeDefinition>,
);

export function normalizeArenaThemeId(value: unknown): ArenaThemeId {
  return typeof value === 'string' && value in ARENA_THEME_BY_ID
    ? (value as ArenaThemeId)
    : DEFAULT_ARENA_THEME_ID;
}

export function areArenaThemesEnabled(): boolean {
  if (import.meta.env.VITE_ENABLE_ARENA_THEMES === 'false') return false;
  if (import.meta.env.VITE_ENABLE_ARENA_THEMES === 'true') return true;
  if (typeof window === 'undefined') return true;

  try {
    const flag = window.localStorage.getItem(ARENA_THEME_FLAG_STORAGE_KEY);
    return flag !== 'false' && flag !== '0' && flag !== 'disabled';
  } catch {
    return true;
  }
}

export function readStoredArenaThemeId(): ArenaThemeId {
  if (!areArenaThemesEnabled()) return DEFAULT_ARENA_THEME_ID;
  if (typeof window === 'undefined') return DEFAULT_ARENA_THEME_ID;

  try {
    return normalizeArenaThemeId(window.localStorage.getItem(ARENA_THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_ARENA_THEME_ID;
  }
}

export function saveStoredArenaThemeId(themeId: ArenaThemeId): void {
  if (!areArenaThemesEnabled()) return;
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(ARENA_THEME_STORAGE_KEY, themeId);
  } catch {
    // Blocked storage should not prevent theme changes for the current session.
  }
}
