import { explorerTxUrl, formatRawAmount, getWagerConfig } from "@/lib/wagerConfig";

export type WagerSettlementState =
  | "none"
  | "pending"
  | "settled"
  | "cancelled"
  | "refund_pending"
  | "refunded"
  | "retryable_failure"
  | "support_needed"
  | "failed";

export type WagerTransactionKind =
  | "white_deposit"
  | "black_deposit"
  | "settlement"
  | "refund"
  | "cancel"
  | "unwrap";

export interface WagerTransactionLink {
  kind: WagerTransactionKind;
  label: string;
  signature: string;
  explorerUrl: string | null;
}

export interface WagerSettlementSummary {
  isWagered: boolean;
  paymentMode: string | null;
  state: WagerSettlementState;
  resultType: string;
  payoutLabel: string;
  stakeLabel: string;
  stakeRaw?: string | null;
  assetSymbol: string;
  winner: string | null;
  contestId: string | null;
  payoutMode?: string | null;
  automaticPayoutStatus?: string | null;
  automaticPayoutSignature?: string | null;
  automaticPayoutAmount?: string | null;
  ethFallbackAt?: string | null;
  settlementSignature: string | null;
  refundSignature: string | null;
  settlementExplorerUrl: string | null;
  refundExplorerUrl: string | null;
  transactionLinks: WagerTransactionLink[];
  retryAvailable: boolean;
  refundAvailable: boolean;
  unwrapAvailable: boolean;
}

type LooseGameRow = Record<string, unknown>;

function stringField(row: LooseGameRow | null | undefined, names: string[]): string | null {
  if (!row) return null;
  for (const name of names) {
    const value = row[name];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function bigintField(row: LooseGameRow | null | undefined, names: string[]): bigint | null {
  const raw = stringField(row, names);
  if (raw) {
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }
  if (row) {
    for (const name of names) {
      const value = row[name];
      if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
    }
  }
  return null;
}

function resultType(row: LooseGameRow | null | undefined, fallback: string): string {
  return stringField(row, ["result_type", "settlement_result", "winner_reason", "finish_reason"]) ?? fallback;
}

function numberField(row: LooseGameRow | null | undefined, names: string[]): number {
  if (!row) return 0;
  for (const name of names) {
    const value = row[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function transactionLink(
  row: LooseGameRow | null | undefined,
  kind: WagerTransactionKind,
  label: string,
  fieldNames: string[],
  cluster: string
): WagerTransactionLink | null {
  const signature = stringField(row, fieldNames);
  if (!signature) return null;
  return {
    kind,
    label,
    signature,
    explorerUrl: explorerTxUrl(signature, cluster),
  };
}

export function deriveWagerSettlementSummary(
  row: LooseGameRow | null | undefined,
  fallbackResultType: string
): WagerSettlementSummary {
  const config = getWagerConfig();
  const paymentMode = stringField(row, ["payment_mode", "wager_payment_mode"]);
  const contestId = stringField(row, ["escrow_contest_id", "contest_id"]);
  const stakeLamports = bigintField(row, ["stake_lamports", "wager_stake_lamports", "wager_stake_raw", "stake_amount_raw"]);
  const settlementStatus = stringField(row, ["settlement_status", "wager_settlement_status"]);
  const refundStatus = stringField(row, ["refund_status", "wager_refund_status"]);
  const settlementSignature = stringField(row, ["settlement_signature", "settle_signature"]);
  const refundSignature = stringField(row, [
    "refund_signature",
    "cancel_refund_signature",
    "white_refund_signature",
    "black_refund_signature",
  ]);
  const winner = stringField(row, ["winner"]);
  const rentReclaimStatus = stringField(row, ["rent_reclaim_status"])?.toLowerCase() ?? "";
  const isWagered = paymentMode === "wsol_escrow" || paymentMode === "native_sol_sponsored" || paymentMode === "robinhood_eth_escrow" || !!contestId || !!stakeLamports;
  const normalizedSettlement = settlementStatus?.toLowerCase() ?? "";
  const normalizedRefund = refundStatus?.toLowerCase() ?? "";
  const paymentStatus = stringField(row, ["payment_status", "wager_payment_status"])?.toLowerCase() ?? "";
  const retryCount = numberField(row, ["settlement_retry_count", "refund_retry_count", "retry_count"]);
  const supportFlag = Boolean(row?.support_needed || row?.support_required);

  let state: WagerSettlementState = "none";
  if (isWagered) {
    if (supportFlag || retryCount >= 3) state = "support_needed";
    else if (refundSignature || normalizedRefund === "refunded" || paymentStatus === "refunded") state = "refunded";
    else if (paymentStatus === "cancelled" || normalizedRefund === "cancelled") state = "cancelled";
    else if (normalizedRefund === "pending") state = "refund_pending";
    else if (
      normalizedRefund === "refund_retryable" ||
      normalizedSettlement === "retryable_failure" ||
      normalizedSettlement === "failed" ||
      rentReclaimStatus === "failed"
    ) state = "retryable_failure";
    else if (settlementSignature || normalizedSettlement === "settled") state = "settled";
    else state = "pending";
  }

  const stakeLabel = `${formatRawAmount(stakeLamports ?? 0n, config.asset.decimals)} ${config.asset.symbol}`;
  const payoutLabel = winner === "draw"
    ? `Draw refund: ${stakeLabel} per player`
    : `Winner payout: ${formatRawAmount((stakeLamports ?? 0n) * 2n, config.asset.decimals)} ${config.asset.symbol}`;

  const transactionLinks = [
    transactionLink(row, "white_deposit", "WHITE DEPOSIT", ["white_deposit_signature"], config.cluster),
    transactionLink(row, "black_deposit", "BLACK DEPOSIT", ["black_deposit_signature"], config.cluster),
    transactionLink(row, "settlement", "SETTLE TX", ["settlement_signature", "settle_signature"], config.cluster),
    transactionLink(row, "refund", "REFUND TX", [
      "refund_signature",
      "cancel_refund_signature",
      "white_refund_signature",
      "black_refund_signature",
    ], config.cluster),
    transactionLink(row, "cancel", "CANCEL TX", ["cancel_signature", "cancel_transaction_signature"], config.cluster),
  ].filter(Boolean) as WagerTransactionLink[];

  return {
    isWagered,
    paymentMode,
    state,
    resultType: resultType(row, stringField(row, ["result_reason"]) ?? fallbackResultType),
    payoutLabel,
    stakeLabel,
    stakeRaw: stakeLamports?.toString() ?? null,
    assetSymbol: config.asset.symbol,
    winner,
    contestId,
    payoutMode: stringField(row, ["payout_mode"]),
    automaticPayoutStatus: stringField(row, ["auto_payout_status"]),
    automaticPayoutSignature: stringField(row, ["auto_payout_signature"]),
    automaticPayoutAmount: stringField(row, ["auto_payout_amount"]),
    ethFallbackAt: row?.payout_mode === "automatic_rblx" && typeof row?.settlement_settled_at === "string" && Number.isFinite(Date.parse(row.settlement_settled_at)) ? new Date(Date.parse(row.settlement_settled_at) + 900_000).toISOString() : null,
    settlementSignature,
    refundSignature,
    settlementExplorerUrl: settlementSignature ? explorerTxUrl(settlementSignature, config.cluster) : null,
    refundExplorerUrl: refundSignature ? explorerTxUrl(refundSignature, config.cluster) : null,
    transactionLinks,
    retryAvailable: state === "retryable_failure",
    refundAvailable: state === "refund_pending" || normalizedRefund === "available",
    unwrapAvailable:
      isWagered &&
      paymentMode === "wsol_escrow" &&
      (state === "settled" || state === "refunded"),
  };
}
