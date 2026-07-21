import { describe, expect, it } from "vitest";
import {
  CpuLeaderboardValidationError,
  cpuDifficultyPoints,
  cpuRewardAmountRaw,
  normalizeCpuPlayerName,
  rankCpuLeaderboardEntries,
  validateCpuMatchResult,
} from "../../supabase/functions/pvp-referee/cpuLeaderboard.ts";
import { MoveIntegrityError } from "../../supabase/functions/pvp-referee/integrityRules.ts";

function expectCpuError(fn: () => unknown, status: number, message: string) {
  expect(fn).toThrow(CpuLeaderboardValidationError);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CpuLeaderboardValidationError);
    expect((error as CpuLeaderboardValidationError).status).toBe(status);
    expect((error as Error).message).toBe(message);
  }
}

describe("CPU leaderboard rules", () => {
  it("normalizes player tags and assigns difficulty points", () => {
    expect(normalizeCpuPlayerName(" ada  lovelace!! ")).toBe("ADA LOVELACE");
    expect(normalizeCpuPlayerName("")).toBe("PLAYER 1");
    expect(cpuDifficultyPoints("easy")).toBe(5_000);
    expect(cpuDifficultyPoints("medium")).toBe(10_000);
    expect(cpuDifficultyPoints("hard")).toBe(15_000);
    expect(cpuRewardAmountRaw("hard")).toBe(15_000_000_000n);
  });

  it("ranks by score, wins, hard wins, recency, then player name", () => {
    const ranked = rankCpuLeaderboardEntries([
      { playerName: "BETA", score: 20_000, wins: 2, hardWins: 0, lastWinAt: "2026-06-19T10:00:00.000Z" },
      { playerName: "ALPHA", score: 20_000, wins: 2, hardWins: 1, lastWinAt: "2026-06-19T09:00:00.000Z" },
      { playerName: "DELTA", score: 15_000, wins: 5, hardWins: 0, lastWinAt: "2026-06-19T12:00:00.000Z" },
      { playerName: "CHARLIE", score: 20_000, wins: 2, hardWins: 1, lastWinAt: "2026-06-19T11:00:00.000Z" },
    ]);

    expect(ranked.map((entry) => `${entry.rank}:${entry.playerName}`)).toEqual([
      "1:CHARLIE",
      "2:ALPHA",
      "3:BETA",
      "4:DELTA",
    ]);
  });

  it("accepts legal human checkmate wins as White", () => {
    const result = validateCpuMatchResult({
      playerName: "Ada",
      difficulty: "hard",
      cpuCharacter: "vinnie",
      moves: ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"],
    });

    expect(result).toMatchObject({
      playerName: "ADA",
      difficulty: "hard",
      cpuCharacter: "vinnie",
      points: 15_000,
      payoutAmountRaw: 15_000_000_000n,
      plyCount: 7,
    });
  });

  it("rejects black wins, draws, malformed history, invalid difficulty, and overlong histories", () => {
    expectCpuError(() => validateCpuMatchResult({
      playerName: "Ada",
      difficulty: "hard",
      moves: ["f3", "e5", "g4", "Qh4#"],
    }), 422, "CPU leaderboard only accepts human checkmate wins");

    expectCpuError(() => validateCpuMatchResult({
      playerName: "Ada",
      difficulty: "medium",
      moves: ["e4", "e5"],
    }), 422, "CPU leaderboard only accepts human checkmate wins");

    expect(() => validateCpuMatchResult({
      playerName: "Ada",
      difficulty: "medium",
      moves: ["e4", "not-a-move"],
    })).toThrow(MoveIntegrityError);

    expectCpuError(() => validateCpuMatchResult({
      playerName: "Ada",
      difficulty: "nightmare",
      moves: ["e4"],
    }), 400, "Invalid CPU difficulty");

    expectCpuError(() => validateCpuMatchResult({
      playerName: "Ada",
      difficulty: "easy",
      moves: Array.from({ length: 301 }, () => "e4"),
    }), 409, "CPU match exceeded maximum ply limit");
  });
});
