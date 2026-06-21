import { describe, expect, it } from 'vitest';
import { cpuDifficultyPoints, cpuRewardAmountRaw, formatCpuChessReward, rankCpuLeaderboardEntries } from './cpuLeaderboard';

describe('cpu leaderboard client helpers', () => {
  it('uses the configured difficulty score weights', () => {
    expect(cpuDifficultyPoints('easy')).toBe(5_000);
    expect(cpuDifficultyPoints('medium')).toBe(10_000);
    expect(cpuDifficultyPoints('hard')).toBe(15_000);
    expect(cpuRewardAmountRaw('easy')).toBe(5_000_000_000n);
    expect(formatCpuChessReward(cpuDifficultyPoints('hard'))).toBe('15,000');
  });

  it('sorts points before wins and applies deterministic tie breaks', () => {
    const ranked = rankCpuLeaderboardEntries([
      { playerName: 'EASYGRIND', score: 20_000, wins: 4, hardWins: 0, lastWinAt: '2026-06-19T12:00:00.000Z' },
      { playerName: 'HARDWIN', score: 25_000, wins: 2, hardWins: 1, lastWinAt: '2026-06-19T11:00:00.000Z' },
      { playerName: 'ALPHA', score: 25_000, wins: 2, hardWins: 1, lastWinAt: '2026-06-19T11:00:00.000Z' },
    ]);

    expect(ranked.map((entry) => `${entry.rank}:${entry.playerName}`)).toEqual([
      '1:ALPHA',
      '2:HARDWIN',
      '3:EASYGRIND',
    ]);
  });
});
