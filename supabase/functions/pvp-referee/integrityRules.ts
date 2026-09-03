import { Chess, type Move, type Square } from "chess.js";

export type PlayerColor = "w" | "b";
export type GameStatus = "waiting" | "active" | "finished" | "cancelled";
export type SuspiciousFlag =
  | "impossible_move_timing"
  | "same_opponent_farming"
  | "same_wallet_farming"
  | "short_game_farming"
  | "queue_cancel_churn"
  | "repeated_abandonment"
  | "timeout_abuse"
  | "duplicate_identity_pattern"
  | "rate_limit_abuse"
  | "captcha_failed"
  | "wallet_proof_failed"
  | "settlement_retry_abuse"
  | "refund_retry_abuse"
  | "manual_review_required";

export interface IntegrityGameRow {
  id: string;
  moves?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  white_session_id?: string | null;
  black_session_id?: string | null;
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
  accepted_move_count?: number | string | null;
  last_accepted_move_at?: string | null;
  suspicious_flags?: string[] | null;
  suspicious_reason?: string | null;
  refund_retry_count?: number | string | null;
  settlement_retry_count?: number | string | null;
}

export interface MoveValidationInput {
  from: unknown;
  to: unknown;
  promotion: unknown;
  expectedPly: unknown;
  currentPly: number;
  maxPlies: number;
}

export interface NormalizedMoveRequest {
  from: Square;
  to: Square;
  promotion: "q" | "r" | "b" | "n";
  expectedPly: number;
}

export interface SuspiciousContext {
  acceptedAt?: string;
  nextMoveCount?: number;
  status?: GameStatus;
  winner?: string | null;
  resultReason?: string | null;
  sameOpponentWins?: number;
  queueCancelCount?: number;
  abandonmentCount?: number;
  timeoutWins?: number;
  refundRetryCount?: number;
  settlementRetryCount?: number;
  minPrizePlies?: number;
  minPrizeDurationMs?: number;
  impossibleMoveMs?: number;
  rollingFastMoveMs?: number;
  sameOpponentWinThreshold?: number;
  queueCancelThreshold?: number;
  abandonmentThreshold?: number;
  timeoutWinThreshold?: number;
  retryAbuseThreshold?: number;
}

export interface SuspiciousUpdate {
  flags: SuspiciousFlag[];
  reason: string;
}

export class MoveIntegrityError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const squarePattern = /^[a-h][1-8]$/;
const promotionPattern = /^[qrbn]$/;

function fail(status: number, message: string): never {
  throw new MoveIntegrityError(status, message);
}

function numberFrom(value: number | string | null | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function uniqueFlags(flags: Iterable<string>): SuspiciousFlag[] {
  return [...new Set(flags)].filter((flag): flag is SuspiciousFlag => Boolean(flag));
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function validateMoveRequest(input: MoveValidationInput): NormalizedMoveRequest {
  if (typeof input.from !== "string" || !squarePattern.test(input.from)) {
    fail(400, "Invalid from square");
  }
  if (typeof input.to !== "string" || !squarePattern.test(input.to)) {
    fail(400, "Invalid to square");
  }
  const promotion = typeof input.promotion === "string" && input.promotion
    ? input.promotion
    : "q";
  if (!promotionPattern.test(promotion)) {
    fail(400, "Invalid promotion piece");
  }
  if (!Number.isInteger(input.expectedPly) || Number(input.expectedPly) < 0) {
    fail(400, "Missing expectedPly");
  }
  if (input.expectedPly !== input.currentPly) {
    fail(409, "Stale move expectedPly");
  }
  if (!Number.isInteger(input.maxPlies) || input.maxPlies <= 0) {
    fail(500, "Invalid max ply configuration");
  }
  if (input.currentPly >= input.maxPlies) {
    fail(409, "Game exceeded maximum ply limit");
  }
  return {
    from: input.from as Square,
    to: input.to as Square,
    promotion: promotion as "q" | "r" | "b" | "n",
    expectedPly: input.expectedPly,
  };
}

export function validateRequestId(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
    fail(400, "Invalid requestId");
  }
  return value;
}

export function replayStoredMoves(moves: string[] | null | undefined): Chess {
  const game = new Chess();
  for (const san of moves ?? []) {
    try {
      const result = game.move(san);
      if (!result) fail(409, "Stored game history is invalid");
    } catch (error) {
      if (error instanceof MoveIntegrityError) throw error;
      fail(409, "Stored game history is invalid");
    }
  }
  return game;
}

export function applyLegalMove(
  game: Chess,
  color: PlayerColor,
  move: Pick<NormalizedMoveRequest, "from" | "to" | "promotion">,
): Move {
  if (game.isGameOver()) fail(409, "Game is already over");
  if (game.turn() !== color) fail(409, "It is not your turn");
  try {
    const result = game.move(move);
    if (!result) fail(422, "Illegal move");
    return result;
  } catch (error) {
    if (error instanceof MoveIntegrityError) throw error;
    fail(422, "Illegal move");
  }
}

export function buildSuspiciousUpdate(
  row: IntegrityGameRow,
  context: SuspiciousContext,
): SuspiciousUpdate | null {
  const flags = new Set<SuspiciousFlag>(uniqueFlags(row.suspicious_flags ?? []));
  const reasons = row.suspicious_reason ? [row.suspicious_reason] : [];
  const impossibleMoveMs = context.impossibleMoveMs ?? 250;
  const rollingFastMoveMs = context.rollingFastMoveMs ?? 500;
  const minPrizePlies = context.minPrizePlies ?? 12;
  const minPrizeDurationMs = context.minPrizeDurationMs ?? 90_000;
  const sameOpponentWinThreshold = context.sameOpponentWinThreshold ?? 3;
  const queueCancelThreshold = context.queueCancelThreshold ?? 5;
  const abandonmentThreshold = context.abandonmentThreshold ?? 3;
  const timeoutWinThreshold = context.timeoutWinThreshold ?? 3;
  const retryAbuseThreshold = context.retryAbuseThreshold ?? 3;

  if (context.acceptedAt && row.last_accepted_move_at) {
    const previous = Date.parse(row.last_accepted_move_at);
    const current = Date.parse(context.acceptedAt);
    if (Number.isFinite(previous) && Number.isFinite(current)) {
      const elapsedMs = current - previous;
      if (elapsedMs >= 0 && elapsedMs < impossibleMoveMs) {
        flags.add("impossible_move_timing");
        addReason(reasons, `Accepted moves were recorded less than ${impossibleMoveMs}ms apart.`);
      } else if (
        numberFrom(row.accepted_move_count, 0) >= 4 &&
        elapsedMs >= 0 &&
        elapsedMs < rollingFastMoveMs
      ) {
        flags.add("impossible_move_timing");
        addReason(reasons, `Rolling move cadence stayed under ${rollingFastMoveMs}ms.`);
      }
    }
  }

  const gameDurationMs = context.acceptedAt && row.created_at
    ? Date.parse(context.acceptedAt) - Date.parse(row.created_at)
    : Number.POSITIVE_INFINITY;
  if (
    context.status === "finished" &&
    (context.winner === "w" || context.winner === "b") &&
    ((context.nextMoveCount ?? Number.POSITIVE_INFINITY) < minPrizePlies ||
      (Number.isFinite(gameDurationMs) && gameDurationMs >= 0 && gameDurationMs < minPrizeDurationMs))
  ) {
    flags.add("short_game_farming");
    addReason(reasons, "Prize-qualified win ended below minimum ply or duration thresholds.");
  }

  if (
    row.white_wallet_address &&
    row.black_wallet_address &&
    row.white_wallet_address === row.black_wallet_address
  ) {
    flags.add("same_wallet_farming");
    flags.add("duplicate_identity_pattern");
    addReason(reasons, "Both wager seats share the same wallet address.");
  }

  if ((context.sameOpponentWins ?? 0) >= sameOpponentWinThreshold) {
    flags.add("same_opponent_farming");
    addReason(reasons, "Repeated wins against the same opponent identity exceeded the review threshold.");
  }

  if ((context.queueCancelCount ?? 0) >= queueCancelThreshold) {
    flags.add("queue_cancel_churn");
    addReason(reasons, "Repeated queue cancellations exceeded the churn threshold.");
  }

  if ((context.abandonmentCount ?? 0) >= abandonmentThreshold) {
    flags.add("repeated_abandonment");
    addReason(reasons, "Repeated early abandonments exceeded the review threshold.");
  }

  if (context.resultReason === "timeout" && (context.timeoutWins ?? 0) >= timeoutWinThreshold) {
    flags.add("timeout_abuse");
    addReason(reasons, "Repeated timeout wins against related identities exceeded the review threshold.");
  }

  if ((context.refundRetryCount ?? numberFrom(row.refund_retry_count, 0)) >= retryAbuseThreshold) {
    flags.add("refund_retry_abuse");
    addReason(reasons, "Refund verification retries exceeded the review threshold.");
  }

  if ((context.settlementRetryCount ?? numberFrom(row.settlement_retry_count, 0)) >= retryAbuseThreshold) {
    flags.add("settlement_retry_abuse");
    addReason(reasons, "Settlement verification retries exceeded the review threshold.");
  }

  const nextFlags = uniqueFlags(flags);
  if (!nextFlags.length) return null;
  return {
    flags: nextFlags,
    reason: reasons.join(" "),
  };
}
