export interface WagerLeaderboardGame {
  id: string;
  status: string | null;
  winner: string | null;
  moves?: string[] | null;
  payment_status?: string | null;
  settlement_status?: string | null;
  referee_result_hash?: string | null;
  refund_status?: string | null;
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
  accepted_move_count?: number | string | null;
  suspicious_flags?: string[] | null;
  suspicious_reviews?: WagerSuspiciousReview[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  finished_at?: string | null;
  settlement_settled_at?: string | null;
}

export interface WagerSuspiciousReview {
  status: "open" | "excluded" | "cleared" | "needs_more_data" | string;
  reviewer?: string | null;
  decision?: string | null;
  reason?: string | null;
  created_at?: string | null;
  reviewed_at?: string | null;
}

export interface PrizeSeasonWindow {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface WagerLeaderboardEntry {
  walletAddress: string;
  wins: number;
  rank: number;
  lastWinAt: string;
  gameIds: string[];
}

export interface WagerPrizeAllocation extends WagerLeaderboardEntry {
  amountRaw: bigint;
}

export const DEFAULT_TOP_TEN_PRIZE_BPS = [2500, 1800, 1400, 1100, 900, 700, 600, 400, 400, 200] as const;
export const DEFAULT_MIN_PRIZE_PLIES = 12;
export const DEFAULT_MIN_PRIZE_DURATION_SECONDS = 90;
export const DEFAULT_SAME_OPPONENT_WIN_CAP = 3;

export interface PrizeEligibilityOptions {
  minCompletedPlies?: number;
  minDurationSeconds?: number;
  sameOpponentWinCap?: number;
}

function resolvePrizeEligibilityOptions(options: PrizeEligibilityOptions): Required<PrizeEligibilityOptions> {
  return {
    minCompletedPlies: options.minCompletedPlies ?? DEFAULT_MIN_PRIZE_PLIES,
    minDurationSeconds: options.minDurationSeconds ?? DEFAULT_MIN_PRIZE_DURATION_SECONDS,
    sameOpponentWinCap: options.sameOpponentWinCap ?? DEFAULT_SAME_OPPONENT_WIN_CAP,
  };
}

function finishedAt(row: WagerLeaderboardGame): string | null {
  return row.finished_at ?? row.settlement_settled_at ?? row.updated_at ?? null;
}

export function prizeEligibilityTimestamp(row: WagerLeaderboardGame): string | null {
  return finishedAt(row);
}

function isWithinSeason(row: WagerLeaderboardGame, season: PrizeSeasonWindow): boolean {
  const finished = finishedAt(row);
  if (!finished) return false;
  return finished >= season.startsAt && finished < season.endsAt;
}

function winnerWallet(row: WagerLeaderboardGame): string | null {
  if (row.winner === "w") return row.white_wallet_address ?? null;
  if (row.winner === "b") return row.black_wallet_address ?? null;
  return null;
}

function opponentWallet(row: WagerLeaderboardGame): string | null {
  if (row.winner === "w") return row.black_wallet_address ?? null;
  if (row.winner === "b") return row.white_wallet_address ?? null;
  return null;
}

function completedPlies(row: WagerLeaderboardGame): number {
  if (typeof row.accepted_move_count === "number" && Number.isFinite(row.accepted_move_count)) {
    return row.accepted_move_count;
  }
  if (typeof row.accepted_move_count === "string" && row.accepted_move_count.trim()) {
    const parsed = Number(row.accepted_move_count);
    if (Number.isFinite(parsed)) return parsed;
  }
  return row.moves?.length ?? 0;
}

function gameDurationSeconds(row: WagerLeaderboardGame): number | null {
  const started = row.created_at ? Date.parse(row.created_at) : Number.NaN;
  const finished = finishedAt(row) ? Date.parse(finishedAt(row)!) : Number.NaN;
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return (finished - started) / 1000;
}

function reviewTimestamp(review: WagerSuspiciousReview): string {
  return review.reviewed_at ?? review.created_at ?? "";
}

export function latestSuspiciousReview(row: WagerLeaderboardGame): WagerSuspiciousReview | null {
  const reviews = row.suspicious_reviews?.filter(Boolean) ?? [];
  if (!reviews.length) return null;
  return [...reviews].sort((a, b) => reviewTimestamp(b).localeCompare(reviewTimestamp(a)))[0] ?? null;
}

function hasAuditValue(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isAuditedClearedReview(review: WagerSuspiciousReview | null): boolean {
  return review?.status === "cleared"
    && hasAuditValue(review.reviewer)
    && hasAuditValue(review.decision)
    && hasAuditValue(review.reason)
    && hasAuditValue(review.reviewed_at);
}

export function hasUnresolvedSuspiciousReview(row: WagerLeaderboardGame): boolean {
  const latestReview = latestSuspiciousReview(row);
  if (latestReview?.status === "excluded") return true;
  if (latestReview?.status === "open" || latestReview?.status === "needs_more_data") return true;
  if (row.suspicious_flags?.length && !isAuditedClearedReview(latestReview)) return true;
  return false;
}

function isManuallyCleared(row: WagerLeaderboardGame): boolean {
  return isAuditedClearedReview(latestSuspiciousReview(row));
}

export function isVerifiedPrizeWin(
  row: WagerLeaderboardGame,
  season: PrizeSeasonWindow,
  options: PrizeEligibilityOptions = {},
): boolean {
  const resolvedOptions = resolvePrizeEligibilityOptions(options);
  if (row.status !== "finished") return false;
  if (row.payment_status !== "settled") return false;
  if (row.settlement_status !== "settled") return false;
  if (row.refund_status === "refunded") return false;
  if (!row.referee_result_hash) return false;
  if (!winnerWallet(row)) return false;
  if (hasUnresolvedSuspiciousReview(row)) return false;
  if (completedPlies(row) < resolvedOptions.minCompletedPlies) return false;
  const durationSeconds = gameDurationSeconds(row);
  if (durationSeconds === null || durationSeconds < resolvedOptions.minDurationSeconds) return false;
  return isWithinSeason(row, season);
}

export function rankTopWagerWinners(
  rows: WagerLeaderboardGame[],
  season: PrizeSeasonWindow,
  limit = 10,
  options: PrizeEligibilityOptions = {},
): WagerLeaderboardEntry[] {
  const resolvedOptions = resolvePrizeEligibilityOptions(options);
  const verifiedRows = rows.filter((row) => isVerifiedPrizeWin(row, season, resolvedOptions));
  const winnerOpponentCounts = new Map<string, number>();

  for (const row of verifiedRows) {
    const winner = winnerWallet(row);
    const opponent = opponentWallet(row);
    if (!winner || !opponent) continue;
    const key = `${winner}\0${opponent}`;
    winnerOpponentCounts.set(key, (winnerOpponentCounts.get(key) ?? 0) + 1);
  }

  const grouped = new Map<string, { wins: number; lastWinAt: string; gameIds: string[] }>();

  for (const row of verifiedRows) {
    const walletAddress = winnerWallet(row)!;
    const opponent = opponentWallet(row);
    if (opponent) {
      const opponentKey = `${walletAddress}\0${opponent}`;
      const opponentWins = winnerOpponentCounts.get(opponentKey) ?? 0;
      if (opponentWins > resolvedOptions.sameOpponentWinCap && !isManuallyCleared(row)) continue;
    }
    const timestamp = finishedAt(row)!;
    const current = grouped.get(walletAddress) ?? { wins: 0, lastWinAt: timestamp, gameIds: [] };
    current.wins += 1;
    current.lastWinAt = timestamp > current.lastWinAt ? timestamp : current.lastWinAt;
    current.gameIds.push(row.id);
    grouped.set(walletAddress, current);
  }

  return [...grouped.entries()]
    .map(([walletAddress, entry]) => ({ walletAddress, ...entry, rank: 0 }))
    .sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.lastWinAt !== b.lastWinAt) return a.lastWinAt.localeCompare(b.lastWinAt);
      return a.walletAddress.localeCompare(b.walletAddress);
    })
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function allocatePrizePool(
  leaderboard: WagerLeaderboardEntry[],
  totalPrizeRaw: bigint,
  distributionBps: readonly number[] = DEFAULT_TOP_TEN_PRIZE_BPS,
): WagerPrizeAllocation[] {
  if (totalPrizeRaw < 0n) throw new Error("Prize pool cannot be negative.");
  const totalBps = distributionBps.reduce((sum, bps) => sum + bps, 0);
  if (totalBps !== 10_000) throw new Error("Prize distribution must total 10000 bps.");

  let allocated = 0n;
  return leaderboard.map((entry, index) => {
    const bps = BigInt(distributionBps[index] ?? 0);
    const amountRaw = index === leaderboard.length - 1
      ? totalPrizeRaw - allocated
      : (totalPrizeRaw * bps) / 10_000n;
    allocated += amountRaw;
    return { ...entry, amountRaw };
  });
}

export function createBiweeklyPrizeSeason(date: Date, anchor = new Date("2026-01-05T00:00:00.000Z")): PrizeSeasonWindow {
  const seasonMs = 14 * 24 * 60 * 60 * 1000;
  const elapsed = Math.max(0, date.getTime() - anchor.getTime());
  const seasonIndex = Math.floor(elapsed / seasonMs);
  const startsAtMs = anchor.getTime() + seasonIndex * seasonMs;
  const endsAtMs = startsAtMs + seasonMs;
  return {
    id: `season-${seasonIndex + 1}`,
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(endsAtMs).toISOString(),
  };
}
