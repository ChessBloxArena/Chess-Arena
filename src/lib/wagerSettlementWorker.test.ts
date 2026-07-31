import { describe, expect, it, vi } from "vitest";
import {
  runSponsoredRentReconciliation,
  runWagerSettlementWorker,
  runWsolRentReclamation,
  settlementEligibilityBlocker,
  settlementPaymentMode,
  settlementRefereeBody,
  type SettlementWorkerGame,
  type SettlementWorkerSupabase,
} from "@/lib/wagerSettlementWorker";

const eligibleGame: SettlementWorkerGame = {
  id: "game-a",
  status: "finished",
  winner: "w",
  payment_status: "both_deposited",
  settlement_status: "pending",
  referee_result_hash: "hash-a",
  white_wallet_address: "WhiteWallet111111111111111111111111111111",
  black_wallet_address: "BlackWallet111111111111111111111111111111",
  wager_asset_mint: "So11111111111111111111111111111111111111112",
  wager_stake_raw: "50000000",
  escrow_contest_id: "contest-a",
};

function createSupabaseStub(rows: SettlementWorkerGame[]) {
  const updates: Record<string, unknown>[] = [];
  const invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    or: vi.fn(() => query),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    update: vi.fn((values: Record<string, unknown>) => {
      updates.push(values);
      return {
        eq: vi.fn().mockResolvedValue({ error: null }),
      };
    }),
  };

  return {
    supabase: {
      from: vi.fn(() => query),
      functions: { invoke },
    } as unknown as SettlementWorkerSupabase,
    query,
    invoke,
    updates,
  };
}

describe("wager settlement worker", () => {
  it("refuses rows that are not eligible for settlement", () => {
    expect(settlementEligibilityBlocker({ ...eligibleGame, status: "active" })).toContain("not finished");
    expect(settlementEligibilityBlocker({ ...eligibleGame, payment_status: "refunded" })).toContain("deposits");
    expect(settlementEligibilityBlocker({ ...eligibleGame, referee_result_hash: null })).toContain("hash");
    expect(settlementEligibilityBlocker(eligibleGame)).toBeNull();
  });

  it("routes settlement mode from row metadata", () => {
    expect(settlementPaymentMode(eligibleGame)).toBe("wsol_escrow");
    expect(settlementPaymentMode({ ...eligibleGame, payment_mode: "native_sol_sponsored" })).toBe("native_sol_sponsored");
    expect(settlementEligibilityBlocker({
      ...eligibleGame,
      payment_mode: "native_sol_sponsored",
      rent_reclaim_status: "reclaimed",
    })).toContain("already reconciled");
  });

  it("builds the referee settlement payload without signer secrets", () => {
    const body = settlementRefereeBody(eligibleGame, "service-token", {
      signature: "settlement-signature",
      winnerWalletAddress: eligibleGame.white_wallet_address!,
    });

    expect(body).toMatchObject({
      action: "settle_finished_wager",
      gameId: "game-a",
      paymentMode: "wsol_escrow",
      walletAddress: eligibleGame.white_wallet_address,
      stakeRaw: "50000000",
      transactionSignature: "settlement-signature",
    });
    expect(body).not.toHaveProperty("rentReclaimSignature");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("passes native sponsored settlement metadata to the referee", async () => {
    const nativeGame = {
      ...eligibleGame,
      payment_mode: "native_sol_sponsored",
      rent_reclaim_status: "pending",
    };
    const { supabase, invoke } = createSupabaseStub([nativeGame]);
    const result = await runWagerSettlementWorker({
      supabase,
      serviceToken: "service-token",
      settleOnChain: vi.fn().mockResolvedValue({
        signature: "native-settlement-signature",
        winnerWalletAddress: eligibleGame.white_wallet_address,
        paymentMode: "native_sol_sponsored",
        rentReclaimStatus: "reclaimed",
      }),
    });

    expect(result).toEqual([{ gameId: "game-a", status: "settled", signature: "native-settlement-signature" }]);
    expect(invoke).toHaveBeenCalledWith("pvp-referee", expect.objectContaining({
      body: expect.objectContaining({
        action: "settle_finished_wager",
        paymentMode: "native_sol_sponsored",
        rentReclaimStatus: "reclaimed",
        rentReclaimSignature: "native-settlement-signature",
      }),
    }));
  });

  it("settles eligible games through the referee", async () => {
    const { supabase, invoke } = createSupabaseStub([eligibleGame]);
    const result = await runWagerSettlementWorker({
      supabase,
      serviceToken: "service-token",
      settleOnChain: vi.fn().mockResolvedValue({
        signature: "settlement-signature",
        winnerWalletAddress: eligibleGame.white_wallet_address,
      }),
    });

    expect(result).toEqual([{ gameId: "game-a", status: "settled", signature: "settlement-signature" }]);
    expect(invoke).toHaveBeenCalledWith("pvp-referee", expect.objectContaining({
      body: expect.objectContaining({
        action: "settle_finished_wager",
        transactionSignature: "settlement-signature",
      }),
    }));
  });

  it("marks failures retryable without logging signer material", async () => {
    const { supabase, updates } = createSupabaseStub([eligibleGame]);
    const result = await runWagerSettlementWorker({
      supabase,
      serviceToken: "service-token",
      nowIso: () => "2026-06-17T00:00:00.000Z",
      settleOnChain: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
    });

    expect(result[0]).toMatchObject({ gameId: "game-a", status: "failed", message: "RPC unavailable" });
    expect(updates[0]).toMatchObject({
      settlement_status: "failed",
      settlement_last_error: "RPC unavailable",
      settlement_retry_count: 1,
      settlement_attempted_at: "2026-06-17T00:00:00.000Z",
    });
  });

  it("reconciles reclaimed sponsored rent through the referee", async () => {
    const nativeGame = {
      ...eligibleGame,
      payment_mode: "native_sol_sponsored",
      settlement_status: "settled",
      settlement_signature: "settled-signature",
      rent_reclaim_status: "pending",
    };
    const { supabase, invoke } = createSupabaseStub([nativeGame]);
    const result = await runSponsoredRentReconciliation({
      supabase,
      serviceToken: "service-token",
      reconcileOnChain: vi.fn().mockResolvedValue({
        contestClosed: true,
        transactionSignature: "settled-signature",
        rentReclaimStatus: "reclaimed",
      }),
    });

    expect(result).toEqual([{ gameId: "game-a", status: "reconciled", signature: "settled-signature" }]);
    expect(invoke).toHaveBeenCalledWith("pvp-referee", expect.objectContaining({
      body: expect.objectContaining({
        action: "reconcile_sponsored_rent",
        paymentMode: "native_sol_sponsored",
        contestClosed: true,
        rentReclaimStatus: "reclaimed",
      }),
    }));
  });

  it("reclaims settled wSOL contest rent through the referee", async () => {
    const wsolGame = {
      ...eligibleGame,
      payment_mode: "wsol_escrow",
      payment_status: "settled",
      settlement_status: "settled",
      settlement_signature: "settled-signature",
      rent_reclaim_status: "not_applicable",
      escrow_onchain_state: "settled",
    };
    const { supabase, invoke } = createSupabaseStub([wsolGame]);
    const result = await runWsolRentReclamation({
      supabase,
      serviceToken: "service-token",
      reclaimOnChain: vi.fn().mockResolvedValue({
        contestClosed: true,
        transactionSignature: "rent-reclaim-signature",
        rentReclaimStatus: "reclaimed",
      }),
    });

    expect(result).toEqual([{ gameId: "game-a", status: "reconciled", signature: "rent-reclaim-signature" }]);
    expect(invoke).toHaveBeenCalledWith("pvp-referee", expect.objectContaining({
      body: expect.objectContaining({
        action: "reconcile_contest_rent",
        paymentMode: "wsol_escrow",
        contestClosed: true,
        rentReclaimStatus: "reclaimed",
        transactionSignature: "rent-reclaim-signature",
      }),
    }));
  });

  it("skips sponsored rent rows that are already reconciled", async () => {
    const { supabase, invoke } = createSupabaseStub([{
      ...eligibleGame,
      payment_mode: "native_sol_sponsored",
      settlement_status: "settled",
      settlement_signature: "settled-signature",
      rent_reclaim_status: "reclaimed",
    }]);
    const result = await runSponsoredRentReconciliation({
      supabase,
      serviceToken: "service-token",
      reconcileOnChain: vi.fn(),
    });

    expect(result[0]).toMatchObject({ gameId: "game-a", status: "skipped" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
