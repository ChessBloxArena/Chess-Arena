import { describe, expect, it } from "vitest";
import { wagerSettlementPayoutCopy, wagerSettlementStatusCopy } from "@/components/WagerSettlementPanel";
import { deriveWagerSettlementSummary } from "@/lib/wagerSettlement";

describe("wager settlement summary", () => {
  const wagerRow = {
    payment_mode: "wsol_escrow",
    escrow_contest_id: "contest-a",
    stake_lamports: "50000000",
  };

  it("represents checkmate settlement pending", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      winner: "w",
      result_type: "checkmate",
    }, "checkmate");

    expect(summary.state).toBe("pending");
    expect(summary.resultType).toBe("checkmate");
    expect(summary.payoutLabel).toContain("Winner payout");
    expect(summary.winner).toBe("w");
    expect(summary.unwrapAvailable).toBe(false);
  });

  it("represents draw refunds", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      winner: "draw",
      settlement_status: "settled",
      settlement_signature: "abc123",
      result_type: "draw",
    }, "draw");

    expect(summary.state).toBe("settled");
    expect(summary.payoutLabel).toContain("Draw refund");
    expect(summary.settlementExplorerUrl).toContain("/tx/abc123");
    expect(summary.unwrapAvailable).toBe(true);
  });

  it("represents timeout settlement", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      winner: "b",
      result_type: "timeout",
      settlement_status: "settled",
    }, "finished");

    expect(summary.resultType).toBe("timeout");
    expect(summary.state).toBe("settled");
  });

  it("represents failed settlement as retrying before support escalation", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      winner: "w",
      settlement_status: "failed",
    }, "checkmate");

    expect(summary.state).toBe("retryable_failure");
    expect(summary.retryAvailable).toBe(true);
  });

  it("escalates repeated unreconciled settlement failures to support", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      winner: "w",
      settlement_status: "failed",
      settlement_retry_count: 3,
    }, "checkmate");

    expect(summary.state).toBe("support_needed");
    expect(summary.retryAvailable).toBe(false);
  });

  it("recognizes native sponsored wagers and rent reclaim retry state", () => {
    const summary = deriveWagerSettlementSummary({
      payment_mode: "native_sol_sponsored",
      escrow_contest_id: "contest-native",
      stake_lamports: "50000000",
      winner: "w",
      settlement_status: "settled",
      settlement_signature: "settled123",
      rent_reclaim_status: "failed",
    }, "checkmate");

    expect(summary.isWagered).toBe(true);
    expect(summary.state).toBe("retryable_failure");
    expect(summary.retryAvailable).toBe(true);
  });

  it("uses settlement retrying copy for retryable sponsored settlement failures", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      payment_mode: "native_sol_sponsored",
      winner: "w",
      settlement_status: "retryable_failure",
    }, "checkmate");

    expect(summary.state).toBe("retryable_failure");
    expect(wagerSettlementStatusCopy(summary, "w")).toBe("SETTLEMENT RETRYING");
    expect(wagerSettlementPayoutCopy(summary, "w")).toContain("Settlement retrying");
    expect(summary.unwrapAvailable).toBe(false);
  });

  it("uses support-needed copy after repeated failed reconciliation", () => {
    const summary = deriveWagerSettlementSummary({
      ...wagerRow,
      payment_mode: "native_sol_sponsored",
      winner: "w",
      settlement_retry_count: 3,
    }, "checkmate");

    expect(summary.state).toBe("support_needed");
    expect(wagerSettlementStatusCopy(summary, "w")).toBe("SUPPORT NEEDED");
    expect(wagerSettlementPayoutCopy(summary, "w")).toContain("Support needed");
  });

  it("represents native sponsored repeated failures as support-needed without wSOL unwrap", () => {
    const summary = deriveWagerSettlementSummary({
      payment_mode: "native_sol_sponsored",
      stake_lamports: "10000000",
      settlement_status: "failed",
      settlement_retry_count: 3,
      rent_reclaim_status: "unreconciled",
    }, "finished");

    expect(summary.isWagered).toBe(true);
    expect(summary.state).toBe("support_needed");
    expect(summary.retryAvailable).toBe(false);
    expect(summary.unwrapAvailable).toBe(false);
  });

  it("represents refund pending and refunded states", () => {
    const pending = deriveWagerSettlementSummary({
      ...wagerRow,
      refund_status: "pending",
    }, "finished");
    const refunded = deriveWagerSettlementSummary({
      ...wagerRow,
      refund_signature: "refund123",
    }, "finished");

    expect(pending.state).toBe("refund_pending");
    expect(pending.refundAvailable).toBe(true);
    expect(refunded.state).toBe("refunded");
    expect(refunded.refundExplorerUrl).toContain("/tx/refund123");
  });
});
