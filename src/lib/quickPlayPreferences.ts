import { chessFormatById, type ChessFormatId } from './chessFormats';
import type { Difficulty, GameMode } from '@/hooks/useChessGame';
import type { CpuCharacter } from './characterTaunts';

const KEY = 'chessblox_quick_play_v1';
export interface QuickPlayPreferences {
  mode: GameMode; entry: 'practice' | 'wager'; format: ChessFormatId;
  stake: string; difficulty: Difficulty; character: CpuCharacter;
}
export function readQuickPlayPreferences(): QuickPlayPreferences {
  let saved: Partial<QuickPlayPreferences> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* Storage is optional. */ }
  return {
    mode: saved.mode === 'cpu' ? 'cpu' : 'pvp',
    entry: saved.entry === 'practice' ? 'practice' : 'wager',
    format: chessFormatById(saved.format).id,
    stake: typeof saved.stake === 'string' && /^[1-9]\d*$/.test(saved.stake) ? saved.stake : '',
    difficulty: saved.difficulty === 'easy' || saved.difficulty === 'hard' ? saved.difficulty : 'medium',
    character: saved.character === 'vinnie' ? 'vinnie' : 'ivan',
  };
}
export function saveQuickPlayPreferences(value: QuickPlayPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Continue with this session's settings. */ }
}
