export type WagerUiPhase =
  | "idle"
  | "signing"
  | "confirming_sponsored_deposit"
  | "confirming"
  | "queued"
  | "matched"
  | "failed"
  | "cancelled";

export interface WagerQueueEntry {
  assetMint: string;
  stakeLamports: bigint | string | number;
  paymentMode: string;
  queueStatus: string;
}

export interface WagerStartState {
  walletConnected: boolean;
  balanceLamports: bigint | null;
  stakeLamports: bigint;
  maxStakeLamports: bigint;
  newWagersEnabled: boolean;
  realEscrowEnabled: boolean;
  paymentMode?: "wsol_escrow" | "native_sol_sponsored" | "robinhood_eth_escrow";
  sponsorSignerConfigured?: boolean;
  sponsorStatus?: "available" | "unavailable" | "treasury_low" | "paused";
  stakeUsesNativeSol?: boolean;
  holdGateEnabled?: boolean;
  holdBalanceRaw?: bigint | null;
  holdRequiredRaw?: bigint;
  holdBalanceLoading?: boolean;
  holdBalanceError?: string | null;
  holdSymbol?: string;
  holdRequiredLabel?: string;
}

export interface WagerCostCopyState {
  rblxConversionEnabled?: boolean;
  automaticRblxPayoutEnabled?: boolean;
  paymentMode: "wsol_escrow" | "native_sol_sponsored" | "robinhood_eth_escrow";
  sponsoredModeAvailable: boolean;
  stakeLabel: string;
  assetSymbol: string;
  estimatedEntryLamports?: bigint | null;
  holdGateEnabled?: boolean;
  holdSymbol?: string;
  holdRequiredLabel?: string;
}

const normalizeAmount = (amount: bigint | string | number): bigint => {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") return BigInt(amount);
  return BigInt(amount);
};

const LAMPORTS_PER_SOL_BIGINT = 1_000_000_000n;
const WSOL_TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
const CONTEST_ACCOUNT_RENT_LAMPORTS = 4_176_000n;
const TRANSACTION_FEE_BUFFER_LAMPORTS = 100_000n;
const ROBINHOOD_GAS_BUFFER_WEI = 100_000_000_000_000n;

export const WSOL_ESCROW_SETUP_BUFFER_LAMPORTS =
  (WSOL_TOKEN_ACCOUNT_RENT_LAMPORTS * 2n) + CONTEST_ACCOUNT_RENT_LAMPORTS + TRANSACTION_FEE_BUFFER_LAMPORTS;

function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL_BIGINT;
  const fraction = (lamports % LAMPORTS_PER_SOL_BIGINT).toString().padStart(9, "0");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 4);
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function holderGateMessage(state: Pick<
  WagerStartState,
  "holdRequiredRaw" | "holdRequiredLabel" | "holdSymbol"
>): string {
  const requiredLabel = state.holdRequiredLabel ?? state.holdRequiredRaw?.toString() ?? "50,000";
  const symbol = state.holdSymbol ?? "CHESS";
  const ticker = symbol.startsWith("$") ? symbol : `$${symbol}`;
  return `Not enough ${ticker} (CA). Buy or hold at least ${requiredLabel} ${ticker} (CA) tokens to wager in SOL.`;
}

export function estimateMinimumWagerEntryBalance(state: Pick<
  WagerStartState,
  "paymentMode" | "sponsorSignerConfigured" | "sponsorStatus" | "stakeLamports" | "stakeUsesNativeSol"
>): bigint {
  if (state.paymentMode === "robinhood_eth_escrow") {
    return state.stakeLamports + ROBINHOOD_GAS_BUFFER_WEI;
  }
  if (
    state.paymentMode === "native_sol_sponsored" &&
    state.sponsorSignerConfigured &&
    state.sponsorStatus === "available"
  ) {
    return state.stakeLamports;
  }

  if (state.stakeUsesNativeSol !== false) {
    return state.stakeLamports + WSOL_ESCROW_SETUP_BUFFER_LAMPORTS;
  }

  return TRANSACTION_FEE_BUFFER_LAMPORTS;
}

export function areWagerQueueEntriesCompatible(a: WagerQueueEntry, b: WagerQueueEntry): boolean {
  return (
    a.queueStatus === "waiting" &&
    b.queueStatus === "waiting" &&
    a.assetMint === b.assetMint &&
    normalizeAmount(a.stakeLamports) === normalizeAmount(b.stakeLamports) &&
    a.paymentMode === b.paymentMode
  );
}

export function getWagerStartBlocker(state: WagerStartState): string | null {
  if (!state.newWagersEnabled || !state.realEscrowEnabled) {
    return "Real wager entry is disabled.";
  }
  if (state.paymentMode === "native_sol_sponsored") {
    if (!state.sponsorSignerConfigured) return "Sponsored wagers are temporarily unavailable.";
    if (state.sponsorStatus === "paused") return "Wagers are temporarily paused.";
    if (state.sponsorStatus === "treasury_low") return "Sponsored wagers are paused while the treasury refills.";
    if (state.sponsorStatus === "unavailable") return "Sponsor service unavailable. Try again shortly.";
  }
  if (!state.walletConnected) return "Connect a wallet before entering wagered PvP.";
  if (state.stakeLamports <= 0n) return "Choose a stake first.";
  if (state.stakeLamports > state.maxStakeLamports) return "Stake exceeds the configured cap.";
  if (state.holdGateEnabled) {
    if (state.holdBalanceLoading) return holderGateMessage(state);
    if (state.holdBalanceError) return state.holdBalanceError;
    if (state.holdBalanceRaw == null) return holderGateMessage(state);
    const requiredRaw = state.holdRequiredRaw ?? 0n;
    if (requiredRaw > 0n && state.holdBalanceRaw < requiredRaw) {
      return holderGateMessage(state);
    }
  }
  if (state.balanceLamports == null) return "Wallet balance is still loading.";
  const minimumBalance = estimateMinimumWagerEntryBalance(state);
  if (state.balanceLamports < minimumBalance) {
    if (state.paymentMode === "robinhood_eth_escrow") {
      return "Wallet needs enough Robinhood Chain ETH for the stake and network gas.";
    }
    if (state.stakeUsesNativeSol !== false) {
      return `Wallet needs at least ${formatSol(minimumBalance)} SOL for stake, escrow rent, and network fees.`;
    }
    return "Wallet needs SOL for escrow setup and transaction fees.";
  }
  if (state.stakeUsesNativeSol === false && state.balanceLamports <= 0n) {
    return "Wallet needs SOL for transaction fees.";
  }
  return null;
}

export function phaseLabel(phase: WagerUiPhase): string {
  switch (phase) {
    case "signing":
      return "SIGNING...";
    case "confirming_sponsored_deposit":
      return "CONFIRMING SPONSORED DEPOSIT...";
    case "confirming":
      return "CONFIRMING...";
    case "queued":
      return "QUEUED";
    case "matched":
      return "MATCHED";
    case "failed":
      return "FAILED";
    case "cancelled":
      return "CANCELLED";
    default:
      return "READY";
  }
}

export function describeWagerStartState(
  state: WagerStartState,
  phase: WagerUiPhase,
): { label: string; blocker: string | null } {
  const blocker = getWagerStartBlocker(state);
  if (blocker) return { label: blocker.toUpperCase(), blocker };
  return { label: phaseLabel(phase), blocker: null };
}

export function describeWagerCostCopy(state: WagerCostCopyState): string[] {
  if (state.paymentMode === "robinhood_eth_escrow") {
    return [
      `Stake: ${state.stakeLabel}`,
      "Network: Robinhood Chain (chain 4663)",
      state.automaticRblxPayoutEnabled
        ? "Winner receives RBLX automatically. Review your minimum prize before depositing. ETH fallback after 15 minutes."
        : state.rblxConversionEnabled
        ? "Winner claims ETH, then can convert it to RBLX via Uniswap"
        : "Winner claims the full ETH pot. Draws return each player's stake.",
      "Wallet transactions require a separate network fee.",
    ];
  }
  if (state.paymentMode === "native_sol_sponsored" && state.sponsoredModeAvailable) {
    return [
      `Stake: ${state.stakeLabel}`,
      "Network/rent: sponsored by Chess Arena",
      "Winner paid automatically",
    ];
  }

  return [
    `Stake: ${state.stakeLabel}`,
    ...(state.holdGateEnabled
      ? [`Access: hold ${state.holdRequiredLabel ?? "50000"} ${state.holdSymbol ?? "CA"}`]
      : []),
    state.estimatedEntryLamports
      ? `Wallet needed before signing: ${formatSol(state.estimatedEntryLamports)} SOL`
      : `Wallet may also need ${state.assetSymbol} for escrow account setup and network fees.`,
    "Winner paid automatically after referee settlement.",
  ];
}
