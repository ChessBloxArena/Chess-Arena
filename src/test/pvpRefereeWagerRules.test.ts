import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAGER_CLOCK_MS,
  WagerRuleError,
  activeClockSnapshot,
  applyAcceptedMoveClock,
  assertWagerHoldBalance,
  assertSettlementOpen,
  assertSponsoredWagerTerms,
  assertWagerIdentity,
  assertWagerTerms,
  assertWsolRentReclaimable,
  claimTimeoutClock,
  initialClockState,
  normalizeRawAmount,
  normalizeWalletAddress,
  type WagerRuleRow,
} from "../../supabase/functions/pvp-referee/wagerRules.ts";

const whiteWallet = "11111111111111111111111111111112";
const blackWallet = "11111111111111111111111111111113";
const mint = "So11111111111111111111111111111111111111112";

function paidActiveRow(overrides: Partial<WagerRuleRow> = {}): WagerRuleRow {
  return {
    id: "game-1",
    white_session_id: "white-session",
    black_session_id: "black-session",
    status: "active",
    winner: null,
    updated_at: "2026-06-16T10:00:00.000Z",
    white_wallet_address: whiteWallet,
    black_wallet_address: blackWallet,
    wager_asset_mint: mint,
    wager_stake_raw: "100000000",
    escrow_contest_id: "contest-1",
    payment_mode: "wsol_escrow",
    wager_asset_kind: "spl_token",
    payment_status: "both_deposited",
    settlement_status: "none",
    clock_initial_ms: DEFAULT_WAGER_CLOCK_MS,
    clock_increment_ms: 0,
    white_clock_ms: DEFAULT_WAGER_CLOCK_MS,
    black_clock_ms: DEFAULT_WAGER_CLOCK_MS,
    clock_turn: "w",
    clock_last_started_at: "2026-06-16T10:00:00.000Z",
    ...overrides,
  };
}

function expectRuleError(fn: () => unknown, message: string) {
  expect(fn).toThrow(WagerRuleError);
  expect(fn).toThrow(message);
}

describe("pvp-referee wager action validation", () => {
  it("prepare_wager_queue accepts only valid player wallet, stake, and dormant clock inputs", () => {
    expect(normalizeWalletAddress(whiteWallet)).toBe(whiteWallet);
    expect(normalizeWalletAddress("0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8"))
      .toBe("0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8");
    expect(normalizeRawAmount("100000000")).toBe("100000000");
    expectRuleError(() => normalizeRawAmount("0"), "stakeRaw must be positive");

    const clock = initialClockState("2026-06-16T10:00:00.000Z");
    expect(clock.white_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS);
    expect(clock.black_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS);
    expect(clock.clock_turn).toBe("w");
  });

  it("prepare_wager_queue requires the CA holder threshold", () => {
    const holderGateMessage = "Not enough $CHESS (CA). Buy or hold at least 50,000 $CHESS (CA) tokens to wager in SOL.";
    expect(() => assertWagerHoldBalance(
      50_000_000_000n,
      50_000_000_000n,
      holderGateMessage,
    )).not.toThrow();
    expectRuleError(() => assertWagerHoldBalance(
      49_999_999_999n,
      50_000_000_000n,
      holderGateMessage,
    ), holderGateMessage);
  });

  it("confirm_white_deposit requires white token ownership, wallet, terms, and previous payment state", () => {
    const row = paidActiveRow({
      status: "waiting",
      black_session_id: null,
      black_wallet_address: null,
      payment_status: "white_prepared",
    });

    expect(() => assertWagerIdentity(row, {
      color: "w",
      sessionId: "white-session",
      walletAddress: whiteWallet,
      expectedStatus: "waiting",
      expectedPaymentStatus: "white_prepared",
      expectedSettlementStatus: "none",
    })).not.toThrow();
    expect(() => assertWagerTerms(row, {
      assetMint: mint,
      stakeRaw: "100000000",
      escrowContestId: "contest-1",
    })).not.toThrow();
    expectRuleError(() => assertWagerIdentity(row, {
      color: "w",
      sessionId: "white-session",
      walletAddress: blackWallet,
      expectedStatus: "waiting",
      expectedPaymentStatus: "white_prepared",
    }), "Wallet address does not own this wager seat");
    expectRuleError(() => assertWagerIdentity({ ...row, payment_status: "white_deposited" }, {
      color: "w",
      sessionId: "white-session",
      walletAddress: whiteWallet,
      expectedStatus: "waiting",
      expectedPaymentStatus: "white_prepared",
    }), "Expected payment status white_prepared");
  });

  it("prepare_black_deposit rejects mismatched stake, mint, and contest id before black can claim", () => {
    const row = paidActiveRow({
      status: "waiting",
      black_session_id: null,
      black_wallet_address: null,
      payment_status: "white_deposited",
    });

    expectRuleError(() => assertWagerTerms(row, {
      assetMint: "BadMint111111111111111111111111111111111",
      stakeRaw: "100000000",
      escrowContestId: "contest-1",
    }), "Wager asset mint mismatch");
    expectRuleError(() => assertWagerTerms(row, {
      assetMint: mint,
      stakeRaw: "200000000",
      escrowContestId: "contest-1",
    }), "Wager stake mismatch");
    expectRuleError(() => assertWagerTerms(row, {
      assetMint: mint,
      stakeRaw: "100000000",
      escrowContestId: "other-contest",
    }), "Escrow contest id mismatch");
  });

  it("sponsored native SOL terms reject wrong asset kind and rent recipient", () => {
    const row = paidActiveRow({
      payment_mode: "native_sol_sponsored",
      wager_asset_kind: "native_sol",
      rent_sponsor_address: whiteWallet,
      rent_recipient_address: blackWallet,
    });

    expect(() => assertSponsoredWagerTerms(row, {
      paymentMode: "native_sol_sponsored",
      assetKind: "native_sol",
      assetMint: mint,
      stakeRaw: "100000000",
      escrowContestId: "contest-1",
      rentSponsorAddress: whiteWallet,
      rentRecipientAddress: blackWallet,
    })).not.toThrow();
    expectRuleError(() => assertSponsoredWagerTerms(row, {
      paymentMode: "native_sol_sponsored",
      assetKind: "spl_token",
      assetMint: mint,
      stakeRaw: "100000000",
      escrowContestId: "contest-1",
      rentSponsorAddress: whiteWallet,
      rentRecipientAddress: blackWallet,
    }), "Wager asset kind mismatch");
    expectRuleError(() => assertSponsoredWagerTerms(row, {
      paymentMode: "native_sol_sponsored",
      assetKind: "native_sol",
      assetMint: mint,
      stakeRaw: "100000000",
      escrowContestId: "contest-1",
      rentSponsorAddress: whiteWallet,
      rentRecipientAddress: whiteWallet,
    }), "Wager rent recipient mismatch");
  });

  it("confirm_black_deposit starts the wager clock only after both deposits are confirmed", () => {
    const beforeDeposit = paidActiveRow({
      status: "waiting",
      payment_status: "black_prepared",
      clock_last_started_at: null,
      clock_turn: null,
    });

    expectRuleError(() => applyAcceptedMoveClock(beforeDeposit, "w", "b", "2026-06-16T10:00:01.000Z"), "Wager clock only runs after both deposits are confirmed");

    const started = initialClockState("2026-06-16T10:00:00.000Z");
    expect(started.clock_turn).toBe("w");
    expect(started.clock_last_started_at).toBe("2026-06-16T10:00:00.000Z");
  });

  it("move timing deducts only the active side and atomically flips the clock turn", () => {
    const row = paidActiveRow();
    const snapshot = activeClockSnapshot(row, "2026-06-16T10:00:05.000Z");
    expect(snapshot.white_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS - 5000);
    expect(snapshot.black_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS);

    const update = applyAcceptedMoveClock(row, "w", "b", "2026-06-16T10:00:05.000Z");
    expect(update.white_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS - 5000);
    expect(update.black_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS);
    expect(update.clock_turn).toBe("b");
    expect(update.clock_last_started_at).toBe("2026-06-16T10:00:05.000Z");
  });

  it("claim_timeout rejects early claims, wrong-player claims, and settled games", () => {
    const row = paidActiveRow();

    expectRuleError(() => claimTimeoutClock(row, "b", "2026-06-16T10:00:05.000Z"), "Opponent clock has not expired");
    expectRuleError(() => claimTimeoutClock(row, "w", "2026-06-16T10:11:00.000Z"), "Active player cannot claim their own timeout");
    expectRuleError(() => claimTimeoutClock({
      ...row,
      settlement_status: "settled",
      settlement_signature: "mock-settled",
    }, "b", "2026-06-16T10:11:00.000Z"), "Wager is already settled");
  });

  it("claim_timeout awards the opponent when the active clock expires", () => {
    const timeout = claimTimeoutClock(paidActiveRow(), "b", "2026-06-16T10:10:01.000Z");
    expect(timeout.winner).toBe("b");
    expect(timeout.white_clock_ms).toBe(0);
    expect(timeout.black_clock_ms).toBe(DEFAULT_WAGER_CLOCK_MS);
    expect(timeout.result_reason).toBe("timeout");
  });

  it("cancel_wager_waiting and settle_finished_wager reject duplicate or closed settlement states", () => {
    expect(() => assertSettlementOpen(paidActiveRow({ status: "finished", settlement_status: "pending" }))).not.toThrow();
    expectRuleError(() => assertSettlementOpen(paidActiveRow({
      status: "finished",
      payment_status: "settled",
      settlement_status: "settled",
      settlement_signature: "mock-settle_finished-abc",
    })), "Wager is already settled");
  });

  it("draw and non-timeout game-over moves stop the wager clock for settlement", () => {
    const update = applyAcceptedMoveClock(
      paidActiveRow({ white_clock_ms: 30_000 }),
      "w",
      "b",
      "2026-06-16T10:00:05.000Z",
      true,
    );
    expect(update.white_clock_ms).toBe(25_000);
    expect(update.clock_turn).toBeNull();
    expect(update.clock_last_started_at).toBeNull();
  });

  it("wSOL rent reclaim is only allowed after terminal escrow outcomes", () => {
    const settled = paidActiveRow({
      status: "finished",
      payment_status: "settled",
      settlement_status: "settled",
      settlement_signature: "settlement-signature",
      rent_reclaim_status: "pending",
    });
    const refunded = paidActiveRow({
      status: "cancelled",
      payment_status: "refunded",
      refund_status: "refunded",
      refund_signature: "refund-signature",
      rent_reclaim_status: "pending",
    });

    expect(() => assertWsolRentReclaimable(settled, whiteWallet)).not.toThrow();
    expect(() => assertWsolRentReclaimable(refunded, whiteWallet)).not.toThrow();
    expectRuleError(() => assertWsolRentReclaimable(paidActiveRow(), whiteWallet), "terminal wager");
    expectRuleError(() => assertWsolRentReclaimable({
      ...settled,
      payment_mode: "native_sol_sponsored",
      wager_asset_kind: "native_sol",
    }, whiteWallet), "not a wSOL escrow wager");
    expectRuleError(() => assertWsolRentReclaimable({
      ...settled,
      rent_reclaim_status: "reclaimed",
      escrow_onchain_state: "closed",
    }, whiteWallet), "already reclaimed");
    expectRuleError(() => assertWsolRentReclaimable(settled, blackWallet), "rent recipient mismatch");
  });
});
