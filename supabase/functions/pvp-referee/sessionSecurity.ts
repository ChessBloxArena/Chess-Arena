export type RefereeSecurityAction =
  | "init_session"
  | "get_game"
  | "submit_cpu_result"
  | "list_cpu_leaderboard"
  | "create_wallet_proof_challenge"
  | "join_queue"
  | "join_game"
  | "create_lobby"
  | "list_lobbies"
  | "join_lobby"
  | "cancel_lobby"
  | "heartbeat_lobby"
  | "heartbeat"
  | "cancel_waiting"
  | "prepare_wager_queue"
  | "prepare_wager_lobby"
  | "prepare_black_deposit"
  | "confirm_white_deposit"
  | "confirm_black_deposit"
  | "cancel_wager_waiting"
  | "prepare_sponsored_wager"
  | "confirm_sponsored_deposit"
  | "cancel_sponsored_wager"
  | "get_sponsored_wager_state"
  | "get_rblx_swap_quote"
  | "get_rblx_entry_quote"
  | "get_robinhood_payout_mode"
  | "get_automatic_rblx_quote"
  | "list_robinhood_games"
  | "recover_robinhood_seat"
  | "list_wager_recovery"
  | "recover_orphaned_wager_refund"
  | "request_wager_refund"
  | "claim_timeout"
  | "settle_finished_wager"
  | "reconcile_contest_rent"
  | "reconcile_sponsored_rent"
  | "resign"
  | "move";

export interface SessionSecurityRow {
  id: string;
  session_proof_hash: string | null;
  expires_at: string | null;
  disabled_at?: string | null;
  disabled_reason?: string | null;
}

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
  blockSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
  windowStart: string;
  blockedUntil?: string | null;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export type SessionValidationFailure =
  | "missing_session"
  | "invalid_session_id"
  | "session_not_found"
  | "invalid_session_proof"
  | "expired_session"
  | "disabled_session";

export interface SessionValidationResult {
  ok: boolean;
  reason?: SessionValidationFailure;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const browserCallableActions = new Set<RefereeSecurityAction>([
  "join_queue",
  "submit_cpu_result",
  "list_cpu_leaderboard",
  "create_lobby",
  "list_lobbies",
  "join_lobby",
  "cancel_lobby",
  "heartbeat_lobby",
  "get_game",
  "create_wallet_proof_challenge",
  "join_game",
  "heartbeat",
  "cancel_waiting",
  "prepare_wager_queue",
  "prepare_wager_lobby",
  "prepare_black_deposit",
  "confirm_white_deposit",
  "confirm_black_deposit",
  "cancel_wager_waiting",
  "prepare_sponsored_wager",
  "confirm_sponsored_deposit",
  "cancel_sponsored_wager",
  "get_sponsored_wager_state",
  "get_rblx_swap_quote",
  "get_rblx_entry_quote",
  "get_robinhood_payout_mode",
  "list_robinhood_games",
  "recover_robinhood_seat",
  "list_wager_recovery",
  "recover_orphaned_wager_refund",
  "request_wager_refund",
  "claim_timeout",
  "resign",
  "move",
]);

export const refereeRateLimits: Record<RefereeSecurityAction, RateLimitRule> = {
  init_session: { limit: 20, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  get_game: { limit: 120, windowSeconds: 60, blockSeconds: 60 },
  submit_cpu_result: { limit: 6, windowSeconds: 60, blockSeconds: 60 },
  list_cpu_leaderboard: { limit: 30, windowSeconds: 60, blockSeconds: 60 },
  create_wallet_proof_challenge: { limit: 10, windowSeconds: 5 * 60, blockSeconds: 5 * 60 },
  join_queue: { limit: 10, windowSeconds: 60, blockSeconds: 60 },
  create_lobby: { limit: 8, windowSeconds: 60, blockSeconds: 60 },
  list_lobbies: { limit: 60, windowSeconds: 60, blockSeconds: 60 },
  join_lobby: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  cancel_lobby: { limit: 8, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  heartbeat_lobby: { limit: 6, windowSeconds: 60, blockSeconds: 60 },
  prepare_wager_queue: { limit: 5, windowSeconds: 5 * 60, blockSeconds: 5 * 60 },
  prepare_wager_lobby: { limit: 5, windowSeconds: 5 * 60, blockSeconds: 5 * 60 },
  prepare_black_deposit: { limit: 5, windowSeconds: 5 * 60, blockSeconds: 5 * 60 },
  confirm_white_deposit: { limit: 10, windowSeconds: 60, blockSeconds: 60 },
  confirm_black_deposit: { limit: 10, windowSeconds: 60, blockSeconds: 60 },
  prepare_sponsored_wager: { limit: 5, windowSeconds: 5 * 60, blockSeconds: 5 * 60 },
  confirm_sponsored_deposit: { limit: 10, windowSeconds: 60, blockSeconds: 60 },
  cancel_sponsored_wager: { limit: 5, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  get_sponsored_wager_state: { limit: 60, windowSeconds: 60, blockSeconds: 60 },
  get_robinhood_payout_mode: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  get_rblx_entry_quote: { limit: 5, windowSeconds: 300, blockSeconds: 300 },
  get_automatic_rblx_quote: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  get_rblx_swap_quote: { limit: 5, windowSeconds: 5 * 60, blockSeconds: 5 * 60 },
  join_game: { limit: 30, windowSeconds: 60, blockSeconds: 60 },
  heartbeat: { limit: 4, windowSeconds: 60, blockSeconds: 60 },
  cancel_waiting: { limit: 5, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  cancel_wager_waiting: { limit: 5, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  list_robinhood_games: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  recover_robinhood_seat: { limit: 10, windowSeconds: 60, blockSeconds: 60 },
  list_wager_recovery: { limit: 10, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  recover_orphaned_wager_refund: { limit: 5, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  move: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  resign: { limit: 3, windowSeconds: 60, blockSeconds: 60 },
  claim_timeout: { limit: 3, windowSeconds: 60, blockSeconds: 60 },
  request_wager_refund: { limit: 3, windowSeconds: 10 * 60, blockSeconds: 10 * 60 },
  settle_finished_wager: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  reconcile_contest_rent: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
  reconcile_sponsored_rent: { limit: 20, windowSeconds: 60, blockSeconds: 60 },
};

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && uuidPattern.test(value);
}

export function sessionProofMaterial(sessionId: string, sessionProof: string): string {
  return `${sessionId}:${sessionProof}`;
}

export function requestIpFromHeaders(headers: HeaderReader, trustProxyHeaders: boolean): string | null {
  if (!trustProxyHeaders) return null;

  const cloudflareIp = headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!forwardedFor?.length) return null;

  return forwardedFor[forwardedFor.length - 1] ?? null;
}

export async function hashSessionProof(
  sessionId: string,
  sessionProof: string,
  sha256Hex: (value: string) => Promise<string>,
): Promise<string> {
  return sha256Hex(sessionProofMaterial(sessionId, sessionProof));
}

export function validateSessionRecord(args: {
  sessionId?: string | null;
  sessionProof?: string | null;
  expectedProofHash?: string | null;
  row?: SessionSecurityRow | null;
  nowMs: number;
  timingSafeEqual: (a: string | null | undefined, b: string) => boolean;
}): SessionValidationResult {
  if (!args.sessionId || !args.sessionProof) return { ok: false, reason: "missing_session" };
  if (!isUuid(args.sessionId)) return { ok: false, reason: "invalid_session_id" };
  if (!args.row) return { ok: false, reason: "session_not_found" };
  if (args.row.disabled_at) return { ok: false, reason: "disabled_session" };

  const expiresAt = args.row.expires_at ? Date.parse(args.row.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= args.nowMs) {
    return { ok: false, reason: "expired_session" };
  }

  if (!args.timingSafeEqual(args.row.session_proof_hash, args.expectedProofHash ?? "")) {
    return { ok: false, reason: "invalid_session_proof" };
  }

  return { ok: true };
}

export function normalizeRateLimitResult(raw: unknown): RateLimitResult {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") {
    return {
      allowed: false,
      count: 0,
      retryAfterSeconds: 60,
      windowStart: new Date(0).toISOString(),
      blockedUntil: null,
    };
  }

  const value = row as {
    allowed?: unknown;
    count?: unknown;
    retry_after_seconds?: unknown;
    retryAfterSeconds?: unknown;
    window_start?: unknown;
    windowStart?: unknown;
    blocked_until?: unknown;
    blockedUntil?: unknown;
  };

  const retryAfterSeconds = Number(value.retry_after_seconds ?? value.retryAfterSeconds ?? 60);
  return {
    allowed: value.allowed === true,
    count: Number(value.count ?? 0),
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds)) : 60,
    windowStart: String(value.window_start ?? value.windowStart ?? new Date(0).toISOString()),
    blockedUntil: typeof (value.blocked_until ?? value.blockedUntil) === "string"
      ? String(value.blocked_until ?? value.blockedUntil)
      : null,
  };
}

export function rateLimitKeys(args: {
  action: RefereeSecurityAction;
  sessionId?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
  walletAddress?: string | null;
  gameId?: string | null;
}): string[] {
  // A verified session is the identity for browser budgets. User-Agent,
  // walletAddress and gameId are caller-controlled here, not authorization.
  // Shared buckets let one player consume another player's clock time.
  if (args.sessionId) return [`session:${args.sessionId}`];
  // Session issuance and authenticated service operations retain coarse limits.
  if (args.ipHash) return [`ip:${args.ipHash}`];
  return [`anonymous:${args.action}`];
}
