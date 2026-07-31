import { describe, expect, it } from "vitest";
import {
  defaultSponsoredWagerRiskLimits,
  evaluateSponsoredWagerGuard,
  fundedSponsoredWagerPaymentStatuses,
  isFundedSponsoredWagerPaymentStatus,
  preparedSponsoredWagerPaymentStatus,
  type SponsoredWagerRiskSnapshot,
} from "../../supabase/functions/pvp-referee/sponsoredWagerGuards.ts";
import { rateLimitKeys, refereeRateLimits } from "../../supabase/functions/pvp-referee/sessionSecurity.ts";

const baseSnapshot: SponsoredWagerRiskSnapshot = {
  enabled: true,
  signerAvailable: true,
  sponsorTreasuryLamports: 1_000_000_000n,
  walletBalanceLamports: 50_000_000n,
  stakeLamports: 10_000_000n,
  openSponsoredWagersGlobal: 0,
  openSponsoredWagersForWallet: 0,
  openSponsoredWagersForSession: 0,
  openSponsoredWagersForIpHash: 0,
  queueCancelCountForWallet: 0,
  queueCancelCountForSession: 0,
};

describe("sponsored wager abuse and treasury guards", () => {
  it("allows a low-risk sponsored wager inside treasury and open-wager limits", () => {
    expect(evaluateSponsoredWagerGuard(baseSnapshot)).toEqual({ ok: true });
  });

  it("fails closed when sponsor signing is paused or unavailable", () => {
    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      enabled: false,
    })).toMatchObject({ ok: false, code: "sponsored_wagers_paused" });

    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      signerAvailable: false,
    })).toMatchObject({ ok: false, code: "sponsor_unavailable" });
  });

  it("refuses sponsorship when treasury reserve or player stake balance is too low", () => {
    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      sponsorTreasuryLamports:
        defaultSponsoredWagerRiskLimits.minSponsorReserveLamports +
        defaultSponsoredWagerRiskLimits.estimatedRentLamportsPerContest -
        1n,
    })).toMatchObject({ ok: false, code: "sponsor_treasury_low" });

    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      walletBalanceLamports: baseSnapshot.stakeLamports - 1n,
    })).toMatchObject({ ok: false, code: "wallet_balance_below_stake" });
  });

  it("enforces max open sponsored wagers globally and per wallet, session, and IP hash", () => {
    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      openSponsoredWagersGlobal: defaultSponsoredWagerRiskLimits.maxOpenGlobal,
    })).toMatchObject({ ok: false, code: "max_open_sponsored_wagers_global" });

    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      openSponsoredWagersForWallet: defaultSponsoredWagerRiskLimits.maxOpenPerWallet,
    })).toMatchObject({ ok: false, code: "max_open_sponsored_wagers_wallet" });

    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      openSponsoredWagersForSession: defaultSponsoredWagerRiskLimits.maxOpenPerSession,
    })).toMatchObject({ ok: false, code: "max_open_sponsored_wagers_session" });

    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      openSponsoredWagersForIpHash: defaultSponsoredWagerRiskLimits.maxOpenPerIpHash,
    })).toMatchObject({ ok: false, code: "max_open_sponsored_wagers_ip" });
  });

  it("counts only funded sponsored wager states as open capacity", () => {
    expect(preparedSponsoredWagerPaymentStatus).toBe("white_prepared");
    expect(isFundedSponsoredWagerPaymentStatus("white_prepared")).toBe(false);
    expect(fundedSponsoredWagerPaymentStatuses).toEqual([
      "white_deposited",
      "black_prepared",
      "both_deposited",
    ]);
  });

  it("blocks repeated queue/cancel churn before it can lock more sponsored rent", () => {
    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      queueCancelCountForSession: defaultSponsoredWagerRiskLimits.queueCancelChurnLimit,
    })).toMatchObject({ ok: false, code: "queue_cancel_churn" });

    expect(evaluateSponsoredWagerGuard({
      ...baseSnapshot,
      queueCancelCountForWallet: defaultSponsoredWagerRiskLimits.queueCancelChurnLimit,
    })).toMatchObject({ ok: false, code: "queue_cancel_churn" });
  });

  it("keeps wager queue and cancel paths rate limited by verified session", () => {
    expect(refereeRateLimits.prepare_wager_queue).toMatchObject({ limit: 5, windowSeconds: 300 });
    expect(refereeRateLimits.cancel_wager_waiting).toMatchObject({ limit: 5, windowSeconds: 600 });

    expect(rateLimitKeys({
      action: "prepare_wager_queue",
      sessionId: "session-a",
      ipHash: "ip-a",
      userAgentHash: "ua-a",
      walletAddress: "wallet-a",
    })).toEqual([
      "session:session-a",
    ]);
  });
});
