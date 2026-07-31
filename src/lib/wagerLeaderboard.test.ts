import { describe, expect, it } from "vitest";
import {
  allocatePrizePool,
  createBiweeklyPrizeSeason,
  isVerifiedPrizeWin,
  rankTopWagerWinners,
  type PrizeSeasonWindow,
  type WagerLeaderboardGame,
} from "@/lib/wagerLeaderboard";

const season: PrizeSeasonWindow = {
  id: "season-a",
  startsAt: "2026-06-01T00:00:00.000Z",
  endsAt: "2026-06-15T00:00:00.000Z",
};

function game(overrides: Partial<WagerLeaderboardGame>): WagerLeaderboardGame {
  return {
    id: crypto.randomUUID(),
    status: "finished",
    winner: "w",
    payment_status: "settled",
    settlement_status: "settled",
    referee_result_hash: "hash-a",
    white_wallet_address: "WhiteWallet111111111111111111111111111111",
    black_wallet_address: "BlackWallet111111111111111111111111111111",
    accepted_move_count: 24,
    created_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-10T00:05:00.000Z",
    settlement_settled_at: "2026-06-10T00:05:00.000Z",
    ...overrides,
  };
}

describe("wager leaderboard", () => {
  it("counts only verified referee-confirmed wager wins", () => {
    expect(isVerifiedPrizeWin(game({}), season)).toBe(true);
    expect(isVerifiedPrizeWin(game({ winner: "draw" }), season)).toBe(false);
    expect(isVerifiedPrizeWin(game({ payment_status: "refunded" }), season)).toBe(false);
    expect(isVerifiedPrizeWin(game({ referee_result_hash: null }), season)).toBe(false);
    expect(isVerifiedPrizeWin(game({ suspicious_flags: ["same_opponent_farming"] }), season)).toBe(false);
    expect(isVerifiedPrizeWin(game({
      updated_at: "2026-06-16T00:00:00.000Z",
      settlement_settled_at: "2026-06-16T00:00:00.000Z",
    }), season)).toBe(false);
  });

  it("excludes wins below the minimum completed plies or duration", () => {
    expect(isVerifiedPrizeWin(game({ accepted_move_count: 11 }), season)).toBe(false);
    expect(isVerifiedPrizeWin(game({
      created_at: "2026-06-10T00:00:00.000Z",
      settlement_settled_at: "2026-06-10T00:01:29.000Z",
      updated_at: "2026-06-10T00:01:29.000Z",
    }), season)).toBe(false);
    expect(isVerifiedPrizeWin(game({
      accepted_move_count: 12,
      created_at: "2026-06-10T00:00:00.000Z",
      settlement_settled_at: "2026-06-10T00:01:30.000Z",
      updated_at: "2026-06-10T00:01:30.000Z",
    }), season)).toBe(true);
  });

  it("uses manual suspicious review decisions to clear or exclude games", () => {
    expect(isVerifiedPrizeWin(game({
      suspicious_flags: ["manual_review_required"],
      suspicious_reviews: [{
        status: "cleared",
        reviewer: "ops@example.com",
        decision: "eligible",
        reason: "Verified human game.",
        reviewed_at: "2026-06-11T00:00:00.000Z",
      }],
    }), season)).toBe(true);

    expect(isVerifiedPrizeWin(game({
      suspicious_reviews: [{
        status: "excluded",
        reviewer: "ops@example.com",
        decision: "exclude",
        reason: "Related-wallet farming.",
        reviewed_at: "2026-06-11T00:00:00.000Z",
      }],
    }), season)).toBe(false);

    expect(isVerifiedPrizeWin(game({
      suspicious_flags: ["short_game_farming"],
      suspicious_reviews: [{ status: "open", created_at: "2026-06-10T00:00:00.000Z" }],
    }), season)).toBe(false);
  });

  it("ranks top winners with deterministic tie breaks", () => {
    const white = "WhiteWallet111111111111111111111111111111";
    const black = "BlackWallet111111111111111111111111111111";
    const rows = [
      game({ id: "game-a", white_wallet_address: white, updated_at: "2026-06-12T00:00:00.000Z", settlement_settled_at: "2026-06-12T00:00:00.000Z" }),
      game({ id: "game-b", white_wallet_address: white, updated_at: "2026-06-13T00:00:00.000Z", settlement_settled_at: "2026-06-13T00:00:00.000Z" }),
      game({ id: "game-c", winner: "b", black_wallet_address: black, updated_at: "2026-06-11T00:00:00.000Z", settlement_settled_at: "2026-06-11T00:00:00.000Z" }),
      game({ id: "game-d", winner: "b", black_wallet_address: black, updated_at: "2026-06-14T00:00:00.000Z", settlement_settled_at: "2026-06-14T00:00:00.000Z" }),
    ];

    const leaderboard = rankTopWagerWinners(rows, season);

    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0]).toMatchObject({ walletAddress: white, wins: 2, rank: 1 });
    expect(leaderboard[1]).toMatchObject({ walletAddress: black, wins: 2, rank: 2 });
  });

  it("excludes repeated same-opponent farming unless reviewed and cleared", () => {
    const farmer = "FarmerWallet11111111111111111111111111111";
    const opponent = "OpponentWallet111111111111111111111111111";
    const organic = "OrganicWallet111111111111111111111111111";
    const rows = [
      game({ id: "farm-a", white_wallet_address: farmer, black_wallet_address: opponent, updated_at: "2026-06-10T00:05:00.000Z", settlement_settled_at: "2026-06-10T00:05:00.000Z" }),
      game({ id: "farm-b", white_wallet_address: farmer, black_wallet_address: opponent, updated_at: "2026-06-10T00:06:00.000Z", settlement_settled_at: "2026-06-10T00:06:00.000Z" }),
      game({ id: "farm-c", white_wallet_address: farmer, black_wallet_address: opponent, updated_at: "2026-06-10T00:07:00.000Z", settlement_settled_at: "2026-06-10T00:07:00.000Z" }),
      game({ id: "farm-d", white_wallet_address: farmer, black_wallet_address: opponent, updated_at: "2026-06-10T00:08:00.000Z", settlement_settled_at: "2026-06-10T00:08:00.000Z" }),
      game({ id: "organic-a", white_wallet_address: organic, black_wallet_address: opponent, updated_at: "2026-06-10T00:09:00.000Z", settlement_settled_at: "2026-06-10T00:09:00.000Z" }),
    ];

    expect(rankTopWagerWinners(rows, season).map((entry) => entry.walletAddress)).toEqual([organic]);

    const clearedRows = rows.map((row) => row.id.startsWith("farm-")
      ? game({
        ...row,
        suspicious_flags: ["same_opponent_farming"],
        suspicious_reviews: [{
          status: "cleared",
          reviewer: "ops@example.com",
          decision: "eligible",
          reason: "Tournament rematch bracket.",
          reviewed_at: "2026-06-11T00:00:00.000Z",
        }],
      })
      : row);

    const leaderboard = rankTopWagerWinners(clearedRows, season);
    expect(leaderboard[0]).toMatchObject({ walletAddress: farmer, wins: 4, rank: 1 });
  });

  it("allocates a top-ten prize pool without exceeding the funded amount", () => {
    const leaderboard = rankTopWagerWinners([
      game({ id: "game-a", white_wallet_address: "Wallet1111111111111111111111111111111111" }),
      game({ id: "game-b", white_wallet_address: "Wallet2222222222222222222222222222222222" }),
      game({ id: "game-c", white_wallet_address: "Wallet3333333333333333333333333333333333" }),
    ], season);
    const allocations = allocatePrizePool(leaderboard, 1_000_000_000n);

    expect(allocations.map((entry) => entry.amountRaw)).toEqual([250_000_000n, 180_000_000n, 570_000_000n]);
    expect(allocations.reduce((sum, entry) => sum + entry.amountRaw, 0n)).toBe(1_000_000_000n);
  });

  it("creates two-week season windows", () => {
    const current = createBiweeklyPrizeSeason(new Date("2026-06-17T00:00:00.000Z"));

    expect(current.startsAt).toBe("2026-06-08T00:00:00.000Z");
    expect(current.endsAt).toBe("2026-06-22T00:00:00.000Z");
  });
});
