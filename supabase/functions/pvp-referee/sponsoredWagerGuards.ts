export type SponsoredWagerRefusalCode =
  | "sponsored_wagers_paused"
  | "sponsor_unavailable"
  | "sponsor_treasury_low"
  | "wallet_balance_below_stake"
  | "max_open_sponsored_wagers_global"
  | "max_open_sponsored_wagers_wallet"
  | "max_open_sponsored_wagers_session"
  | "max_open_sponsored_wagers_ip"
  | "queue_cancel_churn";

export interface SponsoredWagerRiskLimits {
  maxOpenGlobal: number;
  maxOpenPerWallet: number;
  maxOpenPerSession: number;
  maxOpenPerIpHash: number;
  queueCancelChurnLimit: number;
  minSponsorReserveLamports: bigint;
  estimatedRentLamportsPerContest: bigint;
}

export interface SponsoredWagerRiskSnapshot {
  enabled: boolean;
  signerAvailable: boolean;
  sponsorTreasuryLamports: bigint;
  walletBalanceLamports: bigint;
  stakeLamports: bigint;
  openSponsoredWagersGlobal: number;
  openSponsoredWagersForWallet: number;
  openSponsoredWagersForSession: number;
  openSponsoredWagersForIpHash: number;
  queueCancelCountForWallet: number;
  queueCancelCountForSession: number;
}

export interface SponsoredWagerGuardResult {
  ok: boolean;
  code?: SponsoredWagerRefusalCode;
  message?: string;
}

export const preparedSponsoredWagerPaymentStatus = "white_prepared";
export const fundedSponsoredWagerPaymentStatuses = [
  "white_deposited",
  "black_prepared",
  "both_deposited",
] as const;

export function isFundedSponsoredWagerPaymentStatus(paymentStatus: string | null | undefined): boolean {
  return fundedSponsoredWagerPaymentStatuses.includes(
    paymentStatus as typeof fundedSponsoredWagerPaymentStatuses[number],
  );
}

export const defaultSponsoredWagerRiskLimits: SponsoredWagerRiskLimits = {
  maxOpenGlobal: 25,
  maxOpenPerWallet: 2,
  maxOpenPerSession: 1,
  maxOpenPerIpHash: 3,
  queueCancelChurnLimit: 5,
  minSponsorReserveLamports: 250_000_000n,
  estimatedRentLamportsPerContest: 2_500_000n,
};

function exceeded(current: number, limit: number): boolean {
  return Number.isFinite(current) && Number.isFinite(limit) && current >= limit;
}

function refusal(code: SponsoredWagerRefusalCode, message: string): SponsoredWagerGuardResult {
  return { ok: false, code, message };
}

export function evaluateSponsoredWagerGuard(
  snapshot: SponsoredWagerRiskSnapshot,
  limits: SponsoredWagerRiskLimits = defaultSponsoredWagerRiskLimits,
): SponsoredWagerGuardResult {
  if (!snapshot.enabled) {
    return refusal("sponsored_wagers_paused", "Sponsored wagers are paused");
  }

  if (!snapshot.signerAvailable) {
    return refusal("sponsor_unavailable", "Sponsor signer is unavailable");
  }

  const requiredSponsorBalance = limits.minSponsorReserveLamports + limits.estimatedRentLamportsPerContest;
  if (snapshot.sponsorTreasuryLamports < requiredSponsorBalance) {
    return refusal("sponsor_treasury_low", "Sponsor treasury is below the reserve threshold");
  }

  if (snapshot.walletBalanceLamports < snapshot.stakeLamports) {
    return refusal("wallet_balance_below_stake", "Wallet balance is below the requested stake");
  }

  if (exceeded(snapshot.openSponsoredWagersGlobal, limits.maxOpenGlobal)) {
    return refusal("max_open_sponsored_wagers_global", "Global sponsored wager capacity reached");
  }

  if (exceeded(snapshot.openSponsoredWagersForWallet, limits.maxOpenPerWallet)) {
    return refusal("max_open_sponsored_wagers_wallet", "Wallet has too many open sponsored wagers");
  }

  if (exceeded(snapshot.openSponsoredWagersForSession, limits.maxOpenPerSession)) {
    return refusal("max_open_sponsored_wagers_session", "Session has too many open sponsored wagers");
  }

  if (exceeded(snapshot.openSponsoredWagersForIpHash, limits.maxOpenPerIpHash)) {
    return refusal("max_open_sponsored_wagers_ip", "Network has too many open sponsored wagers");
  }

  if (
    exceeded(snapshot.queueCancelCountForWallet, limits.queueCancelChurnLimit) ||
    exceeded(snapshot.queueCancelCountForSession, limits.queueCancelChurnLimit)
  ) {
    return refusal("queue_cancel_churn", "Queue/cancel churn exceeded the sponsored wager threshold");
  }

  return { ok: true };
}
