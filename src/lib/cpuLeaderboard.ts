import { supabase } from '@/integrations/supabase/client';
import { clearStoredPvpSession, ensurePvpSession, isInvalidPvpSessionError } from '@/lib/pvpSession';
import { isSupabaseConfigured } from '@/lib/supabaseConfig';

export type CpuDifficulty = 'easy' | 'medium' | 'hard';

export interface SubmitCpuResultRequest {
  action: 'submit_cpu_result';
  requestId: string;
  playerName: string;
  difficulty: CpuDifficulty;
  cpuCharacter?: 'ivan' | 'vinnie';
  walletAddress?: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
  moves: string[];
}

export interface CpuLeaderboardEntry {
  rank: number;
  playerName: string;
  score: number;
  wins: number;
  easyWins: number;
  mediumWins: number;
  hardWins: number;
  lastWinAt: string;
}

export interface SubmitCpuResultResponse {
  ok: boolean;
  accepted?: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  points?: number;
  payoutQueued?: boolean;
}

interface CpuLeaderboardResponse {
  ok?: boolean;
  entries?: CpuLeaderboardEntry[];
}

interface CpuLeaderboardRankInput {
  playerName: string;
  score: number;
  wins: number;
  hardWins: number;
  lastWinAt: string;
}

const PVP_REFEREE_FUNCTION = 'pvp-referee';

export const CPU_DIFFICULTY_POINTS: Record<CpuDifficulty, number> = {
  easy: 5_000,
  medium: 10_000,
  hard: 15_000,
};

export const CPU_REWARD_TOKEN_MINT = 'Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump';
export const CPU_REWARD_TOKEN_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const CPU_REWARD_TOKEN_DECIMALS = 6;

export function cpuDifficultyPoints(difficulty: CpuDifficulty): number {
  return CPU_DIFFICULTY_POINTS[difficulty];
}

export function cpuRewardAmountRaw(difficulty: CpuDifficulty): bigint {
  return BigInt(cpuDifficultyPoints(difficulty)) * (10n ** BigInt(CPU_REWARD_TOKEN_DECIMALS));
}

export function formatCpuChessReward(points: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(points);
}

export function rankCpuLeaderboardEntries<T extends CpuLeaderboardRankInput>(entries: T[]): Array<T & { rank: number }> {
  return [...entries]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.hardWins !== a.hardWins) return b.hardWins - a.hardWins;
      if (b.lastWinAt !== a.lastWinAt) return b.lastWinAt.localeCompare(a.lastWinAt);
      return a.playerName.localeCompare(b.playerName);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function invokeCpuLeaderboard<T>(body: Record<string, unknown>, retryInvalidSession = true): Promise<T> {
  const session = await ensurePvpSession();
  const { data, error } = await supabase.functions.invoke(PVP_REFEREE_FUNCTION, {
    body: {
      ...body,
      sessionId: session.sessionId,
      sessionProof: session.sessionProof,
    },
  });

  if (error) {
    let message = error.message || 'CPU leaderboard request failed';
    let code: string | undefined;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const responseBody = await context.clone().json();
        if (responseBody?.error) message = responseBody.error;
        if (responseBody?.code) code = String(responseBody.code);
      } catch {
        // Keep the SDK error when the function did not return JSON.
      }
    }
    if (retryInvalidSession && isInvalidPvpSessionError(code, message)) {
      clearStoredPvpSession();
      return invokeCpuLeaderboard<T>(body, false);
    }
    throw new Error(message);
  }

  if (data && typeof data === 'object' && 'error' in data) {
    const response = data as { error: unknown; code?: unknown };
    const message = String(response.error);
    const code = response.code ? String(response.code) : undefined;
    if (retryInvalidSession && isInvalidPvpSessionError(code, message)) {
      clearStoredPvpSession();
      return invokeCpuLeaderboard<T>(body, false);
    }
    throw new Error(message);
  }

  return data as T;
}

export async function submitCpuResult(
  request: Omit<SubmitCpuResultRequest, 'action'>,
): Promise<SubmitCpuResultResponse> {
  if (!isSupabaseConfigured) {
    return { ok: false, skipped: true };
  }

  return invokeCpuLeaderboard<SubmitCpuResultResponse>({
    action: 'submit_cpu_result',
    ...request,
  });
}

export async function listCpuLeaderboard(limit = 25): Promise<CpuLeaderboardEntry[]> {
  const response = await invokeCpuLeaderboard<CpuLeaderboardResponse>({
    action: 'list_cpu_leaderboard',
    limit,
  });

  return rankCpuLeaderboardEntries((response.entries ?? []).map((entry) => ({
    rank: Number(entry.rank ?? 0),
    playerName: String(entry.playerName ?? ''),
    score: Number(entry.score ?? 0),
    wins: Number(entry.wins ?? 0),
    easyWins: Number(entry.easyWins ?? 0),
    mediumWins: Number(entry.mediumWins ?? 0),
    hardWins: Number(entry.hardWins ?? 0),
    lastWinAt: String(entry.lastWinAt ?? ''),
  })));
}
