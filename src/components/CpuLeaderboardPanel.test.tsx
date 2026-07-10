import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CpuLeaderboardPanel from './CpuLeaderboardPanel';

const entry = {
  rank: 1,
  playerName: 'ADA',
  score: 25_000,
  wins: 2,
  easyWins: 0,
  mediumWins: 1,
  hardWins: 1,
  lastWinAt: '2026-06-19T12:00:00.000Z',
};

describe('CpuLeaderboardPanel', () => {
  it('shows an unavailable state when Supabase is not configured', () => {
    render(
      <CpuLeaderboardPanel
        available={false}
        entries={[]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('GLOBAL LEADERBOARD OFFLINE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /REFRESH/i })).toBeDisabled();
  });

  it('shows loading and empty states', () => {
    const { rerender } = render(
      <CpuLeaderboardPanel
        available
        entries={[]}
        loading
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('LOADING RANKS...')).toBeInTheDocument();

    rerender(
      <CpuLeaderboardPanel
        available
        entries={[]}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('NO CPU WINS RECORDED')).toBeInTheDocument();
  });

  it('shows errors and populated leaderboard rows', () => {
    const { rerender } = render(
      <CpuLeaderboardPanel
        available
        entries={[]}
        loading={false}
        error="LEADERBOARD SYNC FAILED"
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('LEADERBOARD SYNC FAILED');

    const onRefresh = vi.fn();
    rerender(
      <CpuLeaderboardPanel
        available
        entries={[entry]}
        loading={false}
        error={null}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('ADA')).toBeInTheDocument();
    expect(screen.getByText('25,000')).toBeInTheDocument();
    expect(screen.getByText(/POINTS •/)).toBeInTheDocument();
    expect(screen.getByText(/Practice points have no cash value/)).toBeInTheDocument();
    expect(screen.getByText('WINS 2 • E 0 / M 1 / H 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /REFRESH/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
