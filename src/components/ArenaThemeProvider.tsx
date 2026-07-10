import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ARENA_THEME_BY_ID,
  ARENA_THEME_FLAG_STORAGE_KEY,
  ARENA_THEME_STORAGE_KEY,
  DEFAULT_ARENA_THEME_ID,
  areArenaThemesEnabled,
  normalizeArenaThemeId,
  readStoredArenaThemeId,
  saveStoredArenaThemeId,
  type ArenaThemeId,
} from '@/lib/arenaThemes';
import { ArenaThemeContext, type ArenaThemeContextValue } from '@/lib/arenaThemeContext';

export function ArenaThemeProvider({ children }: { children: ReactNode }) {
  const [themesEnabled, setThemesEnabled] = useState(() => areArenaThemesEnabled());
  const [themeId, setThemeIdState] = useState<ArenaThemeId>(() => readStoredArenaThemeId());

  const setThemeId = useCallback((nextThemeId: ArenaThemeId) => {
    if (!areArenaThemesEnabled()) {
      setThemeIdState(DEFAULT_ARENA_THEME_ID);
      return;
    }

    setThemeIdState(normalizeArenaThemeId(nextThemeId));
  }, []);

  useEffect(() => {
    const activeThemeId = themesEnabled ? themeId : DEFAULT_ARENA_THEME_ID;
    document.documentElement.dataset.arenaTheme = activeThemeId;
    document.documentElement.style.colorScheme = 'dark';
    saveStoredArenaThemeId(activeThemeId);
  }, [themeId, themesEnabled]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === ARENA_THEME_FLAG_STORAGE_KEY) {
        const enabled = areArenaThemesEnabled();
        setThemesEnabled(enabled);
        if (!enabled) setThemeIdState(DEFAULT_ARENA_THEME_ID);
      }

      if (event.key === ARENA_THEME_STORAGE_KEY) {
        setThemeIdState(themesEnabled ? normalizeArenaThemeId(event.newValue) : DEFAULT_ARENA_THEME_ID);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [themesEnabled]);

  useEffect(() => {
    if (!themesEnabled && themeId !== DEFAULT_ARENA_THEME_ID) {
      setThemeIdState(DEFAULT_ARENA_THEME_ID);
    }
  }, [themeId, themesEnabled]);

  const value = useMemo<ArenaThemeContextValue>(() => ({
    themeId: themesEnabled ? themeId : DEFAULT_ARENA_THEME_ID,
    theme: ARENA_THEME_BY_ID[themesEnabled ? themeId : DEFAULT_ARENA_THEME_ID],
    themesEnabled,
    setThemeId,
  }), [setThemeId, themeId, themesEnabled]);

  return (
    <ArenaThemeContext.Provider value={value}>
      {children}
    </ArenaThemeContext.Provider>
  );
}
