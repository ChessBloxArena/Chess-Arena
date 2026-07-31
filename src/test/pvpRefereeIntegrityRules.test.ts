import { describe, expect, it } from "vitest";
import {
  MoveIntegrityError,
  applyLegalMove,
  buildSuspiciousUpdate,
  replayStoredMoves,
  validateMoveRequest,
  validateRequestId,
} from "../../supabase/functions/pvp-referee/integrityRules.ts";

function expectIntegrityError(fn: () => unknown, status: number, message: string) {
  expect(fn).toThrow(MoveIntegrityError);
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(MoveIntegrityError);
    expect((error as MoveIntegrityError).status).toBe(status);
    expect((error as Error).message).toBe(message);
  }
}

describe("pvp-referee move integrity rules", () => {
  it("rejects invalid from and to squares before chess.js", () => {
    expectIntegrityError(() => validateMoveRequest({
      from: "i2",
      to: "e4",
      promotion: "q",
      expectedPly: 0,
      currentPly: 0,
      maxPlies: 300,
    }), 400, "Invalid from square");

    expectIntegrityError(() => validateMoveRequest({
      from: "e2",
      to: "e9",
      promotion: "q",
      expectedPly: 0,
      currentPly: 0,
      maxPlies: 300,
    }), 400, "Invalid to square");
  });

  it("rejects invalid promotion and stale expected ply", () => {
    expectIntegrityError(() => validateMoveRequest({
      from: "e7",
      to: "e8",
      promotion: "k",
      expectedPly: 8,
      currentPly: 8,
      maxPlies: 300,
    }), 400, "Invalid promotion piece");

    expectIntegrityError(() => validateMoveRequest({
      from: "e2",
      to: "e4",
      promotion: "q",
      expectedPly: 0,
      currentPly: 1,
      maxPlies: 300,
    }), 409, "Stale move expectedPly");
  });

  it("rejects max ply cap and malformed stored history", () => {
    expectIntegrityError(() => validateMoveRequest({
      from: "e2",
      to: "e4",
      promotion: "q",
      expectedPly: 300,
      currentPly: 300,
      maxPlies: 300,
    }), 409, "Game exceeded maximum ply limit");

    expectIntegrityError(() => replayStoredMoves(["e4", "not-a-move"]), 409, "Stored game history is invalid");
  });

  it("rejects game-over moves after replay", () => {
    const game = replayStoredMoves(["f3", "e5", "g4", "Qh4#"]);
    expectIntegrityError(() => applyLegalMove(game, "w", {
      from: "a2",
      to: "a3",
      promotion: "q",
    }), 409, "Game is already over");
  });

  it("validates request ids used for duplicate move idempotency", () => {
    expect(validateRequestId("move:12345678")).toBe("move:12345678");
    expect(validateRequestId(undefined)).toBeNull();
    expectIntegrityError(() => validateRequestId("bad space"), 400, "Invalid requestId");
  });

  it("generates suspicious flags for timing, short games, same opponent, churn, abandonment, retries, and timeout abuse", () => {
    const update = buildSuspiciousUpdate({
      id: "game-1",
      created_at: "2026-06-17T00:00:00.000Z",
      last_accepted_move_at: "2026-06-17T00:00:10.000Z",
      accepted_move_count: 5,
      white_wallet_address: "Wallet1111111111111111111111111111111111",
      black_wallet_address: "Wallet1111111111111111111111111111111111",
    }, {
      acceptedAt: "2026-06-17T00:00:10.100Z",
      nextMoveCount: 6,
      status: "finished",
      winner: "w",
      resultReason: "timeout",
      sameOpponentWins: 3,
      queueCancelCount: 5,
      abandonmentCount: 3,
      timeoutWins: 3,
      refundRetryCount: 3,
      settlementRetryCount: 3,
    });

    expect(update?.flags).toEqual(expect.arrayContaining([
      "impossible_move_timing",
      "short_game_farming",
      "same_wallet_farming",
      "duplicate_identity_pattern",
      "same_opponent_farming",
      "queue_cancel_churn",
      "repeated_abandonment",
      "timeout_abuse",
      "refund_retry_abuse",
      "settlement_retry_abuse",
    ]));
  });
});
