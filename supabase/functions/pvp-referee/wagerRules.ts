export type PlayerColor = "w" | "b";
export type GameStatus = "waiting" | "active" | "finished" | "cancelled";
export type WagerPaymentMode = "wsol_escrow" | "native_sol_sponsored" | "robinhood_eth_escrow";
export type WagerAssetKind = "spl_token" | "native_sol" | "native_eth";
export type WagerPaymentStatus =
  | "white_prepared"
  | "white_deposited"
  | "black_prepared"
  | "both_deposited"
  | "cancelled"
  | "refunded"
  | "settled"
  | "settlement_failed";
export type SettlementStatus = "none" | "pending" | "settled" | "failed";
export type RefundStatus = "none" | "pending" | "refund_retryable" | "refunded" | "failed";

export const DEFAULT_WAGER_CLOCK_MS = 10 * 60 * 1000;
export const DEFAULT_WAGER_INCREMENT_MS = 0;

export interface WagerRuleRow {
  id: string;
  white_session_id: string;
  black_session_id: string | null;
  status: GameStatus | null;
  winner: string | null;
  updated_at: string | null;
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
  payment_mode?: WagerPaymentMode | string | null;
  wager_asset_kind?: WagerAssetKind | string | null;
  wager_asset_mint?: string | null;
  wager_stake_raw?: string | null;
  escrow_contest_id?: string | null;
  rent_sponsor_address?: string | null;
  rent_recipient_address?: string | null;
  sponsor_prepare_signature?: string | null;
  white_sponsor_signature?: string | null;
  black_sponsor_signature?: string | null;
  cancel_sponsor_signature?: string | null;
  rent_reclaim_status?: string | null;
  rent_reclaim_signature?: string | null;
  escrow_onchain_state?: string | null;
  payment_status?: WagerPaymentStatus | string | null;
  settlement_status?: SettlementStatus | string | null;
  settlement_signature?: string | null;
  refund_status?: RefundStatus | string | null;
  refund_signature?: string | null;
  refund_error?: string | null;
  clock_initial_ms?: number | string | null;
  clock_increment_ms?: number | string | null;
  white_clock_ms?: number | string | null;
  black_clock_ms?: number | string | null;
  clock_turn?: PlayerColor | string | null;
  clock_last_started_at?: string | null;
  result_reason?: string | null;
  referee_result_hash?: string | null;
}

export interface WagerIdentityCheck {
  color: PlayerColor | null;
  sessionId?: string;
  walletAddress: string;
  expectedStatus?: GameStatus;
  expectedPaymentStatus?: WagerPaymentStatus;
  expectedSettlementStatus?: SettlementStatus;
}

export interface ClockUpdate {
  white_clock_ms: number;
  black_clock_ms: number;
  clock_turn: PlayerColor | null;
  clock_last_started_at: string | null;
}

export class WagerRuleError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(status: number, message: string): never {
  throw new WagerRuleError(status, message);
}

export function opponentColor(color: PlayerColor): PlayerColor {
  return color === "w" ? "b" : "w";
}

export function isWagerRow(row: WagerRuleRow): boolean {
  return Boolean(row.payment_status || row.wager_asset_mint || row.escrow_contest_id);
}

export function isClockedRow(row: WagerRuleRow): boolean {
  const clockInitial = numberFrom(row.clock_initial_ms, 0);
  return clockInitial > 0 && row.white_clock_ms != null && row.black_clock_ms != null;
}

export function isSponsoredNativeSolWager(row: WagerRuleRow): boolean {
  return row.payment_mode === "native_sol_sponsored" || row.wager_asset_kind === "native_sol";
}

export function normalizeWalletAddress(value: unknown): string {
  if (typeof value !== "string") fail(400, "Missing walletAddress");
  const walletAddress = value.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return walletAddress.toLowerCase();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
    fail(400, "Invalid walletAddress");
  }
  return walletAddress;
}

export function normalizeRawAmount(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    fail(400, "Missing stakeRaw");
  }
  if (BigInt(value) <= 0n) fail(400, "stakeRaw must be positive");
  return value;
}

function normalizeUnsignedRaw(value: bigint | string | number, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  fail(500, `Invalid ${label}`);
}

export function assertWagerHoldBalance(
  balanceRaw: bigint | string | number,
  requiredRaw: bigint | string | number,
  message = "Wager holder token balance is below the required amount",
): void {
  const balance = normalizeUnsignedRaw(balanceRaw, "holder token balance");
  const required = normalizeUnsignedRaw(requiredRaw, "holder token requirement");
  if (required > 0n && balance < required) fail(403, message);
}

export function assertWagerIdentity(row: WagerRuleRow, check: WagerIdentityCheck): void {
  if (!check.color) fail(403, "Invalid player token for this wager");
  if (check.expectedStatus && row.status !== check.expectedStatus) {
    fail(409, `Expected game status ${check.expectedStatus}`);
  }
  if (check.expectedPaymentStatus && row.payment_status !== check.expectedPaymentStatus) {
    fail(409, `Expected payment status ${check.expectedPaymentStatus}`);
  }
  if (check.expectedSettlementStatus && (row.settlement_status ?? "none") !== check.expectedSettlementStatus) {
    fail(409, `Expected settlement status ${check.expectedSettlementStatus}`);
  }

  const expectedSessionId = check.color === "w" ? row.white_session_id : row.black_session_id;
  if (check.sessionId && expectedSessionId !== check.sessionId) {
    fail(403, "Session does not own this wager seat");
  }

  const expectedWallet = check.color === "w" ? row.white_wallet_address : row.black_wallet_address;
  if (!expectedWallet || expectedWallet !== check.walletAddress) {
    fail(403, "Wallet address does not own this wager seat");
  }
}

export function assertWagerTerms(
  row: WagerRuleRow,
  terms: { assetMint: string; stakeRaw: string; escrowContestId: string },
): void {
  if (row.wager_asset_mint !== terms.assetMint) fail(409, "Wager asset mint mismatch");
  if (row.wager_stake_raw !== terms.stakeRaw) fail(409, "Wager stake mismatch");
  if (row.escrow_contest_id !== terms.escrowContestId) fail(409, "Escrow contest id mismatch");
}

export function assertSponsoredWagerTerms(
  row: WagerRuleRow,
  terms: {
    paymentMode: WagerPaymentMode;
    assetKind: WagerAssetKind;
    assetMint: string;
    stakeRaw: string;
    escrowContestId: string;
    rentSponsorAddress: string;
    rentRecipientAddress: string;
  },
): void {
  assertWagerTerms(row, terms);
  if (row.payment_mode !== terms.paymentMode) fail(409, "Wager payment mode mismatch");
  if (row.wager_asset_kind !== terms.assetKind) fail(409, "Wager asset kind mismatch");
  if (row.rent_sponsor_address !== terms.rentSponsorAddress) fail(409, "Wager rent sponsor mismatch");
  if (row.rent_recipient_address !== terms.rentRecipientAddress) fail(409, "Wager rent recipient mismatch");
}

export function assertSettlementOpen(row: WagerRuleRow): void {
  if (row.settlement_signature || row.payment_status === "settled" || row.settlement_status === "settled") {
    fail(409, "Wager is already settled");
  }
  if (row.payment_status === "cancelled" || row.payment_status === "refunded" || row.refund_status === "refunded") {
    fail(409, "Wager has already been refunded or cancelled");
  }
}

export function assertRefundOpen(row: WagerRuleRow): void {
  if (row.refund_signature || row.refund_status === "refunded" || row.payment_status === "refunded") {
    fail(409, "Wager is already refunded");
  }
  if (row.payment_status === "settled" || row.settlement_status === "settled" || row.settlement_signature) {
    fail(409, "Settled wagers cannot be refunded");
  }
}

export function assertWsolRentReclaimable(row: WagerRuleRow, rentRecipientAddress?: string | null): void {
  const paymentMode = row.payment_mode ?? "wsol_escrow";
  const assetKind = row.wager_asset_kind ?? "spl_token";
  if (paymentMode !== "wsol_escrow" || assetKind !== "spl_token") {
    fail(409, "Wager is not a wSOL escrow wager");
  }
  if (row.rent_reclaim_status === "reclaimed" || row.escrow_onchain_state === "closed") {
    fail(409, "wSOL escrow rent is already reclaimed");
  }
  if (!row.white_wallet_address) fail(409, "Wager rent recipient is missing");
  if (rentRecipientAddress && rentRecipientAddress !== row.white_wallet_address) {
    fail(409, "Wager rent recipient mismatch");
  }

  const settledTerminal =
    row.status === "finished" &&
    row.payment_status === "settled" &&
    row.settlement_status === "settled" &&
    Boolean(row.settlement_signature);
  const refundedTerminal =
    row.status === "cancelled" &&
    (row.payment_status === "refunded" || row.payment_status === "cancelled") &&
    (row.refund_status === "refunded" || Boolean(row.refund_signature));

  if (!settledTerminal && !refundedTerminal) {
    fail(409, "wSOL escrow rent can only be reclaimed after a terminal wager");
  }
}

function numberFrom(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function elapsedSince(startIso: string | null | undefined, nowIso: string): number {
  if (!startIso) fail(409, "Wager clock is not running");
  const start = Date.parse(startIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(start) || !Number.isFinite(now)) fail(409, "Invalid wager clock timestamp");
  return Math.max(0, now - start);
}

export function initialClockState(nowIso: string, clockMs = DEFAULT_WAGER_CLOCK_MS, incrementMs = DEFAULT_WAGER_INCREMENT_MS): ClockUpdate & {
  clock_initial_ms: number;
  clock_increment_ms: number;
  clock_started_at: string;
} {
  return {
    clock_initial_ms: clockMs,
    clock_increment_ms: incrementMs,
    white_clock_ms: clockMs,
    black_clock_ms: clockMs,
    clock_turn: "w",
    clock_started_at: nowIso,
    clock_last_started_at: nowIso,
  };
}

export function activeClockSnapshot(row: WagerRuleRow, nowIso: string): ClockUpdate {
  const white = numberFrom(row.white_clock_ms, numberFrom(row.clock_initial_ms, DEFAULT_WAGER_CLOCK_MS));
  const black = numberFrom(row.black_clock_ms, numberFrom(row.clock_initial_ms, DEFAULT_WAGER_CLOCK_MS));
  const turn = row.clock_turn === "w" || row.clock_turn === "b" ? row.clock_turn : null;
  if (!turn) fail(409, "Wager clock has no active turn");

  const elapsed = elapsedSince(row.clock_last_started_at, nowIso);
  return {
    white_clock_ms: turn === "w" ? Math.max(0, white - elapsed) : white,
    black_clock_ms: turn === "b" ? Math.max(0, black - elapsed) : black,
    clock_turn: turn,
    clock_last_started_at: row.clock_last_started_at ?? null,
  };
}

export function applyAcceptedMoveClock(
  row: WagerRuleRow,
  movingColor: PlayerColor,
  nextTurn: PlayerColor,
  nowIso: string,
  gameFinished = false,
): ClockUpdate {
  if (!isClockedRow(row)) {
    return {
      white_clock_ms: numberFrom(row.white_clock_ms, DEFAULT_WAGER_CLOCK_MS),
      black_clock_ms: numberFrom(row.black_clock_ms, DEFAULT_WAGER_CLOCK_MS),
      clock_turn: null,
      clock_last_started_at: null,
    };
  }
  if (isWagerRow(row) && row.payment_status !== "both_deposited") {
    fail(409, "Wager clock only runs after both deposits are confirmed");
  }
  if (row.status !== "active") {
    fail(409, "Clock only runs during active games");
  }
  if (row.clock_turn !== movingColor) fail(409, "Wager clock turn mismatch");

  const increment = numberFrom(row.clock_increment_ms, DEFAULT_WAGER_INCREMENT_MS);
  const snapshot = activeClockSnapshot(row, nowIso);
  const movingRemaining = movingColor === "w" ? snapshot.white_clock_ms : snapshot.black_clock_ms;
  if (movingRemaining <= 0) fail(409, "Clock expired before this move was accepted");

  return {
    white_clock_ms: movingColor === "w" ? movingRemaining + increment : snapshot.white_clock_ms,
    black_clock_ms: movingColor === "b" ? movingRemaining + increment : snapshot.black_clock_ms,
    clock_turn: gameFinished ? null : nextTurn,
    clock_last_started_at: gameFinished ? null : nowIso,
  };
}

export function claimTimeoutClock(
  row: WagerRuleRow,
  claimantColor: PlayerColor,
  nowIso: string,
): ClockUpdate & { winner: PlayerColor; result_reason: "timeout"; timeout_claimed_at: string } {
  if (row.status !== "active") {
    fail(409, "Timeout can only be claimed for an active game");
  }
  if (!isClockedRow(row)) {
    fail(409, "Game has no active clock");
  }
  if (isWagerRow(row) && row.payment_status !== "both_deposited") {
    fail(409, "Timeout can only be claimed after both wager deposits are confirmed");
  }
  if (isWagerRow(row)) {
    assertSettlementOpen(row);
  }

  const activeTurn = row.clock_turn === "w" || row.clock_turn === "b" ? row.clock_turn : null;
  if (!activeTurn) fail(409, "Wager clock has no active turn");
  if (claimantColor === activeTurn) fail(403, "Active player cannot claim their own timeout");

  const snapshot = activeClockSnapshot(row, nowIso);
  const expiredMs = activeTurn === "w" ? snapshot.white_clock_ms : snapshot.black_clock_ms;
  if (expiredMs > 0) fail(409, "Opponent clock has not expired");

  return {
    white_clock_ms: activeTurn === "w" ? 0 : snapshot.white_clock_ms,
    black_clock_ms: activeTurn === "b" ? 0 : snapshot.black_clock_ms,
    clock_turn: null,
    clock_last_started_at: null,
    winner: claimantColor,
    result_reason: "timeout",
    timeout_claimed_at: nowIso,
  };
}
