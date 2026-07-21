import { useContext } from 'react';
import { ArenaThemeContext } from '@/lib/arenaThemeContext';

export function useArenaTheme() {
  return useContext(ArenaThemeContext);
}
