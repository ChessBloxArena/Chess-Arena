import { createContext } from 'react';
import {
  ARENA_THEME_BY_ID,
  DEFAULT_ARENA_THEME_ID,
  type ArenaThemeDefinition,
  type ArenaThemeId,
} from '@/lib/arenaThemes';

export interface ArenaThemeContextValue {
  themeId: ArenaThemeId;
  theme: ArenaThemeDefinition;
  themesEnabled: boolean;
  setThemeId: (themeId: ArenaThemeId) => void;
}

export const ArenaThemeContext = createContext<ArenaThemeContextValue>({
  themeId: DEFAULT_ARENA_THEME_ID,
  theme: ARENA_THEME_BY_ID[DEFAULT_ARENA_THEME_ID],
  themesEnabled: false,
  setThemeId: () => {},
});
