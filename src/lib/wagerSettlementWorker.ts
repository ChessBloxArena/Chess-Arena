export type WagerPaymentMode = "wsol_escrow" | "native_sol_sponsored";
export type RentReclaimStatus = "not_applicable" | "pending" | "reclaiming" | "reclaimed" | "failed" | "unknown";
export type SettlementWorkerStatus = "settled" | "failed" | "skipped" | "reconciled";

export interface SettlementWorkerGame {
  id: string;
  status: string | null;
  winner: string | null;
  payment_status?: string | null;
  settlement_status?: string | null;
  settlement_signature?: string | null;
  settlement_retry_count?: number | string | null;
  payment_mode?: WagerPaymentMode | string | null;
  rent_reclaim_status?: RentReclaimStatus | string | null;
  rent_reclaim_signature?: string | null;
  rent_recipient_address?: string | null;
  rent_sponsor_address?: string | null;
  escrow_onchain_state?: string | null;
  referee_result_hash?: string | null;
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
  wager_asset_mint?: string | null;
  wager_stake_raw?: string | null;
  escrow_contest_id?: string | null;
}

export interface SettlementWorkerQuery {
  select(columns: string): SettlementWorkerQuery;
  eq(column: string, value: unknown): SettlementWorkerQuery;
  in(column: string, values: unknown[]): SettlementWorkerQuery;
  order(column: string, options: { ascending: boolean }): SettlementWorkerQuery;
  or?(filters: string): SettlementWorkerQuery;
  limit(count: number): Promise<{ data: SettlementWorkerGame[] | null; error: Error | null }>;
}

export interface SettlementWorkerUpdate {
  eq(column: string, value: unknown): Promise<{ error: Error | null }>;
}

export interface SettlementWorkerSupabase {
  from(table: "pvp_games"): SettlementWorkerQuery & { update(values: Record<string, unknown>): SettlementWorkerUpdate };
  functions: {
    invoke<T = unknown>(
      name: "pvp-referee",
      args: { body: Record<string, unknown> },
    ): Promise<{ data: T | null; error: Error | null }>;
  };
}

export interface SignedSettlement {
  signature: string;
  winnerWalletAddress: string;
  paymentMode?: WagerPaymentMode;
  rentReclaimStatus?: RentReclaimStatus;
  rentReclaimSignature?: string | null;
  contestClosed?: boolean;
}

export interface WagerSettlementWorkerOptions {
  supabase: SettlementWorkerSupabase;
  serviceToken: string;
  settleOnChain: (game: SettlementWorkerGame) => Promise<SignedSettlement>;
  batchSize?: number;
  nowIso?: () => string;
}

export interface SponsoredRentReconciliationEvidence {
  contestClosed: boolean;
  transactionSignature?: string | null;
  rentReclaimStatus?: RentReclaimStatus;
}

export interface SponsoredRentReconciliationOptions {
  supabase: SettlementWorkerSupabase;
  serviceToken: string;
  reconcileOnChain: (game: SettlementWorkerGame) => Promise<SponsoredRentReconciliationEvidence>;
  batchSize?: number;
  nowIso?: () => string;
}

export interface WsolRentReclamationOptions {
  supabase: SettlementWorkerSupabase;
  serviceToken: string;
  reclaimOnChain: (game: SettlementWorkerGame) => Promise<SponsoredRentReconciliationEvidence>;
  batchSize?: number;
}

export interface WagerSettlementWorkerResult {
  gameId: string;
  status: SettlementWorkerStatus;
  message?: string;
  signature?: string;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function retryCount(row: SettlementWorkerGame): number {
  const value = row.settlement_retry_count;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function settlementPaymentMode(row: SettlementWorkerGame): WagerPaymentMode {
  return row.payment_mode === "native_sol_sponsored" ? "native_sol_sponsored" : "wsol_escrow";
}

export function settlementEligibilityBlocker(row: SettlementWorkerGame): string | null {
  if (row.status !== "finished") return "Game is not finished.";
  if (row.payment_status !== "both_deposited") return "Wager deposits are not complete.";
  if (settlementPaymentMode(row) === "native_sol_sponsored" && row.rent_reclaim_status === "reclaimed") {
    return "Native sponsored wager is already reconciled.";
  }
  if (!["pending", "failed"].includes(String(row.settlement_status ?? ""))) {
    return "Settlement is not pending.";
  }
  if (row.settlement_signature || row.settlement_status === "settled") return "Wager is already settled.";
  if (row.winner !== "w" && row.winner !== "b" && row.winner !== "draw") return "Finished game has no canonical winner.";
  if (!stringValue(row.referee_result_hash)) return "Referee result hash is missing.";
  if (!stringValue(row.white_wallet_address) || !stringValue(row.black_wallet_address)) {
    return "Both wallet addresses are required.";
  }
  if (!stringValue(row.wager_asset_mint) || !stringValue(row.wager_stake_raw) || !stringValue(row.escrow_contest_id)) {
    return "Wager terms are incomplete.";
  }
  return null;
}

export function settlementRefereeBody(
  row: SettlementWorkerGame,
  serviceToken: string,
  signed: SignedSettlement,
): Record<string, unknown> {
  const rentReclaimSignature = signed.rentReclaimSignature
    ?? (signed.rentReclaimStatus ? signed.signature : undefined);
  const body: Record<string, unknown> = {
    action: "settle_finished_wager",
    gameId: row.id,
    serviceToken,
    paymentMode: signed.paymentMode ?? settlementPaymentMode(row),
    walletAddress: signed.winnerWalletAddress,
    assetMint: row.wager_asset_mint,
    stakeRaw: row.wager_stake_raw,
    stakeLamports: row.wager_stake_raw,
    escrowContestId: row.escrow_contest_id,
    transactionSignature: signed.signature,
  };
  if (signed.rentReclaimStatus) body.rentReclaimStatus = signed.rentReclaimStatus;
  if (rentReclaimSignature) body.rentReclaimSignature = rentReclaimSignature;
  if (signed.contestClosed !== undefined) body.contestClosed = signed.contestClosed;
  return body;
}

async function markSettlementFailure(
  supabase: SettlementWorkerSupabase,
  row: SettlementWorkerGame,
  error: unknown,
  nowIso: string,
): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Settlement failed";
  const response = await supabase
    .from("pvp_games")
    .update({
      settlement_status: "failed",
      settlement_last_error: message,
      settlement_retry_count: retryCount(row) + 1,
      settlement_attempted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", row.id);

  if (response.error) throw response.error;
}

function reconciliationEligibilityBlocker(row: SettlementWorkerGame): string | null {
  if (settlementPaymentMode(row) !== "native_sol_sponsored") return "Not a native sponsored wager.";
  if (!stringValue(row.escrow_contest_id)) return "Missing escrow contest id.";
  if (!stringValue(row.wager_asset_mint) || !stringValue(row.wager_stake_raw)) return "Wager terms are incomplete.";
  if (row.rent_reclaim_status === "reclaimed" && row.settlement_status === "settled") {
    return "Sponsored rent is already reconciled.";
  }
  if (row.status !== "finished" && row.payment_status !== "both_deposited") {
    return "Sponsored rent reconciliation waits for a funded terminal wager.";
  }
  return null;
}

function wsolRentReclamationEligibilityBlocker(row: SettlementWorkerGame): string | null {
  if (settlementPaymentMode(row) !== "wsol_escrow") return "Not a wSOL escrow wager.";
  if (!stringValue(row.escrow_contest_id)) return "Missing escrow contest id.";
  if (!stringValue(row.wager_asset_mint) || !stringValue(row.wager_stake_raw)) return "Wager terms are incomplete.";
  if (row.settlement_status !== "settled" || row.payment_status !== "settled") {
    return "wSOL rent reclamation waits for settled wagers.";
  }
  if (row.rent_reclaim_status === "reclaimed" && row.escrow_onchain_state === "closed") {
    return "wSOL rent is already reclaimed.";
  }
  return null;
}

function reconciliationRefereeBody(
  row: SettlementWorkerGame,
  serviceToken: string,
  evidence: SponsoredRentReconciliationEvidence,
): Record<string, unknown> {
  return {
    action: "reconcile_sponsored_rent",
    gameId: row.id,
    serviceToken,
    paymentMode: "native_sol_sponsored",
    assetMint: row.wager_asset_mint,
    stakeRaw: row.wager_stake_raw,
    stakeLamports: row.wager_stake_raw,
    escrowContestId: row.escrow_contest_id,
    transactionSignature: evidence.transactionSignature ?? row.settlement_signature ?? row.rent_reclaim_signature,
    rentReclaimStatus: evidence.rentReclaimStatus ?? (evidence.contestClosed ? "reclaimed" : "pending"),
    contestClosed: evidence.contestClosed,
  };
}

function wsolRentReclamationRefereeBody(
  row: SettlementWorkerGame,
  serviceToken: string,
  evidence: SponsoredRentReconciliationEvidence,
): Record<string, unknown> {
  return {
    action: "reconcile_contest_rent",
    gameId: row.id,
    serviceToken,
    paymentMode: "wsol_escrow",
    assetMint: row.wager_asset_mint,
    stakeRaw: row.wager_stake_raw,
    stakeLamports: row.wager_stake_raw,
    escrowContestId: row.escrow_contest_id,
    transactionSignature: evidence.transactionSignature ?? row.rent_reclaim_signature,
    rentReclaimStatus: evidence.rentReclaimStatus ?? (evidence.contestClosed ? "reclaimed" : "pending"),
    contestClosed: evidence.contestClosed,
  };
}

export async function runWagerSettlementWorker(
  options: WagerSettlementWorkerOptions,
): Promise<WagerSettlementWorkerResult[]> {
  if (!options.serviceToken) throw new Error("Missing settlement service token.");
  const nowIso = options.nowIso?.() ?? new Date().toISOString();
  const { data, error } = await options.supabase
    .from("pvp_games")
    .select("*")
    .eq("status", "finished")
    .eq("payment_status", "both_deposited")
    .in("settlement_status", ["pending", "failed"])
    .order("updated_at", { ascending: true })
    .limit(options.batchSize ?? 10);

  if (error) throw error;

  const results: WagerSettlementWorkerResult[] = [];
  for (const row of data ?? []) {
    const blocker = settlementEligibilityBlocker(row);
    if (blocker) {
      results.push({ gameId: row.id, status: "skipped", message: blocker });
      continue;
    }

    try {
      const signed = await options.settleOnChain(row);
      const response = await options.supabase.functions.invoke("pvp-referee", {
        body: settlementRefereeBody(row, options.serviceToken, {
          ...signed,
          paymentMode: signed.paymentMode ?? settlementPaymentMode(row),
        }),
      });

      if (response.error) throw response.error;
      results.push({
        gameId: row.id,
        status: "settled",
        signature: signed.signature,
      });
    } catch (err) {
      await markSettlementFailure(options.supabase, row, err, nowIso);
      results.push({
        gameId: row.id,
        status: "failed",
        message: err instanceof Error ? err.message : "Settlement failed",
      });
    }
  }

  return results;
}

export async function runSponsoredRentReconciliation(
  options: SponsoredRentReconciliationOptions,
): Promise<WagerSettlementWorkerResult[]> {
  if (!options.serviceToken) throw new Error("Missing settlement service token.");
  const query = options.supabase
    .from("pvp_games")
    .select("*")
    .eq("payment_mode", "native_sol_sponsored")
    .in("rent_reclaim_status", ["pending", "reclaiming", "failed", "unknown"])
    .order("updated_at", { ascending: true });

  const { data, error } = await query.limit(options.batchSize ?? 10);
  if (error) throw error;

  const results: WagerSettlementWorkerResult[] = [];
  for (const row of data ?? []) {
    const blocker = reconciliationEligibilityBlocker(row);
    if (blocker) {
      results.push({ gameId: row.id, status: "skipped", message: blocker });
      continue;
    }

    try {
      const evidence = await options.reconcileOnChain(row);
      const response = await options.supabase.functions.invoke("pvp-referee", {
        body: reconciliationRefereeBody(row, options.serviceToken, evidence),
      });

      if (response.error) throw response.error;
      results.push({
        gameId: row.id,
        status: evidence.contestClosed ? "reconciled" : "skipped",
        message: evidence.contestClosed ? undefined : "Sponsored rent is not reclaimed yet.",
        signature: evidence.transactionSignature ?? row.settlement_signature ?? undefined,
      });
    } catch (err) {
      results.push({
        gameId: row.id,
        status: "failed",
        message: err instanceof Error ? err.message : "Sponsored rent reconciliation failed",
      });
    }
  }

  return results;
}

export async function runWsolRentReclamation(
  options: WsolRentReclamationOptions,
): Promise<WagerSettlementWorkerResult[]> {
  if (!options.serviceToken) throw new Error("Missing settlement service token.");
  const { data, error } = await options.supabase
    .from("pvp_games")
    .select("*")
    .eq("payment_mode", "wsol_escrow")
    .eq("payment_status", "settled")
    .eq("settlement_status", "settled")
    .in("rent_reclaim_status", ["not_applicable", "pending", "reclaiming", "failed", "unknown"])
    .order("updated_at", { ascending: true })
    .limit(options.batchSize ?? 10);

  if (error) throw error;

  const results: WagerSettlementWorkerResult[] = [];
  for (const row of data ?? []) {
    const blocker = wsolRentReclamationEligibilityBlocker(row);
    if (blocker) {
      results.push({ gameId: row.id, status: "skipped", message: blocker });
      continue;
    }

    try {
      const evidence = await options.reclaimOnChain(row);
      const response = await options.supabase.functions.invoke("pvp-referee", {
        body: wsolRentReclamationRefereeBody(row, options.serviceToken, evidence),
      });

      if (response.error) throw response.error;
      results.push({
        gameId: row.id,
        status: evidence.contestClosed ? "reconciled" : "skipped",
        message: evidence.contestClosed ? undefined : "wSOL rent is not reclaimed yet.",
        signature: evidence.transactionSignature ?? row.rent_reclaim_signature ?? undefined,
      });
    } catch (err) {
      results.push({
        gameId: row.id,
        status: "failed",
        message: err instanceof Error ? err.message : "wSOL rent reclamation failed",
      });
    }
  }

  return results;
}
