import { replayStoredMoves } from "./integrityRules.ts";

export type CpuDifficulty = "easy" | "medium" | "hard";
export type CpuCharacter = "ivan" | "vinnie";

export interface CpuLeaderboardRankInput {
  playerName: string;
  score: number;
  wins: number;
  hardWins: number;
  lastWinAt: string;
}

export interface ValidatedCpuResult {
  playerName: string;
  difficulty: CpuDifficulty;
  cpuCharacter: CpuCharacter | null;
  points: number;
  payoutAmountRaw: bigint;
  moves: string[];
  plyCount: number;
}

export class CpuLeaderboardValidationError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const CPU_DIFFICULTY_POINTS: Record<CpuDifficulty, number> = {
  easy: 5_000,
  medium: 10_000,
  hard: 15_000,
};

export const CPU_REWARD_TOKEN_MINT = "Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump";
export const CPU_REWARD_TOKEN_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const CPU_REWARD_TOKEN_DECIMALS = 6;

const MAX_PLAYER_NAME_LENGTH = 14;
const MAX_CPU_RESULT_PLIES = 300;
const DEFAULT_PLAYER_NAME = "PLAYER 1";

function fail(status: number, message: string): never {
  throw new CpuLeaderboardValidationError(status, message);
}

export function normalizeCpuPlayerName(value: unknown): string {
  const normalized = typeof value === "string"
    ? value
      .toUpperCase()
      .replace(/[^A-Z0-9 _-]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, MAX_PLAYER_NAME_LENGTH)
      .trim()
    : "";
  return normalized || DEFAULT_PLAYER_NAME;
}

export function isCpuDifficulty(value: unknown): value is CpuDifficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

export function cpuDifficultyPoints(value: CpuDifficulty): number {
  return CPU_DIFFICULTY_POINTS[value];
}

export function cpuRewardAmountRaw(value: CpuDifficulty): bigint {
  return BigInt(cpuDifficultyPoints(value)) * (10n ** BigInt(CPU_REWARD_TOKEN_DECIMALS));
}

export function normalizeCpuCharacter(value: unknown): CpuCharacter | null {
  if (value == null || value === "") return null;
  if (value === "ivan" || value === "vinnie") return value;
  fail(400, "Invalid CPU character");
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

export function validateCpuMatchResult(input: {
  playerName: unknown;
  difficulty: unknown;
  cpuCharacter?: unknown;
  moves: unknown;
}): ValidatedCpuResult {
  if (!isCpuDifficulty(input.difficulty)) {
    fail(400, "Invalid CPU difficulty");
  }

  if (!Array.isArray(input.moves)) {
    fail(400, "Missing CPU match moves");
  }

  if (input.moves.length === 0) {
    fail(400, "CPU match has no moves");
  }

  if (input.moves.length > MAX_CPU_RESULT_PLIES) {
    fail(409, "CPU match exceeded maximum ply limit");
  }

  const moves = input.moves.map((move) => {
    if (typeof move !== "string" || move.trim().length === 0 || move.length > 24) {
      fail(400, "Invalid CPU match move history");
    }
    return move.trim();
  });

  const game = replayStoredMoves(moves);
  if (!game.isCheckmate() || game.turn() !== "b") {
    fail(422, "CPU leaderboard only accepts human checkmate wins");
  }

  return {
    playerName: normalizeCpuPlayerName(input.playerName),
    difficulty: input.difficulty,
    cpuCharacter: normalizeCpuCharacter(input.cpuCharacter),
    points: cpuDifficultyPoints(input.difficulty),
    payoutAmountRaw: cpuRewardAmountRaw(input.difficulty),
    moves,
    plyCount: moves.length,
  };
}
