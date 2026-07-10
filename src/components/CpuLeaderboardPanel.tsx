import { RefreshCw, Trophy } from 'lucide-react';
import { formatCpuChessReward, type CpuLeaderboardEntry } from '@/lib/cpuLeaderboard';

interface CpuLeaderboardPanelProps {
  available: boolean;
  entries: CpuLeaderboardEntry[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function formatLastWin(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'UNKNOWN';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp)).toUpperCase();
}

export default function CpuLeaderboardPanel({
  available,
  entries,
  loading,
  error,
  onRefresh,
}: CpuLeaderboardPanelProps) {
  return (
    <div className="retro-panel cpu-leaderboard-panel p-4">
      <div className="cpu-leaderboard-header">
        <div>
          <p className="cpu-leaderboard-kicker">PRACTICE SCORES</p>
          <h2>
            <Trophy aria-hidden="true" />
            <span>LEADERBOARD</span>
          </h2>
        </div>
        <button
          className="retro-btn retro-btn-small cpu-leaderboard-refresh"
          onClick={onRefresh}
          disabled={!available || loading}
        >
          <RefreshCw aria-hidden="true" className={loading ? 'cpu-leaderboard-spin' : ''} />
          <span>{loading ? 'SYNC' : 'REFRESH'}</span>
        </button>
      </div>

      <p className="mt-2 mb-3 text-xs text-muted-foreground">Unverified scores from local CPU games. Practice points have no cash value.</p>
      {!available ? (
        <div className="cpu-leaderboard-empty" role="status">
          GLOBAL LEADERBOARD OFFLINE
        </div>
      ) : error ? (
        <div className="cpu-leaderboard-empty is-error" role="alert">
          {error}
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="cpu-leaderboard-empty" role="status">
          LOADING RANKS...
        </div>
      ) : entries.length === 0 ? (
        <div className="cpu-leaderboard-empty" role="status">
          NO CPU WINS RECORDED
        </div>
      ) : (
        <div className="cpu-leaderboard-list" aria-label="CPU leaderboard standings">
          {entries.map((entry) => (
            <div className="cpu-leaderboard-row" key={`${entry.rank}-${entry.playerName}`}>
              <div className="cpu-leaderboard-rank">#{entry.rank}</div>
              <div className="cpu-leaderboard-player">
                <p>{entry.playerName}</p>
                <span>
                  WINS {entry.wins} • E {entry.easyWins} / M {entry.mediumWins} / H {entry.hardWins}
                </span>
              </div>
              <div className="cpu-leaderboard-score">
                <p>{formatCpuChessReward(entry.score)}</p>
                <span>POINTS • {formatLastWin(entry.lastWinAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
