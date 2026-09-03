import { signRblxAuthorization, verifyRblxAuthorization, type RblxEntryAuthorization } from "./rblxAuthorization.ts";
import { PLAY_TERMS_VERSION, QUOTE_SESSION_TTL_MS, signQuoteSession, verifyQuoteSession, type QuoteSession } from "./playConsent.ts";
import { buildRblxSwapQuote, RblxQuoteError } from "./rblxSwap.ts";
import { robinhoodRecoveryColor } from "./walletRecoveryRules.ts";
import { requiredEscrowLifetimeSeconds } from "./escrowLifetime.ts";
import "@supabase/functions-js/edge-runtime.d.ts";
import { validTransactionReference } from "./transactionReference.ts";
import { wagerPilotAllowsWallet } from "./wagerPilot.ts";
import { createClient } from "@supabase/supabase-js";
import { Connection, PublicKey } from "npm:@solana/web3.js@1.98.4";
import { createPublicClient, http, getAddress, isAddress, type Hex } from "viem";
import { sha256 as sha256Bytes } from "npm:@noble/hashes@1.8.0/sha256";
import {
  MoveIntegrityError,
  applyLegalMove,
  buildSuspiciousUpdate,
  replayStoredMoves,
  validateMoveRequest,
  validateRequestId,
} from "./integrityRules.ts";
import {
  CPU_REWARD_TOKEN_MINT,
  CPU_REWARD_TOKEN_PROGRAM_ID,
  CpuLeaderboardValidationError,
  rankCpuLeaderboardEntries,
  validateCpuMatchResult,
} from "./cpuLeaderboard.ts";
import {
  captchaProviderFromEnv,
  createWalletProofChallenge,
  practiceCaptchaRequired,
  verifyCaptchaOrThrow,
  verifyWalletProofWithNonceStore,
  type WalletProofRequest,
} from "./security.ts";
import {
  browserCallableActions,
  hashSessionProof,
  normalizeRateLimitResult,
  rateLimitKeys,
  refereeRateLimits,
  requestIpFromHeaders,
  validateSessionRecord,
  type RefereeSecurityAction,
  type SessionSecurityRow,
} from "./sessionSecurity.ts";
import {
  defaultSponsoredWagerRiskLimits,
  evaluateSponsoredWagerGuard,
  fundedSponsoredWagerPaymentStatuses,
  preparedSponsoredWagerPaymentStatus,
  type SponsoredWagerRiskLimits,
} from "./sponsoredWagerGuards.ts";
import {
  DEFAULT_WAGER_CLOCK_MS,
  WagerRuleError,
  activeClockSnapshot,
  applyAcceptedMoveClock,
  assertRefundOpen,
  assertSettlementOpen,
  assertSponsoredWagerTerms,
  assertWagerHoldBalance,
  assertWagerIdentity,
  assertWagerTerms,
  assertWsolRentReclaimable,
  claimTimeoutClock,
  initialClockState,
  isClockedRow,
  isWagerRow,
  normalizeRawAmount,
  normalizeWalletAddress,
  type PlayerColor,
  type SettlementStatus,
  type WagerAssetKind,
  type WagerPaymentMode,
  type WagerPaymentStatus,
} from "./wagerRules.ts";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_NATIVE_ETH,
  ROBINHOOD_RBLX,
  ROBINHOOD_UNIVERSAL_ROUTER,
  configuredRobinhoodEscrow,
  configuredAutomaticEscrow,
  escrowForRow,
  robinhoodEscrowAbi,
  robinhoodContestKey,
  verifyRobinhoodTransition,
} from "./robinhoodChain.ts";

type GameStatus = "waiting" | "active" | "finished" | "cancelled";
type LobbyMatchType = "free" | "wager";
type LobbyAccess = "open" | "invite" | "holder";
type LobbyColor = "random" | "white" | "black";
type LobbyStatus = "waiting" | "active" | "cancelled" | "expired";
type ChessFormatFamily = "bullet" | "blitz" | "rapid";

interface TimeControlFormat {
  id: string;
  family: ChessFormatFamily;
  label: string;
  timeControl: string;
  clockMs: number;
  incrementMs: number;
}

interface PvpGameRow {
  id: string;
  white_session_id: string;
  black_session_id: string | null;
  white_player_token_hash: string | null;
  black_player_token_hash: string | null;
  moves: string[] | null;
  status: GameStatus | null;
  winner: string | null;
  created_at: string | null;
  updated_at: string | null;
  finished_at?: string | null;
  // Expected Step 4 wager columns. Worker 3 may add these in a separate schema
  // pass; wager actions intentionally fail at the database layer until they exist.
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
  payment_mode?: WagerPaymentMode | string | null;
  wager_asset_kind?: WagerAssetKind | string | null;
  wager_asset_mint?: string | null;
  wager_asset_symbol?: string | null;
  wager_asset_decimals?: number | string | null;
  wager_stake_raw?: string | null;
  escrow_contest_id?: string | null;
  robinhood_escrow_address?: string | null;
  payout_mode?: string;
  white_minimum_rblx?: string | null;
  black_minimum_rblx?: string | null;
  auto_payout_status?: string;
  auto_payout_signature?: string | null;
  auto_payout_amount?: string | null;
  auto_payout_error?: string | null;
  auto_payout_submitted_signature?: string | null;
  auto_payout_lease_until?: string | null;
  payment_status?: WagerPaymentStatus | string | null;
  white_deposit_signature?: string | null;
  black_deposit_signature?: string | null;
  refund_signature?: string | null;
  refund_status?: string | null;
  refund_error?: string | null;
  refund_retryable_at?: string | null;
  refunded_at?: string | null;
  cancelled_at?: string | null;
  refund_retry_count?: number | string | null;
  settlement_status?: SettlementStatus | string | null;
  settlement_signature?: string | null;
  settlement_attempted_at?: string | null;
  settlement_retry_count?: number | string | null;
  settlement_last_error?: string | null;
  settlement_settled_at?: string | null;
  rent_sponsor_address?: string | null;
  rent_recipient_address?: string | null;
  sponsor_prepare_signature?: string | null;
  white_sponsor_signature?: string | null;
  black_sponsor_signature?: string | null;
  cancel_sponsor_signature?: string | null;
  rent_reclaim_status?: string | null;
  rent_reclaim_signature?: string | null;
  rent_reclaimed_at?: string | null;
  sponsored_request_id?: string | null;
  result_hash?: string | null;
  result_reason?: string | null;
  referee_result_hash?: string | null;
  accepted_move_count?: number | string | null;
  last_accepted_move_at?: string | null;
  suspicious_flags?: string[] | null;
  suspicious_reason?: string | null;
  escrow_onchain_state?: string | null;
  escrow_checked_at?: string | null;
  operator_notes?: string | null;
  clock_initial_ms?: number | string | null;
  clock_increment_ms?: number | string | null;
  white_clock_ms?: number | string | null;
  black_clock_ms?: number | string | null;
  clock_turn?: PlayerColor | string | null;
  clock_started_at?: string | null;
  clock_last_started_at?: string | null;
  timeout_claimed_at?: string | null;
}

interface PvpLobbyRow {
  id: string;
  game_id: string;
  host_session_id: string;
  name: string;
  host_name: string;
  match_type: LobbyMatchType | string;
  access: LobbyAccess | string;
  preferred_color: LobbyColor | string;
  time_control: string;
  stake_raw?: string | null;
  stake_label?: string | null;
  asset_symbol?: string | null;
  status: LobbyStatus | string;
  last_heartbeat_at: string | null;
  expires_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface RefereeRequest {
  action?: string;
  gameId?: string;
  sessionId?: string;
  sessionProof?: string;
  clientVersion?: string;
  captchaToken?: string;
  playerToken?: string;
  reuseGameId?: string;
  from?: string;
  to?: string;
  promotion?: string;
  expectedPly?: number;
  requestId?: string;
  queueMode?: "practice" | "wager";
  walletAddress?: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
  proofAction?: string;
  before?: string;
  assetMint?: string;
  stakeLamports?: string;
  stakeRaw?: string;
  escrowContestId?: string;
  transactionSignature?: string;
  claimTransactionHash?: string;
  uniswapTermsAccepted?: boolean;
  playTermsVersion?: string;
  stockTokenEligibilityAttested?: boolean;
  quoteSessionToken?: string;
  payoutAuthorization?: { token?: string; accepted?: boolean };
  paymentMode?: WagerPaymentMode | string;
  assetKind?: WagerAssetKind;
  rentSponsorAddress?: string;
  rentRecipientAddress?: string;
  sponsorSignature?: string;
  rentReclaimStatus?: string;
  rentReclaimSignature?: string;
  contestClosed?: boolean;
  vaultClosed?: boolean;
  serviceToken?: string;
  lobbyId?: string;
  lobbyName?: string;
  hostName?: string;
  matchType?: LobbyMatchType | string;
  access?: LobbyAccess | string;
  preferredColor?: LobbyColor | string;
  timeControl?: string;
  stakeLabel?: string;
  assetSymbol?: string;
  playerName?: string;
  difficulty?: string;
  cpuCharacter?: string;
  moves?: string[];
  limit?: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const gameColumns = "*";

const queueTimeoutMs = 90_000;
const queueClaimAttempts = 3;
const preparedOpponentPollMs = 500;
const wsolMint = "So11111111111111111111111111111111111111112";
const defaultWagerHoldMint = "Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump";
const defaultWagerHoldTokenProgramId = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const defaultWagerHoldSymbol = "CHESS";
const defaultWagerHoldDecimals = 6;
const defaultWagerHoldMinUnits = 50_000;
const defaultGameId = "chess-arena";
const defaultMainnetRpcUrl = "https://api.mainnet-beta.solana.com";
const defaultPubkey = "11111111111111111111111111111111";
const contestAccountDiscriminator = [216, 26, 88, 18, 251, 80, 201, 96];
const nativeContestAccountDiscriminator = [...sha256Bytes(new TextEncoder().encode("account:NativeContest")).slice(0, 8)];
const walletProofActions = new Set([
  "prepare_wager_queue",
  "prepare_wager_lobby",
  "prepare_black_deposit",
  "cancel_wager_waiting",
  "prepare_sponsored_wager",
  "cancel_sponsored_wager",
  "list_robinhood_games",
  "recover_robinhood_seat",
  "list_wager_recovery",
  "recover_orphaned_wager_refund",
  "request_wager_refund",
  "claim_timeout",
  "get_rblx_swap_quote",
  "get_rblx_entry_quote",
  "join_queue",
  "submit_cpu_result",
]);
const recoverableOrphanPaymentStatuses = ["white_prepared", "white_deposited"];
const lobbyTtlMs = 2 * 60 * 1000;
const lobbyListLimit = 30;
const queueCountLimit = 100;
const defaultTimeControl = "5+0";
const supportedTimeControls: TimeControlFormat[] = [
  { id: "bullet_1_0", family: "bullet", label: "Bullet 1+0", timeControl: "1+0", clockMs: 60_000, incrementMs: 0 },
  { id: "blitz_3_0", family: "blitz", label: "Blitz 3+0", timeControl: "3+0", clockMs: 180_000, incrementMs: 0 },
  { id: "blitz_3_2", family: "blitz", label: "Blitz 3+2", timeControl: "3+2", clockMs: 180_000, incrementMs: 2_000 },
  { id: "blitz_5_0", family: "blitz", label: "Blitz 5+0", timeControl: "5+0", clockMs: 300_000, incrementMs: 0 },
  { id: "rapid_10_0", family: "rapid", label: "Rapid 10+0", timeControl: "10+0", clockMs: 600_000, incrementMs: 0 },
  { id: "rapid_15_10", family: "rapid", label: "Rapid 15+10", timeControl: "15+10", clockMs: 900_000, incrementMs: 10_000 },
];

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for pvp-referee");
}

const admin = createClient(supabaseUrl ?? "", serviceRoleKey ?? "", {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

class HttpError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

class RateLimitError extends HttpError {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, `Too many referee requests. Try again in ${retryAfterSeconds} seconds.`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface RequestFingerprint {
  ipHash: string | null;
  userAgentHash: string | null;
}

interface SessionContext {
  sessionId: string;
  ipHash: string | null;
  userAgentHash: string | null;
  walletAddress: string | null;
  riskLevel: "low" | "medium" | "high";
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...extraHeaders,
    },
  });
}

function queueCutoffIso(): string {
  return new Date(Date.now() - queueTimeoutMs).toISOString();
}

function preparedOpponentWaitMs(): number {
  return Math.max(0, numberEnv("PVP_WAGER_PREPARED_OPPONENT_WAIT_MS", 8_000));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso(): string {
  return new Date().toISOString();
}

function numberEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bigintEnv(name: string, fallback: bigint): bigint {
  const raw = Deno.env.get(name);
  if (!raw || !/^[0-9]+$/.test(raw)) return fallback;
  return BigInt(raw);
}

function boolEnv(name: string): boolean {
  return Deno.env.get(name) === "true";
}

function optionalEnv(name: string): string | null {
  const value = Deno.env.get(name)?.trim();
  return value ? value : null;
}

function unitAmountToRaw(amount: number, decimals: number): bigint {
  const safeDecimals = Math.max(0, Math.floor(decimals));
  const scale = 10 ** Math.min(safeDecimals, 9);
  return BigInt(Math.round(amount * scale));
}

function formatRawTokenAmount(amount: bigint, decimals: number): string {
  const safeDecimals = Math.max(0, Math.floor(decimals));
  const scale = 10n ** BigInt(safeDecimals);
  const whole = amount / scale;
  const remainder = amount % scale;
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (remainder === 0n) return groupedWhole;

  const fraction = remainder.toString().padStart(safeDecimals, "0").replace(/0+$/, "");
  return fraction ? `${groupedWhole}.${fraction}` : groupedWhole;
}

function requestIp(req: Request): string | null {
  return requestIpFromHeaders(req.headers, boolEnv("PVP_TRUST_PROXY_HEADERS"));
}

async function hashRequestIdentifier(label: string, value: string | null): Promise<string | null> {
  if (!value) return null;
  const salt = optionalEnv("PVP_SESSION_HASH_SALT") ?? serviceRoleKey ?? "local-referee-salt";
  return sha256Hex(`${salt}:${label}:${value}`);
}

async function requestFingerprint(req: Request): Promise<RequestFingerprint> {
  return {
    ipHash: await hashRequestIdentifier("ip", requestIp(req)),
    userAgentHash: await hashRequestIdentifier("ua", req.headers.get("user-agent")),
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `Missing ${name}`);
  }
  return value;
}

function requireTxSignature(body: RefereeRequest, paymentMode = "wsol_escrow"): string {
  const signature = requireString(body.transactionSignature, "transactionSignature").trim();
  if (!validTransactionReference(signature, paymentMode)) {
    throw new HttpError(400, "Invalid transactionSignature");
  }
  return signature;
}

function optionalTxSignature(body: RefereeRequest): string | null {
  return typeof body.transactionSignature === "string" && body.transactionSignature.trim()
    ? body.transactionSignature.trim()
    : null;
}

function publicGame(row: PvpGameRow) {
  const {
    white_session_id: _whiteSessionId,
    black_session_id: _blackSessionId,
    white_player_token_hash: _whiteHash,
    black_player_token_hash: _blackHash,
    refund_error: _refundError,
    refund_retryable_at: _refundRetryableAt,
    refund_retry_count: _refundRetryCount,
    settlement_attempted_at: _settlementAttemptedAt,
    settlement_retry_count: _settlementRetryCount,
    settlement_last_error: _settlementLastError,
    result_hash: _resultHash,
    referee_result_hash: _refereeResultHash,
    sponsor_prepare_signature: _sponsorPrepareSignature,
    white_sponsor_signature: _whiteSponsorSignature,
    black_sponsor_signature: _blackSponsorSignature,
    cancel_sponsor_signature: _cancelSponsorSignature,
    rent_reclaim_signature: _rentReclaimSignature,
    sponsored_request_id: _sponsoredRequestId,
    suspicious_flags: _suspiciousFlags,
    suspicious_reason: _suspiciousReason,
    escrow_onchain_state: _escrowOnchainState,
    escrow_checked_at: _escrowCheckedAt,
    operator_notes: _operatorNotes,
    auto_payout_error: _autoPayoutError,
    auto_payout_submitted_signature: _autoPayoutSubmitted,
    auto_payout_lease_until: _autoPayoutLease,
    ...safeRow
  } = row;
  return {
    ...safeRow,
    white_player_present: Boolean(row.white_session_id),
    black_player_present: Boolean(row.black_session_id),
  };
}

function cleanLobbyText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return (text || fallback).slice(0, maxLength);
}

function defaultTimeControlFormat(): TimeControlFormat {
  return supportedTimeControls.find((format) => format.timeControl === defaultTimeControl) ?? supportedTimeControls[0];
}

function requestTimeControlFormat(value: unknown): TimeControlFormat {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return supportedTimeControls.find((format) =>
    format.timeControl.toLowerCase() === normalized ||
    format.id.toLowerCase() === normalized ||
    format.label.toLowerCase() === normalized
  ) ?? defaultTimeControlFormat();
}

function formatForClock(row: Pick<PvpGameRow, "clock_initial_ms" | "clock_increment_ms">): TimeControlFormat {
  const clockMs = Number(row.clock_initial_ms);
  const incrementMs = Number(row.clock_increment_ms ?? 0);
  return supportedTimeControls.find((format) =>
    Number.isFinite(clockMs) &&
    Number.isFinite(incrementMs) &&
    format.clockMs === clockMs &&
    format.incrementMs === incrementMs
  ) ?? defaultTimeControlFormat();
}

function hasSupportedClock(row: PvpGameRow): boolean {
  const clockMs = Number(row.clock_initial_ms);
  const incrementMs = Number(row.clock_increment_ms ?? 0);
  return supportedTimeControls.some((format) =>
    format.clockMs === clockMs &&
    format.incrementMs === incrementMs
  );
}

function requestLobbyMatchType(value: unknown): LobbyMatchType {
  return value === "wager" ? "wager" : "free";
}

function requestLobbyAccess(value: unknown, matchType: LobbyMatchType): LobbyAccess {
  if (value === "invite") return "invite";
  if (value === "holder" && matchType === "wager") return "holder";
  return "open";
}

function requestLobbyColor(value: unknown): LobbyColor {
  if (value === "white" || value === "black") return value;
  return "random";
}

function lobbyExpiryIso(): string {
  return new Date(Date.now() + lobbyTtlMs).toISOString();
}

function publicLobby(row: PvpLobbyRow, game?: PvpGameRow | null) {
  const format = row.time_control
    ? requestTimeControlFormat(row.time_control)
    : game
      ? formatForClock(game)
      : defaultTimeControlFormat();
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name ? row.name : "OPEN TABLE",
    hostName: row.host_name,
    matchType: row.match_type === "wager" ? "wager" : "free",
    access: row.access === "invite" || row.access === "holder" ? row.access : "open",
    color: row.preferred_color === "white" || row.preferred_color === "black" ? row.preferred_color : "random",
    formatId: format.id,
    formatFamily: format.family,
    formatLabel: format.label,
    timeControl: format.timeControl,
    stakeRaw: row.stake_raw ?? game?.wager_stake_raw ?? null,
    stakeLabel: row.stake_label ?? null,
    assetSymbol: row.asset_symbol ?? game?.wager_asset_symbol ?? null,
    status: row.status,
    gameStatus: game?.status ?? null,
    paymentStatus: game?.payment_status ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

async function expireStaleLobbies(): Promise<void> {
  const { error } = await admin
    .from("pvp_lobbies")
    .update({
      status: "expired",
      updated_at: nowIso(),
    })
    .eq("status", "waiting")
    .lt("expires_at", nowIso());

  if (error) {
    console.warn("Failed to expire stale lobbies", error);
  }
}

async function touchLobbyForGame(gameId: string, status: LobbyStatus = "waiting"): Promise<void> {
  const now = nowIso();
  const { error } = await admin
    .from("pvp_lobbies")
    .update({
      status,
      last_heartbeat_at: now,
      expires_at: status === "waiting" ? lobbyExpiryIso() : now,
      updated_at: now,
    })
    .eq("game_id", gameId)
    .in("status", ["waiting", "expired"]);

  if (error) {
    console.warn("Failed to touch lobby", { gameId, error });
  }
}

async function markLobbyForGame(gameId: string, status: LobbyStatus): Promise<void> {
  const now = nowIso();
  const { error } = await admin
    .from("pvp_lobbies")
    .update({
      status,
      updated_at: now,
      expires_at: now,
    })
    .eq("game_id", gameId)
    .in("status", ["waiting", "expired"]);

  if (error) {
    console.warn("Failed to mark lobby", { gameId, status, error });
  }
}

interface WagerHoldGateConfig {
  mint: PublicKey;
  tokenProgramId: PublicKey;
  requiredRawAmount: bigint;
  symbol: string;
  decimals: number;
}

type ParsedTokenAccountEntry = {
  account: {
    owner: PublicKey;
    data: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: {
            amount?: string;
          };
        };
      };
    };
  };
};

let wagerHoldConnectionCache: Connection | null = null;

function wagerHoldConnection(): Connection {
  if (wagerHoldConnectionCache) return wagerHoldConnectionCache;
  wagerHoldConnectionCache = new Connection(
    optionalEnv("PVP_WAGER_SOLANA_RPC_URL") ?? optionalEnv("WAGER_SOLANA_RPC_URL") ?? defaultMainnetRpcUrl,
    "confirmed",
  );
  return wagerHoldConnectionCache;
}

function configuredWagerHoldGate(): WagerHoldGateConfig | null {
  if (optionalEnv("PVP_WAGER_HOLD_GATE_ENABLED") === "false") return null;

  const decimals = Math.max(0, Math.floor(numberEnv("PVP_WAGER_HOLD_DECIMALS", defaultWagerHoldDecimals)));
  const requiredRawAmount = optionalEnv("PVP_WAGER_HOLD_MIN_RAW")
    ? bigintEnv("PVP_WAGER_HOLD_MIN_RAW", unitAmountToRaw(defaultWagerHoldMinUnits, defaultWagerHoldDecimals))
    : unitAmountToRaw(numberEnv("PVP_WAGER_HOLD_MIN_UNITS", defaultWagerHoldMinUnits), decimals);

  if (requiredRawAmount <= 0n) return null;

  return {
    mint: publicKey(optionalEnv("PVP_WAGER_HOLD_MINT") ?? defaultWagerHoldMint, "wager holder mint"),
    tokenProgramId: publicKey(
      optionalEnv("PVP_WAGER_HOLD_TOKEN_PROGRAM_ID") ?? defaultWagerHoldTokenProgramId,
      "wager holder token program",
    ),
    requiredRawAmount,
    symbol: optionalEnv("PVP_WAGER_HOLD_SYMBOL") ?? defaultWagerHoldSymbol,
    decimals,
  };
}

function parsedTokenAccountAmount(entry: ParsedTokenAccountEntry, gate: WagerHoldGateConfig): bigint {
  if (!entry.account.owner.equals(gate.tokenProgramId)) return 0n;
  const info = entry.account.data.parsed?.info;
  if (info?.mint !== gate.mint.toBase58()) return 0n;
  const amount = info.tokenAmount?.amount;
  return amount && /^[0-9]+$/.test(amount) ? BigInt(amount) : 0n;
}

async function wagerHoldBalanceRaw(walletAddress: string, gate: WagerHoldGateConfig): Promise<bigint> {
  const accounts = await wagerHoldConnection().getParsedTokenAccountsByOwner(
    publicKey(walletAddress, "wallet address"),
    { programId: gate.tokenProgramId },
    "confirmed",
  );
  return (accounts.value as unknown as ParsedTokenAccountEntry[]).reduce(
    (total, account) => total + parsedTokenAccountAmount(account, gate),
    0n,
  );
}

async function enforceWagerHoldGate(walletAddress: string): Promise<void> {
  const gate = configuredWagerHoldGate();
  if (!gate) return;

  const requiredLabel = formatRawTokenAmount(gate.requiredRawAmount, gate.decimals);
  const ticker = gate.symbol.startsWith("$") ? gate.symbol : `$${gate.symbol}`;
  const message = `Not enough ${ticker} (CA). Buy or hold at least ${requiredLabel} ${ticker} (CA) tokens to wager in SOL.`;

  let balanceRaw: bigint;
  try {
    balanceRaw = await wagerHoldBalanceRaw(walletAddress, gate);
  } catch (error) {
    console.warn("Failed to verify wager holder token balance", { walletAddress, error });
    throw new HttpError(503, "Wager holder check unavailable", "wager_hold_unavailable");
  }

  try {
    assertWagerHoldBalance(balanceRaw, gate.requiredRawAmount, message);
  } catch (error) {
    if (error instanceof WagerRuleError) {
      throw new HttpError(error.status, error.message, "wager_hold_required");
    }
    throw error;
  }
}

function configuredWagerTerms(body: RefereeRequest) {
  if (body.paymentMode === "robinhood_eth_escrow") {
    if (!boolEnv("PVP_WAGER_QUEUE_ENABLED")) throw new HttpError(503, "Wager queue is disabled");
    const assetMint = requireString(body.assetMint, "assetMint").toLowerCase();
    if (assetMint !== ROBINHOOD_NATIVE_ETH) throw new HttpError(409, "Robinhood wagers must use native ETH");
    const stakeRaw = normalizeRawAmount(body.stakeRaw ?? body.stakeLamports);
    const maxStakeRaw = Deno.env.get("PVP_ROBINHOOD_MAX_STAKE_WEI") ?? Deno.env.get("PVP_WAGER_MAX_STAKE_RAW") ?? "0";
    if (!/^[0-9]+$/.test(maxStakeRaw) || BigInt(maxStakeRaw) <= 0n) throw new HttpError(503, "Robinhood wager stake cap is not configured");
    if (BigInt(stakeRaw) > BigInt(maxStakeRaw)) throw new HttpError(409, "Stake exceeds wager cap");
    configuredRobinhoodEscrow();
    return {
      paymentMode: "robinhood_eth_escrow" as const,
      assetKind: "native_eth" as const,
      assetMint,
      stakeRaw,
      escrowContestId: typeof body.escrowContestId === "string" && body.escrowContestId.trim() ? body.escrowContestId.trim() : crypto.randomUUID(),
      symbol: "ETH",
      decimals: 18,
    };
  }
  if (body.paymentMode && body.paymentMode !== "wsol_escrow") {
    throw new HttpError(409, "Unsupported wSOL escrow payment mode");
  }
  const paymentMode: WagerPaymentMode = "wsol_escrow";
  const assetKind: WagerAssetKind = body.assetKind ?? "spl_token";
  if (assetKind !== "spl_token") throw new HttpError(409, "Unsupported wSOL escrow asset kind");

  const assetMint = requireString(body.assetMint, "assetMint");
  const stakeRaw = normalizeRawAmount(body.stakeRaw ?? body.stakeLamports);
  const escrowContestId = typeof body.escrowContestId === "string" && body.escrowContestId.trim()
    ? body.escrowContestId.trim()
    : crypto.randomUUID();
  const allowedMint = Deno.env.get("PVP_WAGER_ALLOWED_MINT") ?? wsolMint;
  const maxStakeRaw = Deno.env.get("PVP_WAGER_MAX_STAKE_RAW") ?? "0";

  if (!boolEnv("PVP_WAGER_QUEUE_ENABLED")) {
    throw new HttpError(503, "Wager queue is disabled");
  }
  if (assetMint !== allowedMint) throw new HttpError(409, "Asset mint is not allowed");
  if (!/^[0-9]+$/.test(maxStakeRaw) || BigInt(maxStakeRaw) <= 0n) {
    throw new HttpError(503, "Wager stake cap is not configured");
  }
  if (BigInt(stakeRaw) > BigInt(maxStakeRaw)) throw new HttpError(409, "Stake exceeds wager cap");

  return {
    paymentMode,
    assetKind,
    assetMint,
    stakeRaw,
    escrowContestId,
    symbol: Deno.env.get("PVP_WAGER_ASSET_SYMBOL") ?? "SOL",
    decimals: numberEnv("PVP_WAGER_ASSET_DECIMALS", 9),
  };
}

function requestWagerTerms(body: RefereeRequest, row?: PvpGameRow) {
  return {
    assetMint: requireString(row?.wager_asset_mint ?? body.assetMint, "assetMint"),
    stakeRaw: normalizeRawAmount(row?.wager_stake_raw ?? body.stakeRaw ?? body.stakeLamports),
    escrowContestId: requireString(row?.escrow_contest_id ?? body.escrowContestId, "escrowContestId"),
  };
}

function sponsoredLaneEnabled(): boolean {
  if (boolEnv("PVP_REFEREE_KILL_SWITCH")) return false;
  if (boolEnv("PVP_SPONSOR_TREASURY_LOW")) return false;
  if (boolEnv("PVP_WAGER_SPONSOR_UNAVAILABLE")) return false;
  return boolEnv("PVP_SPONSORED_WAGERS_ENABLED");
}

function configuredSponsoredWagerTerms(body: RefereeRequest) {
  if (!sponsoredLaneEnabled()) {
    throw new HttpError(503, "Sponsored wagers are unavailable");
  }

  if (body.paymentMode && body.paymentMode !== "native_sol_sponsored") {
    throw new HttpError(409, "Unsupported sponsored payment mode");
  }
  const paymentMode: WagerPaymentMode = "native_sol_sponsored";
  const assetKind: WagerAssetKind = body.assetKind ?? "native_sol";
  if (assetKind !== "native_sol") throw new HttpError(409, "Unsupported sponsored asset kind");

  const stakeRaw = normalizeRawAmount(body.stakeRaw ?? body.stakeLamports);
  const maxStakeRaw = Deno.env.get("PVP_SPONSORED_NATIVE_SOL_MAX_STAKE_RAW") ?? Deno.env.get("PVP_WAGER_MAX_STAKE_RAW") ?? "0";
  if (!/^[0-9]+$/.test(maxStakeRaw) || BigInt(maxStakeRaw) <= 0n) {
    throw new HttpError(503, "Sponsored wager stake cap is not configured");
  }
  if (BigInt(stakeRaw) > BigInt(maxStakeRaw)) throw new HttpError(409, "Stake exceeds sponsored wager cap");

  const rentSponsorAddress = publicKey(
    requireString(Deno.env.get("PVP_WAGER_RENT_SPONSOR_ADDRESS"), "PVP_WAGER_RENT_SPONSOR_ADDRESS"),
    "rent sponsor address",
  ).toBase58();
  const rentRecipientAddress = publicKey(
    requireString(Deno.env.get("PVP_WAGER_RENT_RECIPIENT_ADDRESS"), "PVP_WAGER_RENT_RECIPIENT_ADDRESS"),
    "rent recipient address",
  ).toBase58();

  return {
    paymentMode,
    assetKind,
    assetMint: Deno.env.get("PVP_SPONSORED_NATIVE_SOL_ASSET_MINT") ?? wsolMint,
    stakeRaw,
    escrowContestId: typeof body.escrowContestId === "string" && body.escrowContestId.trim()
      ? body.escrowContestId.trim()
      : crypto.randomUUID(),
    symbol: Deno.env.get("PVP_WAGER_ASSET_SYMBOL") ?? "SOL",
    decimals: numberEnv("PVP_WAGER_ASSET_DECIMALS", 9),
    rentSponsorAddress,
    rentRecipientAddress,
  };
}

function requestSponsoredWagerTerms(body: RefereeRequest, row?: PvpGameRow) {
  const terms = {
    assetMint: typeof body.assetMint === "string" && body.assetMint.trim()
      ? requireString(body.assetMint, "assetMint")
      : requireString(row?.wager_asset_mint, "wager_asset_mint"),
    stakeRaw: normalizeRawAmount(body.stakeRaw ?? body.stakeLamports ?? row?.wager_stake_raw),
    escrowContestId: typeof body.escrowContestId === "string" && body.escrowContestId.trim()
      ? body.escrowContestId.trim()
      : requireString(row?.escrow_contest_id, "escrow_contest_id"),
  };
  if (body.paymentMode && body.paymentMode !== "native_sol_sponsored") {
    throw new HttpError(409, "Wager payment mode mismatch");
  }
  const paymentMode: WagerPaymentMode = "native_sol_sponsored";
  const assetKind: WagerAssetKind = body.assetKind ?? "native_sol";
  if (assetKind !== "native_sol") throw new HttpError(409, "Wager asset kind mismatch");
  return {
    ...terms,
    paymentMode,
    assetKind,
    rentSponsorAddress: publicKey(
      typeof body.rentSponsorAddress === "string" && body.rentSponsorAddress.trim()
        ? body.rentSponsorAddress
        : requireString(row?.rent_sponsor_address, "rent_sponsor_address"),
      "rentSponsorAddress",
    ).toBase58(),
    rentRecipientAddress: publicKey(
      typeof body.rentRecipientAddress === "string" && body.rentRecipientAddress.trim()
        ? body.rentRecipientAddress
        : requireString(row?.rent_recipient_address, "rent_recipient_address"),
      "rentRecipientAddress",
    ).toBase58(),
  };
}

function requestPaymentMode(body: RefereeRequest): WagerPaymentMode {
  if (body.paymentMode === "robinhood_eth_escrow") return "robinhood_eth_escrow";
  if (body.paymentMode === "native_sol_sponsored") return "native_sol_sponsored";
  if (!body.paymentMode || body.paymentMode === "wsol_escrow") return "wsol_escrow";
  throw new HttpError(400, "Unsupported paymentMode");
}

function rowPaymentMode(row: PvpGameRow): WagerPaymentMode {
  if (row.payment_mode === "robinhood_eth_escrow") return "robinhood_eth_escrow";
  return row.payment_mode === "native_sol_sponsored" ? "native_sol_sponsored" : "wsol_escrow";
}

interface WsolEscrowLaneQuery<TSelf> {
  or(filters: string): TSelf;
}

function guardWsolEscrowLane<T extends WsolEscrowLaneQuery<T>>(query: T): T {
  return query
    .or("payment_mode.is.null,payment_mode.eq.wsol_escrow,payment_mode.eq.robinhood_eth_escrow")
    .or("wager_asset_kind.is.null,wager_asset_kind.eq.spl_token,wager_asset_kind.eq.native_eth");
}

function isPracticeMatchmakingRow(row: PvpGameRow): boolean {
  return !(
    isWagerRow(row) ||
    row.payment_mode ||
    row.wager_asset_kind ||
    row.wager_stake_raw ||
    row.white_wallet_address ||
    row.black_wallet_address
  );
}

function assertWsolEscrowLane(row: PvpGameRow): void {
  const paymentMode = row.payment_mode ?? "wsol_escrow";
  const assetKind = row.wager_asset_kind ?? "spl_token";
  const isLegacy = paymentMode === "wsol_escrow" && assetKind === "spl_token";
  const isRobinhood = paymentMode === "robinhood_eth_escrow" && assetKind === "native_eth";
  if (!isLegacy && !isRobinhood) {
    throw new HttpError(409, "Game is not a supported direct escrow wager");
  }
}

function requestRentReclaimStatus(body: RefereeRequest): "pending" | "reclaiming" | "reclaimed" | "failed" | "unknown" {
  if (
    body.rentReclaimStatus === "pending" ||
    body.rentReclaimStatus === "reclaiming" ||
    body.rentReclaimStatus === "reclaimed" ||
    body.rentReclaimStatus === "failed" ||
    body.rentReclaimStatus === "unknown"
  ) {
    return body.rentReclaimStatus;
  }
  return body.contestClosed ? "reclaimed" : "pending";
}

function wagerClockConfig(timeControl?: unknown) {
  if (timeControl) {
    const format = requestTimeControlFormat(timeControl);
    return {
      clockMs: format.clockMs,
      incrementMs: format.incrementMs,
      timeControl: format.timeControl,
    };
  }
  return {
    clockMs: numberEnv("PVP_WAGER_CLOCK_MS", DEFAULT_WAGER_CLOCK_MS),
    incrementMs: numberEnv("PVP_WAGER_INCREMENT_MS", 0),
    timeControl: defaultTimeControl,
  };
}

interface UpdatedAtGuardQuery<TSelf> {
  eq(column: string, value: unknown): TSelf;
  is(column: string, value: null): TSelf;
}

function guardUpdatedAt<T extends UpdatedAtGuardQuery<T>>(query: T, row: PvpGameRow): T {
  return row.updated_at ? query.eq("updated_at", row.updated_at) : query.is("updated_at", null);
}

async function logAbuseEvent(input: {
  sessionId?: string | null;
  gameId?: string | null;
  walletAddress?: string | null;
  ipHash?: string | null;
  userAgentHash?: string | null;
  action: string;
  eventType: string;
  severity?: "info" | "warning" | "critical";
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const sessionId = input.sessionId && /^[0-9a-f-]{36}$/i.test(input.sessionId) ? input.sessionId : null;
  const gameId = input.gameId && /^[0-9a-f-]{36}$/i.test(input.gameId) ? input.gameId : null;
  const { error } = await admin
    .from("pvp_abuse_events")
    .insert({
      session_id: sessionId,
      game_id: gameId,
      wallet_address: input.walletAddress ?? null,
      ip_hash: input.ipHash ?? null,
      user_agent_hash: input.userAgentHash ?? null,
      action: input.action,
      event_type: input.eventType,
      severity: input.severity ?? "info",
      evidence: input.evidence ?? {},
    });
  if (error) console.error("Failed to record PvP abuse event", error);
}

async function enforceRateLimit(
  action: RefereeSecurityAction,
  fingerprint: RequestFingerprint,
  body: RefereeRequest,
  session: SessionContext | null,
): Promise<void> {
  const rule = refereeRateLimits[action];
  const keys = rateLimitKeys({
    action,
    sessionId: session?.sessionId ?? null,
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
    walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : session?.walletAddress ?? null,
    gameId: typeof body.gameId === "string" ? body.gameId : null,
  });

  for (const key of keys) {
    const { data, error } = await admin.rpc("pvp_consume_rate_limit", {
      p_key: key,
      p_action: action,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
      p_block_seconds: rule.blockSeconds,
    });

    if (error) throw error;
    const result = normalizeRateLimitResult(data);
    if (!result.allowed) {
      await logAbuseEvent({
        sessionId: session?.sessionId ?? body.sessionId ?? null,
        gameId: body.gameId ?? null,
        walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : session?.walletAddress ?? null,
        ipHash: fingerprint.ipHash,
        userAgentHash: fingerprint.userAgentHash,
        action,
        eventType: "rate_limit_hit",
        severity: "warning",
        evidence: {
          key,
          limit: rule.limit,
          windowSeconds: rule.windowSeconds,
          count: result.count,
          retryAfterSeconds: result.retryAfterSeconds,
        },
      });
      throw new RateLimitError(result.retryAfterSeconds);
    }
  }
}

function randomSecretHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function handleInitSession(body: RefereeRequest, fingerprint: RequestFingerprint) {
  const sessionId = crypto.randomUUID();
  const sessionProof = randomSecretHex();
  const proofHash = await hashSessionProof(sessionId, sessionProof, sha256Hex);
  const walletAddress = typeof body.walletAddress === "string" && body.walletAddress.trim()
    ? normalizeWalletAddress(body.walletAddress)
    : null;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const now = nowIso();

  const { error } = await admin
    .from("pvp_sessions")
    .insert({
      id: sessionId,
      session_proof_hash: proofHash,
      ip_hash: fingerprint.ipHash,
      user_agent_hash: fingerprint.userAgentHash,
      wallet_address: walletAddress,
      risk_score: 0,
      first_seen_at: now,
      last_seen_at: now,
      expires_at: expiresAt,
      action_counters: {},
    });

  if (error) throw error;

  return {
    sessionId,
    sessionProof,
    expiresAt,
    riskLevel: "low" as const,
    captchaRequired: false,
    walletProofRequired: false,
  };
}

async function requireSessionProof(body: RefereeRequest, fingerprint: RequestFingerprint): Promise<SessionContext> {
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
  const sessionProof = typeof body.sessionProof === "string" ? body.sessionProof : null;
  let row: SessionSecurityRow | null = null;
  let expectedProofHash: string | null = null;
  let walletAddress: string | null = null;
  let riskScore = 0;

  if (sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    const { data, error } = await admin
      .from("pvp_sessions")
      .select("id, session_proof_hash, expires_at, disabled_at, disabled_reason, wallet_address, risk_score")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) throw error;
    row = data as SessionSecurityRow | null;
    walletAddress = (data as { wallet_address?: string | null } | null)?.wallet_address ?? null;
    riskScore = Number((data as { risk_score?: number | string | null } | null)?.risk_score ?? 0);
  }

  if (sessionId && sessionProof) {
    expectedProofHash = await hashSessionProof(sessionId, sessionProof, sha256Hex);
  }

  const validation = validateSessionRecord({
    sessionId,
    sessionProof,
    expectedProofHash,
    row,
    nowMs: Date.now(),
    timingSafeEqual,
  });

  if (!validation.ok) {
    await logAbuseEvent({
      sessionId,
      gameId: body.gameId ?? null,
      walletAddress: typeof body.walletAddress === "string" ? body.walletAddress : null,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
      action: body.action ?? "unknown",
      eventType: "invalid_session_proof",
      severity: "warning",
      evidence: {
        reason: validation.reason,
        hasSessionId: typeof body.sessionId === "string",
        hasSessionProof: typeof body.sessionProof === "string",
      },
    });
    throw new HttpError(403, "Invalid session proof", validation.reason);
  }

  const requestWalletAddress = typeof body.walletAddress === "string" && body.walletAddress.trim()
    ? normalizeWalletAddress(body.walletAddress)
    : null;
  const update: Record<string, unknown> = {
    last_seen_at: nowIso(),
  };
  if (requestWalletAddress && !walletAddress) update.wallet_address = requestWalletAddress;

  const { error: updateError } = await admin
    .from("pvp_sessions")
    .update(update)
    .eq("id", sessionId);

  if (updateError) throw updateError;

  return {
    sessionId: sessionId as string,
    ipHash: fingerprint.ipHash,
    userAgentHash: fingerprint.userAgentHash,
    walletAddress: requestWalletAddress ?? walletAddress,
    riskLevel: riskScore >= 80 ? "high" : riskScore >= 40 ? "medium" : "low",
  };
}

async function markRefundRetryable(row: PvpGameRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Refund verification failed";
  const nextRetryCount = Number(row.refund_retry_count ?? 0) + 1;
  const suspicious = buildSuspiciousUpdate(row, { refundRetryCount: nextRetryCount });
  await admin
    .from("pvp_games")
    .update({
      refund_status: "refund_retryable",
      refund_error: message,
      refund_retryable_at: nowIso(),
      refund_retry_count: nextRetryCount,
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: nowIso(),
    })
    .eq("id", row.id)
    .neq("payment_status", "settled");
  if (suspicious) {
    await logAbuseEvent({
      gameId: row.id,
      action: "request_wager_refund",
      eventType: "refund_retry_abuse",
      severity: "warning",
      evidence: { retryCount: nextRetryCount, error: message },
    });
  }
}

async function markSettlementRetryable(row: PvpGameRow, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Settlement verification failed";
  const nextRetryCount = Number(row.settlement_retry_count ?? 0) + 1;
  const suspicious = buildSuspiciousUpdate(row, { settlementRetryCount: nextRetryCount });
  await admin
    .from("pvp_games")
    .update({
      settlement_status: "failed",
      settlement_last_error: message,
      settlement_attempted_at: nowIso(),
      settlement_retry_count: nextRetryCount,
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: nowIso(),
    })
    .eq("id", row.id)
    .neq("payment_status", "settled");
  if (suspicious) {
    await logAbuseEvent({
      gameId: row.id,
      action: "settle_finished_wager",
      eventType: "settlement_retry_abuse",
      severity: "warning",
      evidence: { retryCount: nextRetryCount, error: message },
    });
  }
}

async function requireServiceAction(body: RefereeRequest): Promise<void> {
  const expectedHash = Deno.env.get("PVP_REFEREE_SERVICE_TOKEN_SHA256");
  if (!expectedHash) throw new HttpError(503, "Service settlement token is not configured");
  const serviceToken = requireString(body.serviceToken, "serviceToken");
  const serviceHash = await sha256Hex(serviceToken);
  if (!timingSafeEqual(expectedHash, serviceHash)) {
    throw new HttpError(403, "Invalid service settlement token");
  }
}

interface EscrowVerifierConfig {
  connection: Connection;
  programId: PublicKey;
  gameId: string;
}

interface DecodedContestAccount {
  gameConfig: PublicKey;
  contestId: string;
  mint: PublicKey;
  vault: PublicKey;
  stakeAmount: bigint;
  creator: PublicKey;
  joiner: PublicKey;
  resultAuthority: PublicKey;
  winner: PublicKey;
  rulesHash: string;
  resultHash: string;
  expiresAt: bigint;
  createdAt: bigint;
  settledAt: bigint;
  state: number;
}

interface DecodedNativeContestAccount {
  assetKind: number;
  gameConfig: PublicKey;
  contestId: string;
  stakeAmount: bigint;
  creator: PublicKey;
  joiner: PublicKey;
  rentPayer: PublicKey;
  rentRecipient: PublicKey;
  resultAuthority: PublicKey;
  winner: PublicKey;
  rulesHash: string;
  resultHash: string;
  expiresAt: bigint;
  createdAt: bigint;
  settledAt: bigint;
  platformFeeBps: number;
  state: number;
}

let verifierConfigCache: EscrowVerifierConfig | null = null;

function verifierConfig(): EscrowVerifierConfig {
  if (verifierConfigCache) return verifierConfigCache;

  const cluster = optionalEnv("PVP_WAGER_SOLANA_CLUSTER") ?? optionalEnv("WAGER_SOLANA_CLUSTER") ?? "mainnet-beta";
  if (cluster !== "mainnet-beta") {
    throw new HttpError(503, "Wager escrow verification requires mainnet-beta configuration");
  }

  const programId = optionalEnv("PVP_WAGER_ESCROW_PROGRAM_ID") ?? optionalEnv("WAGER_ESCROW_PROGRAM_ID");
  if (!programId) throw new HttpError(503, "Wager escrow program id is not configured");

  verifierConfigCache = {
    connection: new Connection(
      optionalEnv("PVP_WAGER_SOLANA_RPC_URL") ?? optionalEnv("WAGER_SOLANA_RPC_URL") ?? defaultMainnetRpcUrl,
      "confirmed",
    ),
    programId: publicKey(programId, "wager escrow program id"),
    gameId: optionalEnv("PVP_WAGER_GAME_ID") ?? optionalEnv("WAGER_GAME_ID") ?? defaultGameId,
  };
  return verifierConfigCache;
}

function publicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new HttpError(503, `Invalid ${label}`);
  }
}

function seed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function seedHash(value: string): Uint8Array {
  return sha256Bytes(seed(value));
}

function derivePda(programId: PublicKey, seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function deriveEscrowPdas(config: EscrowVerifierConfig, contestId: string, mint: PublicKey) {
  const globalConfig = derivePda(config.programId, [seed("global_config")]);
  const gameConfig = derivePda(config.programId, [seed("game"), seedHash(config.gameId)]);
  const contest = derivePda(config.programId, [seed("contest"), gameConfig.toBytes(), seedHash(contestId)]);
  const contestVault = derivePda(config.programId, [seed("contest_vault"), contest.toBytes(), mint.toBytes()]);
  const vaultAuthority = derivePda(config.programId, [seed("vault_authority"), contest.toBytes()]);
  return { globalConfig, gameConfig, contest, contestVault, vaultAuthority };
}

function deriveNativeEscrowPdas(config: EscrowVerifierConfig, contestId: string) {
  const globalConfig = derivePda(config.programId, [seed("global_config")]);
  const gameConfig = derivePda(config.programId, [seed("game"), seedHash(config.gameId)]);
  const nativeContest = derivePda(config.programId, [seed("native_contest"), gameConfig.toBytes(), seedHash(contestId)]);
  return { globalConfig, gameConfig, nativeContest };
}

function readU32(data: Uint8Array, offset: { value: number }): number {
  const view = new DataView(data.buffer, data.byteOffset + offset.value, 4);
  offset.value += 4;
  return view.getUint32(0, true);
}

function readU64(data: Uint8Array, offset: { value: number }): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset.value, 8);
  offset.value += 8;
  return view.getBigUint64(0, true);
}

function readU16(data: Uint8Array, offset: { value: number }): number {
  const view = new DataView(data.buffer, data.byteOffset + offset.value, 2);
  offset.value += 2;
  return view.getUint16(0, true);
}

function readI64(data: Uint8Array, offset: { value: number }): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset.value, 8);
  offset.value += 8;
  return view.getBigInt64(0, true);
}

function readByte(data: Uint8Array, offset: { value: number }): number {
  const value = data[offset.value];
  offset.value += 1;
  return value ?? 0;
}

function readPubkey(data: Uint8Array, offset: { value: number }): PublicKey {
  const key = new PublicKey(data.subarray(offset.value, offset.value + 32));
  offset.value += 32;
  return key;
}

function readString(data: Uint8Array, offset: { value: number }): string {
  const length = readU32(data, offset);
  const end = offset.value + length;
  if (end > data.length) throw new HttpError(409, "Escrow contest account is malformed");
  const value = new TextDecoder().decode(data.subarray(offset.value, end));
  offset.value = end;
  return value;
}

function decodeContestAccount(data: Uint8Array): DecodedContestAccount {
  if (data.length < contestAccountDiscriminator.length) {
    throw new HttpError(409, "Escrow contest account is malformed");
  }
  for (let index = 0; index < contestAccountDiscriminator.length; index += 1) {
    if (data[index] !== contestAccountDiscriminator[index]) {
      throw new HttpError(409, "Escrow contest account has the wrong discriminator");
    }
  }

  const offset = { value: 8 };
  return {
    gameConfig: readPubkey(data, offset),
    contestId: readString(data, offset),
    mint: readPubkey(data, offset),
    vault: readPubkey(data, offset),
    stakeAmount: readU64(data, offset),
    creator: readPubkey(data, offset),
    joiner: readPubkey(data, offset),
    resultAuthority: readPubkey(data, offset),
    winner: readPubkey(data, offset),
    rulesHash: readString(data, offset),
    resultHash: readString(data, offset),
    expiresAt: readI64(data, offset),
    createdAt: readI64(data, offset),
    settledAt: readI64(data, offset),
    state: readByte(data, offset),
  };
}

function decodeNativeContestAccount(data: Uint8Array): DecodedNativeContestAccount {
  if (data.length < nativeContestAccountDiscriminator.length) {
    throw new HttpError(409, "Native escrow contest account is malformed");
  }
  for (let index = 0; index < nativeContestAccountDiscriminator.length; index += 1) {
    if (data[index] !== nativeContestAccountDiscriminator[index]) {
      throw new HttpError(409, "Native escrow contest account has the wrong discriminator");
    }
  }

  const offset = { value: 8 };
  return {
    assetKind: readByte(data, offset),
    gameConfig: readPubkey(data, offset),
    contestId: readString(data, offset),
    stakeAmount: readU64(data, offset),
    creator: readPubkey(data, offset),
    joiner: readPubkey(data, offset),
    rentPayer: readPubkey(data, offset),
    rentRecipient: readPubkey(data, offset),
    resultAuthority: readPubkey(data, offset),
    winner: readPubkey(data, offset),
    rulesHash: readString(data, offset),
    resultHash: readString(data, offset),
    expiresAt: readI64(data, offset),
    createdAt: readI64(data, offset),
    settledAt: readI64(data, offset),
    platformFeeBps: readU16(data, offset),
    state: readByte(data, offset),
  };
}

function signerAndAccountKeys(tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>) {
  const signerKeys = new Set<string>();
  const accountKeys = new Set<string>();
  for (const account of tx?.transaction.message.accountKeys ?? []) {
    const pubkeyValue = "pubkey" in account ? account.pubkey.toBase58() : String(account);
    accountKeys.add(pubkeyValue);
    if ("signer" in account && account.signer) signerKeys.add(pubkeyValue);
  }
  return { signerKeys, accountKeys };
}

async function requireConfirmedTransaction(
  connection: Connection,
  signature: string,
  requiredAccounts: string[],
  requiredSigner?: string | string[],
): Promise<void> {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) throw new HttpError(409, "Escrow transaction is not confirmed or no longer available");
  if (tx.meta?.err) throw new HttpError(409, "Escrow transaction failed on chain");

  const { signerKeys, accountKeys } = signerAndAccountKeys(tx);
  for (const required of requiredAccounts) {
    if (!accountKeys.has(required)) throw new HttpError(409, "Escrow transaction does not touch the expected account");
  }
  const requiredSigners = Array.isArray(requiredSigner)
    ? requiredSigner
    : requiredSigner
      ? [requiredSigner]
      : [];
  for (const signer of requiredSigners) {
    if (!signerKeys.has(signer)) {
      throw new HttpError(409, "Escrow transaction was not signed by the expected authority");
    }
  }
}

async function fetchContestAccount(
  connection: Connection,
  programId: PublicKey,
  contest: PublicKey,
): Promise<DecodedContestAccount> {
  const account = await connection.getAccountInfo(contest, "confirmed");
  if (!account) throw new HttpError(409, "Escrow contest account was not created");
  if (!account.owner.equals(programId)) throw new HttpError(409, "Escrow contest account has the wrong owner");
  return decodeContestAccount(account.data);
}

async function fetchNativeContestAccount(
  connection: Connection,
  programId: PublicKey,
  nativeContest: PublicKey,
): Promise<DecodedNativeContestAccount | null> {
  const account = await connection.getAccountInfo(nativeContest, "confirmed");
  if (!account) return null;
  if (!account.owner.equals(programId)) throw new HttpError(409, "Native escrow contest account has the wrong owner");
  return decodeNativeContestAccount(account.data);
}

async function maybeEscrowSnapshot(row: PvpGameRow): Promise<{
  contest: DecodedContestAccount;
  contestAddress: PublicKey;
  vaultAddress: PublicKey;
  vaultAmount: bigint;
} | null> {
  try {
    const config = verifierConfig();
    const assetMint = publicKey(requireString(row.wager_asset_mint, "wager_asset_mint"), "wager asset mint");
    const escrowContestId = requireString(row.escrow_contest_id, "escrow_contest_id");
    const derived = deriveEscrowPdas(config, escrowContestId, assetMint);
    const contest = await fetchContestAccount(config.connection, config.programId, derived.contest);
    assertBaseContestState(
      row,
      contest,
      derived,
      assetMint,
      BigInt(normalizeRawAmount(row.wager_stake_raw)),
      escrowContestId,
    );

    let vaultAmount = 0n;
    try {
      const balance = await config.connection.getTokenAccountBalance(derived.contestVault, "confirmed");
      vaultAmount = BigInt(balance.value.amount);
    } catch {
      vaultAmount = 0n;
    }

    return {
      contest,
      contestAddress: derived.contest,
      vaultAddress: derived.contestVault,
      vaultAmount,
    };
  } catch {
    return null;
  }
}

async function assertVaultBalance(
  connection: Connection,
  vault: PublicKey,
  minimumAmount: bigint,
): Promise<void> {
  const balance = await connection.getTokenAccountBalance(vault, "confirmed");
  if (BigInt(balance.value.amount) < minimumAmount) {
    throw new HttpError(409, "Escrow vault balance is lower than expected");
  }
}

function expectedWinner(row: PvpGameRow): PublicKey {
  if (row.winner === "w") return publicKey(requireString(row.white_wallet_address, "white_wallet_address"), "winner wallet");
  if (row.winner === "b") return publicKey(requireString(row.black_wallet_address, "black_wallet_address"), "winner wallet");
  return publicKey(defaultPubkey, "draw winner");
}

function assertContestExpiryWindow(row: PvpGameRow, expiresAt: bigint, label: string): void {
  const referenceMs = Date.parse(row.created_at ?? row.updated_at ?? "");
  if (!Number.isFinite(referenceMs)) return;
  const ttlSeconds = numberEnv("PVP_WAGER_CONTEST_TTL_SECONDS", 10 * 60);
  const graceSeconds = numberEnv("PVP_WAGER_CONTEST_TTL_GRACE_SECONDS", 5 * 60);
  const maxExpiresAt = BigInt(Math.floor(referenceMs / 1000) + ttlSeconds + graceSeconds);
  if (expiresAt > maxExpiresAt) {
    throw new HttpError(409, `${label} expiry exceeds the configured wager TTL`);
  }
}

function assertBaseContestState(
  row: PvpGameRow,
  decoded: DecodedContestAccount,
  derived: ReturnType<typeof deriveEscrowPdas>,
  assetMint: PublicKey,
  stakeRaw: bigint,
  escrowContestId: string,
): void {
  if (!decoded.gameConfig.equals(derived.gameConfig)) throw new HttpError(409, "Escrow game config mismatch");
  if (decoded.contestId !== escrowContestId) throw new HttpError(409, "Escrow contest id mismatch");
  if (!decoded.mint.equals(assetMint)) throw new HttpError(409, "Escrow mint mismatch");
  if (!decoded.vault.equals(derived.contestVault)) throw new HttpError(409, "Escrow vault mismatch");
  if (decoded.stakeAmount !== stakeRaw) throw new HttpError(409, "Escrow stake mismatch");
  if (!decoded.creator.equals(publicKey(requireString(row.white_wallet_address, "white_wallet_address"), "white wallet"))) {
    throw new HttpError(409, "Escrow creator mismatch");
  }
  assertContestExpiryWindow(row, decoded.expiresAt, "Escrow");
}

async function verifyEscrowTransition(
  kind:
    | "white_deposit"
    | "black_deposit"
    | "white_refund"
    | "settle_finished",
  row: PvpGameRow,
  body: RefereeRequest,
): Promise<string> {
  const mockVerification = boolEnv("PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION");
  const maybeSignature = optionalTxSignature(body);

  if (mockVerification && maybeSignature?.startsWith(`mock-${kind}-`)) {
    return maybeSignature;
  }

  const signature = requireTxSignature(body, rowPaymentMode(row));

  if (rowPaymentMode(row) === "robinhood_eth_escrow") {
    const winnerWallet = row.winner === "w"
      ? row.white_wallet_address
      : row.winner === "b"
        ? row.black_wallet_address
        : null;
    try {
      return await verifyRobinhoodTransition(kind, signature, {
        contestId: requireString(row.escrow_contest_id, "escrow_contest_id"),
        escrowAddress: row.robinhood_escrow_address,
        payoutMode: row.payout_mode,
        whiteMinimumRblx: row.white_minimum_rblx,
        blackMinimumRblx: row.black_minimum_rblx,
        stakeRaw: normalizeRawAmount(row.wager_stake_raw),
        whiteWallet: requireString(row.white_wallet_address, "white_wallet_address"),
        blackWallet: row.black_wallet_address,
        winnerWallet,
        resultHash: row.referee_result_hash,
        requiredLifetimeSeconds: requiredEscrowLifetimeSeconds(
          Number(row.clock_initial_ms), Number(row.clock_increment_ms), numberEnv("PVP_MAX_PLIES", 300),
        ),
      });
    } catch (error) {
      throw new HttpError(409, error instanceof Error ? error.message : "Robinhood Chain escrow verification failed");
    }
  }

  const config = verifierConfig();
  const assetMint = publicKey(requireString(row.wager_asset_mint, "wager_asset_mint"), "wager asset mint");
  const stakeRaw = BigInt(normalizeRawAmount(row.wager_stake_raw));
  const escrowContestId = requireString(row.escrow_contest_id, "escrow_contest_id");
  const derived = deriveEscrowPdas(config, escrowContestId, assetMint);
  const actor = kind === "black_deposit"
    ? requireString(row.black_wallet_address, "black_wallet_address")
    : kind === "settle_finished"
      ? undefined
      : kind === "white_refund"
        ? normalizeWalletAddress(body.walletAddress)
        : requireString(row.white_wallet_address, "white_wallet_address");

  await requireConfirmedTransaction(
    config.connection,
    signature,
    [config.programId.toBase58(), derived.contest.toBase58()],
    actor,
  );

  const contest = await fetchContestAccount(config.connection, config.programId, derived.contest);
  assertBaseContestState(row, contest, derived, assetMint, stakeRaw, escrowContestId);

  if (kind === "white_deposit") {
    if (contest.state !== 0) throw new HttpError(409, "Escrow is not in created state after white deposit");
    if (!contest.joiner.equals(publicKey(defaultPubkey, "empty joiner"))) throw new HttpError(409, "Escrow joiner is already set");
    await assertVaultBalance(config.connection, derived.contestVault, stakeRaw);
    return signature;
  }

  if (kind === "black_deposit") {
    if (contest.state !== 1) throw new HttpError(409, "Escrow is not active after black deposit");
    if (!contest.joiner.equals(publicKey(requireString(row.black_wallet_address, "black_wallet_address"), "black wallet"))) {
      throw new HttpError(409, "Escrow joiner mismatch");
    }
    await assertVaultBalance(config.connection, derived.contestVault, stakeRaw * 2n);
    return signature;
  }

  if (kind === "white_refund") {
    if (contest.state !== 2 && contest.state !== 3) {
      throw new HttpError(409, "Escrow is not cancelled or expired after refund");
    }
    return signature;
  }

  if (contest.state !== 4) throw new HttpError(409, "Escrow is not settled");
  if (!contest.joiner.equals(publicKey(requireString(row.black_wallet_address, "black_wallet_address"), "black wallet"))) {
    throw new HttpError(409, "Escrow joiner mismatch");
  }
  if (!contest.winner.equals(expectedWinner(row))) throw new HttpError(409, "Escrow winner mismatch");
  if (!contest.resultHash) throw new HttpError(409, "Escrow result hash missing");
  if (contest.resultHash !== requireString(row.referee_result_hash, "referee_result_hash")) {
    throw new HttpError(409, "Escrow result hash does not match referee result");
  }

  await requireConfirmedTransaction(
    config.connection,
    signature,
    [config.programId.toBase58(), derived.contest.toBase58(), contest.resultAuthority.toBase58()],
    contest.resultAuthority.toBase58(),
  );
  return signature;
}

function assertNativeBaseContestState(
  row: PvpGameRow,
  decoded: DecodedNativeContestAccount,
  derived: ReturnType<typeof deriveNativeEscrowPdas>,
  stakeRaw: bigint,
  escrowContestId: string,
): void {
  if (decoded.assetKind !== 0) throw new HttpError(409, "Native escrow asset kind mismatch");
  if (!decoded.gameConfig.equals(derived.gameConfig)) throw new HttpError(409, "Native escrow game config mismatch");
  if (decoded.contestId !== escrowContestId) throw new HttpError(409, "Native escrow contest id mismatch");
  if (decoded.stakeAmount !== stakeRaw) throw new HttpError(409, "Native escrow stake mismatch");
  if (!decoded.creator.equals(publicKey(requireString(row.white_wallet_address, "white_wallet_address"), "white wallet"))) {
    throw new HttpError(409, "Native escrow creator mismatch");
  }
  if (!decoded.rentPayer.equals(publicKey(requireString(row.rent_sponsor_address, "rent_sponsor_address"), "rent sponsor"))) {
    throw new HttpError(409, "Native escrow rent sponsor mismatch");
  }
  if (!decoded.rentRecipient.equals(publicKey(requireString(row.rent_recipient_address, "rent_recipient_address"), "rent recipient"))) {
    throw new HttpError(409, "Native escrow rent recipient mismatch");
  }
  assertContestExpiryWindow(row, decoded.expiresAt, "Native escrow");
}

async function verifySponsoredNativeTransition(
  kind: "white_deposit" | "black_deposit" | "cancel_waiting",
  row: PvpGameRow,
  body: RefereeRequest,
): Promise<{ playerSignature: string; sponsorSignature: string }> {
  const maybePlayerSignature = optionalTxSignature(body);

  if (boolEnv("PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION")) {
    const expectedPrefix = `mock-sponsored-${kind}-`;
    const legacyPlayerPrefix = `mock-sponsored-${kind}-player-`;
    if (!maybePlayerSignature?.startsWith(expectedPrefix) && !maybePlayerSignature?.startsWith(legacyPlayerPrefix)) {
      throw new HttpError(409, "Sponsored player transaction signature is not verifiable");
    }
    return { playerSignature: maybePlayerSignature, sponsorSignature: maybePlayerSignature };
  }

  const signature = requireTxSignature(body);
  const config = verifierConfig();
  const terms = requestSponsoredWagerTerms(body, row);
  assertSponsoredWagerTerms(row, terms);
  const derived = deriveNativeEscrowPdas(config, terms.escrowContestId);
  const wallet = normalizeWalletAddress(body.walletAddress);

  await requireConfirmedTransaction(
    config.connection,
    signature,
    [config.programId.toBase58(), derived.gameConfig.toBase58(), derived.nativeContest.toBase58(), wallet, terms.rentSponsorAddress],
    [wallet, terms.rentSponsorAddress],
  );

  if (kind === "cancel_waiting") {
    const cancelledContest = await fetchNativeContestAccount(config.connection, config.programId, derived.nativeContest);
    if (cancelledContest) throw new HttpError(409, "Native sponsored contest account is still open after cancel");
    return { playerSignature: signature, sponsorSignature: signature };
  }

  const contest = await fetchNativeContestAccount(config.connection, config.programId, derived.nativeContest);
  if (!contest) throw new HttpError(409, "Native sponsored contest account was not created");
  const stakeRaw = BigInt(terms.stakeRaw);
  assertNativeBaseContestState(row, contest, derived, stakeRaw, terms.escrowContestId);

  if (kind === "white_deposit") {
    if (contest.state !== 0) throw new HttpError(409, "Native escrow is not in created state after white deposit");
    if (!contest.joiner.equals(publicKey(defaultPubkey, "empty joiner"))) throw new HttpError(409, "Native escrow joiner is already set");
    return { playerSignature: signature, sponsorSignature: signature };
  }

  if (contest.state !== 1) throw new HttpError(409, "Native escrow is not active after black deposit");
  if (!contest.joiner.equals(publicKey(requireString(row.black_wallet_address, "black_wallet_address"), "black wallet"))) {
    throw new HttpError(409, "Native escrow joiner mismatch");
  }
  return { playerSignature: signature, sponsorSignature: signature };
}

function resultAuthorityFromEnv(): string {
  const authority = optionalEnv("PVP_WAGER_RESULT_AUTHORITY") ?? optionalEnv("PVP_WAGER_RESULT_SIGNER_ADDRESS");
  if (!authority) throw new HttpError(503, "Wager result authority is not configured");
  return publicKey(authority, "wager result authority").toBase58();
}

function deriveNativeContestAddress(terms: { escrowContestId: string }): {
  config: EscrowVerifierConfig;
  nativeContest: PublicKey;
  gameConfig: PublicKey;
} {
  const config = verifierConfig();
  const derived = deriveNativeEscrowPdas(config, terms.escrowContestId);
  return { config, nativeContest: derived.nativeContest, gameConfig: derived.gameConfig };
}

async function verifyNativeSponsoredSettlement(row: PvpGameRow, body: RefereeRequest): Promise<string> {
  const mockVerification = boolEnv("PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION");
  const maybeSignature = optionalTxSignature(body);
  if (mockVerification && maybeSignature?.startsWith("mock-native-settle-") && body.contestClosed === true) {
    return maybeSignature;
  }

  const signature = requireTxSignature(body);
  const terms = requestWagerTerms(body, row);
  const { config, nativeContest, gameConfig } = deriveNativeContestAddress(terms);
  const resultAuthority = resultAuthorityFromEnv();

  await requireConfirmedTransaction(
    config.connection,
    signature,
    [config.programId.toBase58(), gameConfig.toBase58(), nativeContest.toBase58()],
    resultAuthority,
  );

  const account = await config.connection.getAccountInfo(nativeContest, "confirmed");
  if (account) throw new HttpError(409, "Native sponsored contest account is still open");
  return signature;
}

async function verifyNativeSponsoredRentReclaim(row: PvpGameRow, body: RefereeRequest): Promise<void> {
  const mockVerification = boolEnv("PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION");
  if (mockVerification && body.contestClosed === true) return;

  const terms = requestWagerTerms(body, row);
  const { config, nativeContest } = deriveNativeContestAddress(terms);
  const account = await config.connection.getAccountInfo(nativeContest, "confirmed");
  if (body.contestClosed && account) throw new HttpError(409, "Native sponsored contest account is still open");
  if (!body.contestClosed && !account) throw new HttpError(409, "Native sponsored contest account is already closed");

  const signature = optionalTxSignature(body);
  if (!signature) return;

  await requireConfirmedTransaction(
    config.connection,
    signature,
    [config.programId.toBase58(), nativeContest.toBase58()],
    undefined,
  );
}

function wsolRentRecipient(row: PvpGameRow, body: RefereeRequest): string {
  const expected = publicKey(requireString(row.white_wallet_address, "white_wallet_address"), "wSOL rent recipient").toBase58();
  if (typeof body.rentRecipientAddress === "string" && body.rentRecipientAddress.trim()) {
    const requested = publicKey(body.rentRecipientAddress, "rentRecipientAddress").toBase58();
    if (requested !== expected) throw new HttpError(409, "Wager rent recipient mismatch");
  }
  return expected;
}

async function verifyWsolContestRentReclaim(row: PvpGameRow, body: RefereeRequest): Promise<void> {
  const mockVerification = boolEnv("PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION");
  if (mockVerification && body.contestClosed === true && body.vaultClosed !== false) return;

  const terms = requestWagerTerms(body, row);
  const config = verifierConfig();
  const assetMint = publicKey(terms.assetMint, "wager asset mint");
  const stakeRaw = BigInt(terms.stakeRaw);
  const derived = deriveEscrowPdas(config, terms.escrowContestId, assetMint);
  const rentRecipient = publicKey(wsolRentRecipient(row, body), "wSOL rent recipient");

  if (body.contestClosed === true) {
    const signature = requireTxSignature(body);
    await requireConfirmedTransaction(
      config.connection,
      signature,
      [
        config.programId.toBase58(),
        derived.contest.toBase58(),
        derived.contestVault.toBase58(),
        derived.vaultAuthority.toBase58(),
        assetMint.toBase58(),
        rentRecipient.toBase58(),
      ],
      undefined,
    );

    const [contestAccount, vaultAccount] = await Promise.all([
      config.connection.getAccountInfo(derived.contest, "confirmed"),
      config.connection.getAccountInfo(derived.contestVault, "confirmed"),
    ]);
    if (contestAccount) throw new HttpError(409, "wSOL contest account is still open");
    if (vaultAccount) throw new HttpError(409, "wSOL contest vault is still open");
    return;
  }

  const [contestAccount, vaultAccount] = await Promise.all([
    config.connection.getAccountInfo(derived.contest, "confirmed"),
    config.connection.getAccountInfo(derived.contestVault, "confirmed"),
  ]);
  if (!contestAccount || !vaultAccount) throw new HttpError(409, "wSOL escrow rent accounts are already closed");
  if (!contestAccount.owner.equals(config.programId)) throw new HttpError(409, "Escrow contest account has the wrong owner");

  const contest = decodeContestAccount(contestAccount.data);
  assertBaseContestState(row, contest, derived, assetMint, stakeRaw, terms.escrowContestId);
  if (contest.state !== 2 && contest.state !== 3 && contest.state !== 4) {
    throw new HttpError(409, "wSOL escrow is not in a terminal rent reclaim state");
  }
}

function timingSafeEqual(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function newPlayerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "23505");
}

function cpuLeaderboardLimit(value: unknown): number {
  if (value == null) return 25;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

async function handleSubmitCpuResult(body: RefereeRequest, session: SessionContext) {
  const requestId = validateRequestId(body.requestId);
  if (!requestId) throw new HttpError(400, "Missing requestId");

  const result = validateCpuMatchResult({
    playerName: body.playerName,
    difficulty: body.difficulty,
    cpuCharacter: body.cpuCharacter,
    moves: body.moves,
  });
  // Browser-owned CPU histories cannot attest difficulty or CPU participation.
  // They may record practice points, but must never enqueue token transfers.
  const payoutWalletAddress = null;
  const finishedAt = nowIso();
  const resultHash = await sha256Hex(JSON.stringify({
    difficulty: result.difficulty,
    cpuCharacter: result.cpuCharacter,
    moves: result.moves,
  }));

  const { error } = await admin
    .from("cpu_match_results")
    .insert({
      session_id: session.sessionId,
      request_id: requestId,
      player_name: result.playerName,
      difficulty: result.difficulty,
      cpu_character: result.cpuCharacter,
      points: result.points,
      payout_wallet_address: payoutWalletAddress,
      payout_token_mint: CPU_REWARD_TOKEN_MINT,
      payout_token_program_id: CPU_REWARD_TOKEN_PROGRAM_ID,
      payout_amount_raw: "0",
      payout_status: "not_applicable",
      moves: result.moves,
      ply_count: result.plyCount,
      result_hash: resultHash,
      finished_at: finishedAt,
      updated_at: finishedAt,
    });

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: true,
        accepted: false,
        duplicate: true,
        points: result.points,
        payoutQueued: false,
      };
    }
    throw error;
  }

  return {
    ok: true,
    accepted: true,
    duplicate: false,
    points: result.points,
    payoutQueued: Boolean(payoutWalletAddress),
  };
}

async function handleListCpuLeaderboard(body: RefereeRequest) {
  const limit = cpuLeaderboardLimit(body.limit);
  const { data, error } = await admin
    .from("cpu_leaderboard")
    .select("rank, player_name, score, wins, easy_wins, medium_wins, hard_wins, last_win_at")
    .order("score", { ascending: false })
    .order("wins", { ascending: false })
    .order("hard_wins", { ascending: false })
    .order("last_win_at", { ascending: false })
    .order("player_name", { ascending: true })
    .limit(limit);

  if (error) throw error;

  const entries = rankCpuLeaderboardEntries((data ?? []).map((row) => ({
    playerName: String(row.player_name),
    score: Number(row.score ?? 0),
    wins: Number(row.wins ?? 0),
    easyWins: Number(row.easy_wins ?? 0),
    mediumWins: Number(row.medium_wins ?? 0),
    hardWins: Number(row.hard_wins ?? 0),
    lastWinAt: String(row.last_win_at ?? ""),
  })));

  return {
    ok: true,
    entries,
  };
}

function walletProofTtlMs(): number {
  return numberEnv("PVP_WALLET_PROOF_TTL_MS", 5 * 60 * 1000);
}

async function handleCreateWalletProofChallenge(body: RefereeRequest) {
  const requestedAction = requireString(body.proofAction, "proofAction");
  if (!walletProofActions.has(requestedAction)) {
    throw new HttpError(400, "Unsupported wallet proof action");
  }
  const sessionId = requireString(body.sessionId, "sessionId");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const gameId = typeof body.gameId === "string" && body.gameId.trim() ? body.gameId.trim() : null;
  const nonce = randomSecretHex(24);
  const expiresAt = new Date(Date.now() + walletProofTtlMs()).toISOString();
  const challenge = createWalletProofChallenge({
    action: requestedAction,
    sessionId,
    gameId,
    nonce,
    expiresAt,
  });

  const { error } = await admin
    .from("pvp_wallet_proof_nonces")
    .insert({
      nonce_hash: await sha256Hex(nonce),
      wallet_address: walletAddress,
      action: requestedAction,
      session_id: sessionId,
      game_id: gameId,
      expires_at: expiresAt,
    });

  if (error) throw error;

  return { walletProof: challenge };
}

async function consumeWalletProofNonce(body: RefereeRequest, proofAction: string, gameId: string | null): Promise<string> {
  const sessionId = requireString(body.sessionId, "sessionId");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const nonce = requireString(body.walletProofNonce, "walletProofNonce");
  const expiresAt = requireString(body.walletProofExpiresAt, "walletProofExpiresAt");
  const signature = requireString(body.walletSignature, "walletSignature");
  const nonceHash = await sha256Hex(nonce);
  const now = nowIso();

  const proofRequest: WalletProofRequest = {
    action: proofAction,
    sessionId,
    gameId,
    walletAddress,
    nonce,
    expiresAt,
    signature,
  };
  const ok = await verifyWalletProofWithNonceStore(proofRequest, {
    async consume() {
      let query = admin
        .from("pvp_wallet_proof_nonces")
        .update({ used_at: now })
        .eq("nonce_hash", nonceHash)
        .eq("wallet_address", walletAddress)
        .eq("action", proofAction)
        .eq("session_id", sessionId)
        .eq("expires_at", expiresAt)
        .is("used_at", null)
        .gt("expires_at", now);

      if (gameId) {
        query = query.eq("game_id", gameId);
      } else {
        query = query.is("game_id", null);
      }

      const { data, error } = await query.select("nonce_hash").maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  if (!ok) throw new HttpError(403, "Wallet proof verification failed", "wallet_proof_failed");
  return walletAddress;
}

async function requireWalletProof(body: RefereeRequest, proofAction: string, gameId: string | null = null): Promise<string> {
  if (proofAction.startsWith("prepare_") && !wagerPilotAllowsWallet(Deno.env.get("PVP_WAGER_PILOT_ENABLED"), Deno.env.get("PVP_WAGER_PILOT_WALLETS"), String(body.walletAddress || ""), Deno.env.get("PVP_WAGER_PILOT_EXPIRES_AT"))) {
    throw new HttpError(403, "Wager testing is restricted to the project wallets", "wager_pilot_only");
  }
  if (!body.walletProofNonce || !body.walletProofExpiresAt || !body.walletSignature) {
    throw new HttpError(403, "Wallet proof required", "wallet_proof_required");
  }
  return consumeWalletProofNonce(body, proofAction, gameId);
}

async function requirePracticeQueueFriction(body: RefereeRequest): Promise<void> {
  if (!practiceCaptchaRequired(Deno.env)) return;
  const provider = captchaProviderFromEnv(Deno.env);
  if (provider.available) {
    try {
      await verifyCaptchaOrThrow(provider, body.captchaToken, {
        action: "join_queue",
        sessionId: body.sessionId,
        walletAddress: body.walletAddress,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "CAPTCHA verification failed";
      throw new HttpError(
        message === "CAPTCHA required" ? 403 : 401,
        message,
        message === "CAPTCHA required" ? "captcha_required" : "captcha_failed",
      );
    }
    return;
  }

  await requireWalletProof(body, "join_queue", null);
}

interface IdempotentMove {
  requestId: string;
  complete(payload: Record<string, unknown>): Promise<void>;
  abandon(): Promise<void>;
}

interface IdempotentRequest {
  requestId: string;
  complete(payload: Record<string, unknown>): Promise<void>;
  abandon(): Promise<void>;
}

async function beginIdempotentRequest(
  body: RefereeRequest,
  action: RefereeSecurityAction,
  gameId: string | null,
): Promise<IdempotentRequest | { duplicate: true; payload: unknown } | null> {
  const requestId = validateRequestId(body.requestId);
  if (!requestId) return null;
  const sessionId = requireString(body.sessionId, "sessionId");

  const { data: inserted, error: insertError } = await admin
    .from("pvp_request_ids")
    .insert({
      session_id: sessionId,
      action,
      request_id: requestId,
      game_id: gameId,
    })
    .select("response_payload")
    .maybeSingle();

  if (!insertError && inserted) {
    return {
      requestId,
      complete: async (payload: Record<string, unknown>) => {
        await admin
          .from("pvp_request_ids")
          .update({
            response_hash: await sha256Hex(JSON.stringify(payload)),
            response_payload: payload,
          })
          .eq("session_id", sessionId)
          .eq("action", action)
          .eq("request_id", requestId);
      },
      abandon: async () => {
        await admin
          .from("pvp_request_ids")
          .delete()
          .eq("session_id", sessionId)
          .eq("action", action)
          .eq("request_id", requestId)
          .is("response_payload", null);
      },
    };
  }

  if (!insertError || insertError.code === "23505") {
    const { data, error } = await admin
      .from("pvp_request_ids")
      .select("response_payload")
      .eq("session_id", sessionId)
      .eq("action", action)
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (data?.response_payload) return { duplicate: true, payload: data.response_payload };
    throw new HttpError(409, "Request is already being processed");
  }

  throw insertError;
}

async function beginMoveIdempotency(body: RefereeRequest, gameId: string): Promise<IdempotentMove | { duplicate: true; payload: unknown } | null> {
  const requestId = validateRequestId(body.requestId);
  if (!requestId) return null;
  const sessionId = requireString(body.sessionId, "sessionId");

  const { data: inserted, error: insertError } = await admin
    .from("pvp_request_ids")
    .insert({
      session_id: sessionId,
      action: "move",
      request_id: requestId,
      game_id: gameId,
    })
    .select("response_payload")
    .maybeSingle();

  if (!insertError && inserted) {
    return {
      requestId,
      complete: async (payload: Record<string, unknown>) => {
        await admin
          .from("pvp_request_ids")
          .update({
            response_hash: await sha256Hex(JSON.stringify(payload)),
            response_payload: payload,
          })
          .eq("session_id", sessionId)
          .eq("action", "move")
          .eq("request_id", requestId);
      },
      abandon: async () => {
        await admin
          .from("pvp_request_ids")
          .delete()
          .eq("session_id", sessionId)
          .eq("action", "move")
          .eq("request_id", requestId)
          .is("response_payload", null);
      },
    };
  }

  if (!insertError || insertError.code === "23505") {
    const { data, error } = await admin
      .from("pvp_request_ids")
      .select("response_payload")
      .eq("session_id", sessionId)
      .eq("action", "move")
      .eq("request_id", requestId)
      .maybeSingle();
    if (error) throw error;
    if (data?.response_payload) {
      return { duplicate: true, payload: data.response_payload };
    }
    throw new HttpError(409, "Request is already being processed");
  }

  throw insertError;
}

async function refereeResultHash(row: PvpGameRow, overrides: {
  moves?: string[];
  winner?: string | null;
  reason?: string | null;
} = {}): Promise<string> {
  return sha256Hex(JSON.stringify({
    gameId: row.id,
    moves: overrides.moves ?? row.moves ?? [],
    winner: overrides.winner ?? row.winner,
    reason: overrides.reason ?? row.result_reason ?? "chess_game_over",
    escrowContestId: row.escrow_contest_id ?? null,
  }));
}

async function tokenColor(row: PvpGameRow, playerToken: string): Promise<PlayerColor | null> {
  const tokenHash = await sha256Hex(playerToken);
  if (timingSafeEqual(row.white_player_token_hash, tokenHash)) return "w";
  if (timingSafeEqual(row.black_player_token_hash, tokenHash)) return "b";
  return null;
}

async function fetchGame(gameId: string): Promise<PvpGameRow> {
  const { data, error } = await admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("id", gameId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, "Game not found");
  return data as PvpGameRow;
}

async function handleGetGame(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);
  if (!color) throw new HttpError(403, "Invalid player token");
  return { ok: true, game: publicGame(row) };
}

function seasonCutoffIso(): string {
  const days = numberEnv("PVP_ABUSE_LOOKBACK_DAYS", 14);
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function countCancelledBySession(sessionId: string): Promise<number> {
  const { count, error } = await admin
    .from("pvp_games")
    .select("id", { count: "exact", head: true })
    .eq("white_session_id", sessionId)
    .eq("status", "cancelled")
    .gt("updated_at", seasonCutoffIso());
  if (error) throw error;
  return count ?? 0;
}

function sponsoredGuardLimits(): SponsoredWagerRiskLimits {
  return {
    maxOpenGlobal: numberEnv(
      "PVP_SPONSORED_MAX_OPEN_GLOBAL",
      defaultSponsoredWagerRiskLimits.maxOpenGlobal,
    ),
    maxOpenPerWallet: numberEnv(
      "PVP_SPONSORED_MAX_OPEN_PER_WALLET",
      defaultSponsoredWagerRiskLimits.maxOpenPerWallet,
    ),
    maxOpenPerSession: numberEnv(
      "PVP_SPONSORED_MAX_OPEN_PER_SESSION",
      defaultSponsoredWagerRiskLimits.maxOpenPerSession,
    ),
    maxOpenPerIpHash: numberEnv(
      "PVP_SPONSORED_MAX_OPEN_PER_IP_HASH",
      defaultSponsoredWagerRiskLimits.maxOpenPerIpHash,
    ),
    queueCancelChurnLimit: numberEnv(
      "PVP_SPONSORED_QUEUE_CANCEL_CHURN_LIMIT",
      defaultSponsoredWagerRiskLimits.queueCancelChurnLimit,
    ),
    minSponsorReserveLamports: bigintEnv(
      "PVP_SPONSORED_MIN_SPONSOR_RESERVE_LAMPORTS",
      defaultSponsoredWagerRiskLimits.minSponsorReserveLamports,
    ),
    estimatedRentLamportsPerContest: bigintEnv(
      "PVP_SPONSORED_ESTIMATED_RENT_LAMPORTS",
      defaultSponsoredWagerRiskLimits.estimatedRentLamportsPerContest,
    ),
  };
}

function sponsoredOpenQuery() {
  return admin
    .from("pvp_games")
    .select("id", { count: "exact", head: true })
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .in("status", ["waiting", "active"])
    .in("payment_status", [...fundedSponsoredWagerPaymentStatuses]);
}

async function nativeSponsoredContestExists(row: PvpGameRow): Promise<boolean> {
  const escrowContestId = row.escrow_contest_id;
  if (!escrowContestId) return false;
  const { config, nativeContest } = deriveNativeContestAddress({ escrowContestId });
  return !!await fetchNativeContestAccount(config.connection, config.programId, nativeContest);
}

async function expireStalePreparedSponsoredWagersForIdentity(
  sessionId: string,
  walletAddress: string,
): Promise<void> {
  const cutoff = queueCutoffIso();
  const { data, error } = await admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", preparedSponsoredWagerPaymentStatus)
    .eq("settlement_status", "none")
    .is("black_session_id", null)
    .is("white_deposit_signature", null)
    .is("white_sponsor_signature", null)
    .or(`white_session_id.eq.${sessionId},white_wallet_address.eq.${walletAddress}`)
    .lt("updated_at", cutoff)
    .limit(20);

  if (error) {
    console.warn("Failed to find stale prepared sponsored wagers", error);
    return;
  }

  for (const row of (data ?? []) as PvpGameRow[]) {
    let contestExists = true;
    try {
      contestExists = await nativeSponsoredContestExists(row);
    } catch (error) {
      console.warn("Could not verify stale sponsored wager on-chain state", { gameId: row.id, error });
    }
    if (contestExists) continue;

    const now = nowIso();
    let update = admin
      .from("pvp_games")
      .update({
        status: "cancelled",
        payment_status: "cancelled",
        refund_status: "none",
        refund_error: null,
        cancelled_at: now,
        clock_turn: null,
        clock_last_started_at: null,
        rent_reclaim_status: "not_applicable",
        rent_reclaim_signature: null,
        rent_reclaimed_at: null,
        escrow_onchain_state: "not_created",
        escrow_checked_at: now,
        updated_at: now,
      })
      .eq("id", row.id)
      .eq("status", "waiting")
      .eq("payment_mode", "native_sol_sponsored")
      .eq("wager_asset_kind", "native_sol")
      .eq("payment_status", preparedSponsoredWagerPaymentStatus)
      .eq("settlement_status", "none")
      .is("black_session_id", null)
      .is("white_deposit_signature", null)
      .is("white_sponsor_signature", null)
      .select("id");

    update = guardUpdatedAt(update, row);
    const { error: updateError } = await update.maybeSingle();
    if (updateError) {
      console.warn("Failed to expire stale prepared sponsored wager", { gameId: row.id, error: updateError });
    }
  }
}

async function reusePreparedSponsoredWagerForRetry(input: {
  sessionId: string;
  walletAddress: string;
  assetMint: string;
  stakeRaw: string;
  format: TimeControlFormat;
  rentSponsorAddress: string;
  rentRecipientAddress: string;
  playerTokenHash: string;
  sponsoredRequestId: string | null;
}): Promise<PvpGameRow | null> {
  const { data: existingRows, error: existingError } = await admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", preparedSponsoredWagerPaymentStatus)
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.assetMint)
    .eq("wager_stake_raw", input.stakeRaw)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .eq("rent_sponsor_address", input.rentSponsorAddress)
    .eq("rent_recipient_address", input.rentRecipientAddress)
    .eq("white_session_id", input.sessionId)
    .eq("white_wallet_address", input.walletAddress)
    .is("black_session_id", null)
    .is("white_deposit_signature", null)
    .is("white_sponsor_signature", null)
    .gt("updated_at", queueCutoffIso())
    .order("updated_at", { ascending: false })
    .limit(1);

  if (existingError) throw existingError;
  const existing = existingRows?.[0] as PvpGameRow | undefined;
  if (!existing) return null;

  let update = admin
    .from("pvp_games")
    .update({
      white_player_token_hash: input.playerTokenHash,
      sponsored_request_id: input.sponsoredRequestId,
      updated_at: nowIso(),
    })
    .eq("id", existing.id)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", preparedSponsoredWagerPaymentStatus)
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.assetMint)
    .eq("wager_stake_raw", input.stakeRaw)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .eq("rent_sponsor_address", input.rentSponsorAddress)
    .eq("rent_recipient_address", input.rentRecipientAddress)
    .eq("white_session_id", input.sessionId)
    .eq("white_wallet_address", input.walletAddress)
    .is("black_session_id", null)
    .is("white_deposit_signature", null)
    .is("white_sponsor_signature", null)
    .select(gameColumns);

  update = guardUpdatedAt(update, existing);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  return data ? data as PvpGameRow : null;
}

async function countOpenSponsoredWagersGlobal(): Promise<number> {
  const { count, error } = await sponsoredOpenQuery();
  if (error) throw error;
  return count ?? 0;
}

async function countOpenSponsoredWagersForWallet(walletAddress: string): Promise<number> {
  const { count, error } = await sponsoredOpenQuery()
    .or(`white_wallet_address.eq.${walletAddress},black_wallet_address.eq.${walletAddress}`);
  if (error) throw error;
  return count ?? 0;
}

async function countOpenSponsoredWagersForSession(sessionId: string): Promise<number> {
  const { count, error } = await sponsoredOpenQuery()
    .or(`white_session_id.eq.${sessionId},black_session_id.eq.${sessionId}`);
  if (error) throw error;
  return count ?? 0;
}

async function countOpenSponsoredWagersForIpHash(ipHash: string | null): Promise<number> {
  if (!ipHash) return 0;

  const { data: sessionRows, error: sessionError } = await admin
    .from("pvp_sessions")
    .select("id")
    .eq("ip_hash", ipHash)
    .gt("expires_at", nowIso())
    .limit(100);
  if (sessionError) throw sessionError;

  const sessionIds = (sessionRows ?? [])
    .map((row) => typeof row.id === "string" ? row.id : "")
    .filter((id) => id.length > 0);
  if (!sessionIds.length) return 0;

  const inList = sessionIds.join(",");
  const { count, error } = await sponsoredOpenQuery()
    .or(`white_session_id.in.(${inList}),black_session_id.in.(${inList})`);
  if (error) throw error;
  return count ?? 0;
}

function sponsoredCancelledQuery() {
  return admin
    .from("pvp_games")
    .select("id", { count: "exact", head: true })
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("status", "cancelled")
    .gt("updated_at", seasonCutoffIso());
}

async function countSponsoredQueueCancelsByWallet(walletAddress: string): Promise<number> {
  const { count, error } = await sponsoredCancelledQuery()
    .eq("white_wallet_address", walletAddress);
  if (error) throw error;
  return count ?? 0;
}

async function countSponsoredQueueCancelsBySession(sessionId: string): Promise<number> {
  const { count, error } = await sponsoredCancelledQuery()
    .eq("white_session_id", sessionId);
  if (error) throw error;
  return count ?? 0;
}

async function balanceLamports(address: string, label: string): Promise<bigint> {
  const balance = await verifierConfig().connection.getBalance(publicKey(address, label), "confirmed");
  return BigInt(balance);
}

function sponsoredGuardStatus(code?: string): number {
  if (
    code === "sponsored_wagers_paused" ||
    code === "sponsor_unavailable" ||
    code === "sponsor_treasury_low"
  ) {
    return 503;
  }
  if (code === "wallet_balance_below_stake") return 409;
  return 429;
}

async function enforceSponsoredWagerGuard(input: {
  session: SessionContext;
  fingerprint: RequestFingerprint;
  walletAddress: string;
  stakeRaw: string;
  rentSponsorAddress: string;
}): Promise<void> {
  let snapshot;

  try {
    const [
      sponsorTreasuryLamports,
      walletBalanceLamports,
      openSponsoredWagersGlobal,
      openSponsoredWagersForWallet,
      openSponsoredWagersForSession,
      openSponsoredWagersForIpHash,
      queueCancelCountForWallet,
      queueCancelCountForSession,
    ] = await Promise.all([
      balanceLamports(input.rentSponsorAddress, "rent sponsor address"),
      balanceLamports(input.walletAddress, "walletAddress"),
      countOpenSponsoredWagersGlobal(),
      countOpenSponsoredWagersForWallet(input.walletAddress),
      countOpenSponsoredWagersForSession(input.session.sessionId),
      countOpenSponsoredWagersForIpHash(input.fingerprint.ipHash),
      countSponsoredQueueCancelsByWallet(input.walletAddress),
      countSponsoredQueueCancelsBySession(input.session.sessionId),
    ]);

    snapshot = {
      enabled: sponsoredLaneEnabled(),
      signerAvailable: !boolEnv("PVP_WAGER_SPONSOR_UNAVAILABLE"),
      sponsorTreasuryLamports,
      walletBalanceLamports,
      stakeLamports: BigInt(input.stakeRaw),
      openSponsoredWagersGlobal,
      openSponsoredWagersForWallet,
      openSponsoredWagersForSession,
      openSponsoredWagersForIpHash,
      queueCancelCountForWallet,
      queueCancelCountForSession,
    };
  } catch (error) {
    console.error("Sponsored wager guard failed", error);
    throw new HttpError(503, "Sponsored wager risk check unavailable", "sponsored_guard_unavailable");
  }

  const result = evaluateSponsoredWagerGuard(snapshot, sponsoredGuardLimits());
  if (result.ok) return;

  await logAbuseEvent({
    sessionId: input.session.sessionId,
    walletAddress: input.walletAddress,
    ipHash: input.fingerprint.ipHash,
    userAgentHash: input.fingerprint.userAgentHash,
    action: "prepare_sponsored_wager",
    eventType: result.code ?? "sponsored_wager_guard_refused",
    severity: result.code === "wallet_balance_below_stake" ? "info" : "warning",
    evidence: {
      message: result.message,
      openSponsoredWagersGlobal: snapshot.openSponsoredWagersGlobal,
      openSponsoredWagersForWallet: snapshot.openSponsoredWagersForWallet,
      openSponsoredWagersForSession: snapshot.openSponsoredWagersForSession,
      openSponsoredWagersForIpHash: snapshot.openSponsoredWagersForIpHash,
      queueCancelCountForWallet: snapshot.queueCancelCountForWallet,
      queueCancelCountForSession: snapshot.queueCancelCountForSession,
    },
  });

  throw new HttpError(
    sponsoredGuardStatus(result.code),
    result.message ?? "Sponsored wager risk check failed",
    result.code,
  );
}

async function countResignationsBySession(color: PlayerColor, sessionId: string): Promise<number> {
  const sessionColumn = color === "w" ? "white_session_id" : "black_session_id";
  const { count, error } = await admin
    .from("pvp_games")
    .select("id", { count: "exact", head: true })
    .eq(sessionColumn, sessionId)
    .eq("status", "finished")
    .eq("result_reason", "resignation")
    .gt("updated_at", seasonCutoffIso());
  if (error) throw error;
  return count ?? 0;
}

async function countFinishedSameOpponentWins(row: PvpGameRow, winner: string | null, resultReason?: string | null): Promise<number> {
  if (!row.white_wallet_address || !row.black_wallet_address || !(winner === "w" || winner === "b")) return 0;
  const base = admin
    .from("pvp_games")
    .select("id,winner,result_reason", { count: "exact" })
    .eq("status", "finished")
    .eq("white_wallet_address", row.white_wallet_address)
    .eq("black_wallet_address", row.black_wallet_address)
    .eq("winner", winner)
    .gt("updated_at", seasonCutoffIso())
    .neq("id", row.id)
    .limit(50);

  const { data, error } = await base;
  if (error) throw error;
  const previous = data ?? [];
  return previous.filter((candidate) => !resultReason || candidate.result_reason === resultReason).length + 1;
}

type WsolQueueTerms = ReturnType<typeof configuredWagerTerms> & { escrowAddress?: string; payoutMode?: string; minimumRblxOut?: string };

async function claimFundedWsolWager(input: {
  sessionId: string;
  walletAddress: string;
  terms: WsolQueueTerms;
  format: TimeControlFormat;
  playerToken: string;
  playerTokenHash: string;
}) {
  const waitingQuery = guardWsolEscrowLane(admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("status", "waiting")
    .eq("payment_status", "white_deposited")
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.terms.assetMint)
    .eq("wager_stake_raw", input.terms.stakeRaw)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .is("black_session_id", null)
    .neq("white_session_id", input.sessionId)
    .neq("white_wallet_address", input.walletAddress)
    .gt("updated_at", queueCutoffIso())
    .order("created_at", { ascending: true })
    .limit(1));

  if (input.terms.paymentMode === "robinhood_eth_escrow") {
    waitingQuery.eq("payout_mode", input.terms.payoutMode ?? "eth_claim");
    if (input.terms.payoutMode === "automatic_rblx" && input.terms.escrowAddress) waitingQuery.eq("robinhood_escrow_address", input.terms.escrowAddress);
  }
  const { data: waitingRows, error: waitingError } = await waitingQuery;
  if (waitingError) throw waitingError;

  const waitingRow = waitingRows?.[0] as PvpGameRow | undefined;
  if (!waitingRow?.escrow_contest_id) return null;

  assertWsolEscrowLane(waitingRow);
  if (rowPaymentMode(waitingRow) === "robinhood_eth_escrow") {
    // Never reserve an opponent against a cancelled, joined or expiring escrow.
    await verifyEscrowTransition("white_deposit", waitingRow, {
      action: "confirm_white_deposit", transactionSignature: waitingRow.white_deposit_signature ?? undefined,
    });
  }
  let claim = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      black_session_id: input.sessionId,
      black_player_token_hash: input.playerTokenHash,
      black_wallet_address: input.walletAddress,
      ...(input.terms.payoutMode === "automatic_rblx" ? { black_minimum_rblx: input.terms.minimumRblxOut } : {}),
      payment_status: "black_prepared",
      updated_at: nowIso(),
    })
    .eq("id", waitingRow.id)
    .eq("status", "waiting")
    .eq("payment_status", "white_deposited")
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.terms.assetMint)
    .eq("wager_stake_raw", input.terms.stakeRaw)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .is("black_session_id", null)
    .neq("white_session_id", input.sessionId)
    .neq("white_wallet_address", input.walletAddress)
    .gt("updated_at", queueCutoffIso())
    .select(gameColumns));

  claim = guardUpdatedAt(claim, waitingRow);
  const { data: claimed, error: claimError } = await claim.maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;

  const row = claimed as PvpGameRow;
  return {
    gameId: row.id,
    color: "b" as const,
    depositRole: "black" as const,
    playerToken: input.playerToken,
    contestId: requireString(row.escrow_contest_id, "escrow_contest_id"),
    stakeLamports: requireString(row.wager_stake_raw, "wager_stake_raw"),
    assetMint: requireString(row.wager_asset_mint, "wager_asset_mint"),
    assetKind: (row.wager_asset_kind === "native_eth" ? "native_eth" : "spl_token") as WagerAssetKind,
    paymentMode: rowPaymentMode(row),
    ...payoutResponse(row, "b"),
    game: publicGame(row),
  };
}

async function hasPreparingWsolOpponent(input: {
  sessionId: string;
  walletAddress: string;
  terms: WsolQueueTerms;
  format: TimeControlFormat;
}): Promise<boolean> {
  const query = guardWsolEscrowLane(admin
    .from("pvp_games")
    .select("id", { count: "exact", head: true })
    .eq("status", "waiting")
    .eq("payment_status", "white_prepared")
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.terms.assetMint)
    .eq("wager_stake_raw", input.terms.stakeRaw)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .is("black_session_id", null)
    .neq("white_session_id", input.sessionId)
    .neq("white_wallet_address", input.walletAddress)
    .gt("updated_at", queueCutoffIso()));

  const { count, error } = await query;
  if (error) throw error;
  return Boolean(count);
}

async function waitForPreparedWsolOpponent(input: {
  sessionId: string;
  walletAddress: string;
  terms: WsolQueueTerms;
  format: TimeControlFormat;
  playerToken: string;
  playerTokenHash: string;
}) {
  if (!await hasPreparingWsolOpponent(input)) return null;

  const deadline = Date.now() + preparedOpponentWaitMs();
  while (Date.now() < deadline) {
    await sleep(preparedOpponentPollMs);
    const claim = await claimFundedWsolWager(input);
    if (claim) return claim;
  }
  return null;
}

type SponsoredQueueTerms = ReturnType<typeof configuredSponsoredWagerTerms>;

async function claimFundedSponsoredWager(input: {
  sessionId: string;
  walletAddress: string;
  terms: SponsoredQueueTerms;
  format: TimeControlFormat;
  playerToken: string;
  playerTokenHash: string;
  sponsoredRequestId: string | null;
}) {
  const { data: waitingRows, error: waitingError } = await admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", "white_deposited")
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.terms.assetMint)
    .eq("wager_stake_raw", input.terms.stakeRaw)
    .eq("rent_sponsor_address", input.terms.rentSponsorAddress)
    .eq("rent_recipient_address", input.terms.rentRecipientAddress)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .is("black_session_id", null)
    .neq("white_session_id", input.sessionId)
    .neq("white_wallet_address", input.walletAddress)
    .gt("updated_at", queueCutoffIso())
    .order("created_at", { ascending: true })
    .limit(1);

  if (waitingError) throw waitingError;

  const waitingRow = waitingRows?.[0] as PvpGameRow | undefined;
  if (!waitingRow?.escrow_contest_id) return null;

  assertSponsoredWagerTerms(waitingRow, {
    ...input.terms,
    escrowContestId: waitingRow.escrow_contest_id,
  });
  let claim = admin
    .from("pvp_games")
    .update({
      black_session_id: input.sessionId,
      black_player_token_hash: input.playerTokenHash,
      black_wallet_address: input.walletAddress,
      payment_status: "black_prepared",
      sponsored_request_id: input.sponsoredRequestId,
      updated_at: nowIso(),
    })
    .eq("id", waitingRow.id)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", "white_deposited")
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.terms.assetMint)
    .eq("wager_stake_raw", input.terms.stakeRaw)
    .eq("rent_sponsor_address", input.terms.rentSponsorAddress)
    .eq("rent_recipient_address", input.terms.rentRecipientAddress)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .is("black_session_id", null)
    .neq("white_session_id", input.sessionId)
    .neq("white_wallet_address", input.walletAddress)
    .gt("updated_at", queueCutoffIso())
    .select(gameColumns);

  claim = guardUpdatedAt(claim, waitingRow);
  const { data: claimed, error: claimError } = await claim.maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return null;

  const row = claimed as PvpGameRow;
  return {
    gameId: row.id,
    color: "b" as const,
    depositRole: "black" as const,
    playerToken: input.playerToken,
    contestId: requireString(row.escrow_contest_id, "escrow_contest_id"),
    stakeLamports: requireString(row.wager_stake_raw, "wager_stake_raw"),
    assetMint: requireString(row.wager_asset_mint, "wager_asset_mint"),
    assetKind: "native_sol" as const,
    paymentMode: "native_sol_sponsored" as const,
    rentSponsorAddress: requireString(row.rent_sponsor_address, "rent_sponsor_address"),
    rentRecipientAddress: requireString(row.rent_recipient_address, "rent_recipient_address"),
    game: publicGame(row),
  };
}

async function hasPreparingSponsoredOpponent(input: {
  sessionId: string;
  walletAddress: string;
  terms: SponsoredQueueTerms;
  format: TimeControlFormat;
}): Promise<boolean> {
  const { count, error } = await admin
    .from("pvp_games")
    .select("id", { count: "exact", head: true })
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", preparedSponsoredWagerPaymentStatus)
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", input.terms.assetMint)
    .eq("wager_stake_raw", input.terms.stakeRaw)
    .eq("rent_sponsor_address", input.terms.rentSponsorAddress)
    .eq("rent_recipient_address", input.terms.rentRecipientAddress)
    .eq("clock_initial_ms", input.format.clockMs)
    .eq("clock_increment_ms", input.format.incrementMs)
    .is("black_session_id", null)
    .is("white_deposit_signature", null)
    .is("white_sponsor_signature", null)
    .neq("white_session_id", input.sessionId)
    .neq("white_wallet_address", input.walletAddress)
    .gt("updated_at", queueCutoffIso());

  if (error) throw error;
  return Boolean(count);
}

async function waitForPreparedSponsoredOpponent(input: {
  sessionId: string;
  walletAddress: string;
  terms: SponsoredQueueTerms;
  format: TimeControlFormat;
  playerToken: string;
  playerTokenHash: string;
  sponsoredRequestId: string | null;
}) {
  if (!await hasPreparingSponsoredOpponent(input)) return null;

  const deadline = Date.now() + preparedOpponentWaitMs();
  while (Date.now() < deadline) {
    await sleep(preparedOpponentPollMs);
    const claim = await claimFundedSponsoredWager(input);
    if (claim) return claim;
  }
  return null;
}

async function claimWaitingGame(gameId: string, sessionId: string) {
  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);
  const now = nowIso();
  const { data, error } = await admin
    .from("pvp_games")
    .update({
      black_session_id: sessionId,
      black_player_token_hash: tokenHash,
      status: "active",
      clock_turn: "w",
      clock_started_at: now,
      clock_last_started_at: now,
      updated_at: now,
    })
    .eq("id", gameId)
    .eq("status", "waiting")
    .is("payment_status", null)
    .is("payment_mode", null)
    .is("wager_asset_kind", null)
    .is("wager_asset_mint", null)
    .is("wager_stake_raw", null)
    .is("escrow_contest_id", null)
    .is("white_wallet_address", null)
    .is("black_wallet_address", null)
    .is("black_session_id", null)
    .neq("white_session_id", sessionId)
    .gt("updated_at", queueCutoffIso())
    .select(gameColumns)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  await markLobbyForGame(data.id, "active");

  return {
    gameId: data.id,
    color: "b" as const,
    playerToken,
    game: publicGame(data as PvpGameRow),
  };
}

async function createPracticeWaitingGame(sessionId: string, format = defaultTimeControlFormat()) {
  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);
  const { data, error } = await admin
    .from("pvp_games")
    .insert({
      white_session_id: sessionId,
      white_player_token_hash: tokenHash,
      status: "waiting",
      moves: [],
      updated_at: nowIso(),
      clock_initial_ms: format.clockMs,
      clock_increment_ms: format.incrementMs,
      white_clock_ms: format.clockMs,
      black_clock_ms: format.clockMs,
      clock_turn: null,
      clock_started_at: null,
      clock_last_started_at: null,
    })
    .select(gameColumns)
    .single();

  if (error) throw error;

  return {
    gameId: data.id,
    color: "w" as const,
    playerToken,
    game: publicGame(data as PvpGameRow),
  };
}

async function reusablePracticeWaitingRow(body: RefereeRequest, sessionId: string): Promise<PvpGameRow | null> {
  if (!body.reuseGameId || !body.playerToken) return null;
  const format = requestTimeControlFormat(body.timeControl);

  try {
    const row = await fetchGame(body.reuseGameId);
    const color = await tokenColor(row, body.playerToken);

    if (
      color === "w" &&
      row.white_session_id === sessionId &&
      row.status === "waiting" &&
      !row.black_session_id &&
      isPracticeMatchmakingRow(row) &&
      hasSupportedClock(row) &&
      formatForClock(row).timeControl === format.timeControl &&
      row.updated_at &&
      row.updated_at > queueCutoffIso()
    ) {
      return row;
    }
  } catch {
    return null;
  }

  return null;
}

async function practiceWaitingCandidates(
  sessionId: string,
  format: TimeControlFormat,
  excludeGameId?: string,
): Promise<Array<{ id: string; created_at: string | null }>> {
  let query = admin
    .from("pvp_games")
    .select("id,created_at")
    .eq("status", "waiting")
    .is("payment_status", null)
    .is("payment_mode", null)
    .is("wager_asset_kind", null)
    .is("wager_asset_mint", null)
    .is("wager_stake_raw", null)
    .is("escrow_contest_id", null)
    .is("white_wallet_address", null)
    .is("black_wallet_address", null)
    .is("black_session_id", null)
    .eq("clock_initial_ms", format.clockMs)
    .eq("clock_increment_ms", format.incrementMs)
    .neq("white_session_id", sessionId)
    .gt("updated_at", queueCutoffIso());

  if (excludeGameId) query = query.neq("id", excludeGameId);

  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) throw error;
  const rows = data ?? [];
  const gameIds = rows.map((row) => row.id).filter(Boolean);
  if (!gameIds.length) return rows;

  const { data: lobbyRows, error: lobbyError } = await admin
    .from("pvp_lobbies")
    .select("game_id")
    .in("game_id", gameIds)
    .eq("status", "waiting")
    .gt("expires_at", nowIso());

  if (lobbyError) throw lobbyError;
  const lobbyGameIds = new Set((lobbyRows ?? []).map((row) => row.game_id));
  return rows.filter((row) => !lobbyGameIds.has(row.id));
}

async function claimPracticeOpponent(sessionId: string, format: TimeControlFormat, excludeGameId?: string) {
  for (let attempt = 0; attempt < queueClaimAttempts; attempt++) {
    const candidates = await practiceWaitingCandidates(sessionId, format, excludeGameId);
    if (!candidates.length) break;

    for (const candidate of candidates) {
      const claimed = await claimWaitingGame(candidate.id, sessionId);
      if (claimed) return claimed;
    }
  }

  return null;
}

async function cancelPracticeWaitingRow(gameId: string): Promise<PvpGameRow | null> {
  const { data, error } = await admin
    .from("pvp_games")
    .update({ status: "cancelled", updated_at: nowIso() })
    .eq("id", gameId)
    .eq("status", "waiting")
    .is("payment_status", null)
    .is("payment_mode", null)
    .is("wager_asset_kind", null)
    .is("wager_asset_mint", null)
    .is("wager_stake_raw", null)
    .is("escrow_contest_id", null)
    .is("white_wallet_address", null)
    .is("black_wallet_address", null)
    .is("black_session_id", null)
    .select(gameColumns)
    .maybeSingle();

  if (error) throw error;
  if (data) await markLobbyForGame(data.id, "cancelled");
  return data as PvpGameRow | null;
}

async function touchPracticeWaitingRow(row: PvpGameRow, playerToken: string) {
  const { data, error } = await admin
    .from("pvp_games")
    .update({ updated_at: nowIso() })
    .eq("id", row.id)
    .eq("status", "waiting")
    .is("payment_status", null)
    .is("payment_mode", null)
    .is("wager_asset_kind", null)
    .is("wager_asset_mint", null)
    .is("wager_stake_raw", null)
    .is("escrow_contest_id", null)
    .is("white_wallet_address", null)
    .is("black_wallet_address", null)
    .is("black_session_id", null)
    .select(gameColumns)
    .single();

  if (error) throw error;
  return {
    gameId: data.id,
    color: "w" as const,
    playerToken,
    game: publicGame(data as PvpGameRow),
  };
}

async function handleJoinQueue(body: RefereeRequest) {
  const sessionId = requireString(body.sessionId, "sessionId");
  const format = requestTimeControlFormat(body.timeControl);
  await requirePracticeQueueFriction(body);

  const reusableRow = await reusablePracticeWaitingRow(body, sessionId);
  const claimed = await claimPracticeOpponent(sessionId, format, reusableRow?.id);
  if (claimed) {
    if (reusableRow) await cancelPracticeWaitingRow(reusableRow.id);
    return claimed;
  }

  if (reusableRow && body.playerToken) {
    return touchPracticeWaitingRow(reusableRow, body.playerToken);
  }

  return createPracticeWaitingGame(sessionId, format);
}

async function handleJoinGame(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const row = await fetchGame(gameId);

  if (row.status === "cancelled") throw new HttpError(409, "Match search was cancelled");

  if (body.playerToken) {
    const color = await tokenColor(row, body.playerToken);
    if (color) {
      return {
        gameId: row.id,
        color,
        playerToken: body.playerToken,
        game: publicGame(row),
      };
    }
  }

  if (row.status === "waiting" && !row.black_session_id && row.white_session_id !== sessionId) {
    const claimed = await claimWaitingGame(row.id, sessionId);
    if (claimed) return claimed;
  }

  throw new HttpError(403, "You are not a player in this game");
}

async function fetchLobby(lobbyId: string): Promise<PvpLobbyRow> {
  const { data, error } = await admin
    .from("pvp_lobbies")
    .select("*")
    .eq("id", lobbyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new HttpError(404, "Lobby not found");
  return data as PvpLobbyRow;
}

async function waitingLobbyForGame(gameId: string): Promise<PvpLobbyRow | null> {
  const { data, error } = await admin
    .from("pvp_lobbies")
    .select("*")
    .eq("game_id", gameId)
    .eq("status", "waiting")
    .maybeSingle();

  if (error) throw error;
  return data as PvpLobbyRow | null;
}

function assertLobbyJoinable(lobby: PvpLobbyRow): void {
  if (lobby.status !== "waiting") throw new HttpError(409, "Lobby is no longer waiting");
  const expiresAt = lobby.expires_at ? Date.parse(lobby.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new HttpError(409, "Lobby expired");
  }
}

function lobbyGameJoinable(lobby: PvpLobbyRow, game: PvpGameRow): boolean {
  if (game.status !== "waiting" || game.black_session_id) return false;
  if (lobby.match_type === "wager") {
    return isWagerRow(game) && game.payment_status === "white_deposited";
  }
  return isPracticeMatchmakingRow(game);
}

async function handleCreateLobby(body: RefereeRequest) {
  const sessionId = requireString(body.sessionId, "sessionId");
  const matchType = requestLobbyMatchType(body.matchType);
  const lobbyName = cleanLobbyText(body.lobbyName, "OPEN TABLE", 24);
  const hostName = cleanLobbyText(body.hostName, "PLAYER 1", 24);
  const access = requestLobbyAccess(body.access, matchType);
  const preferredColor = requestLobbyColor(body.preferredColor);
  const format = requestTimeControlFormat(body.timeControl);
  const timeControl = format.timeControl;
  let gameId = typeof body.gameId === "string" && body.gameId.trim() ? body.gameId.trim() : null;
  let playerToken = typeof body.playerToken === "string" && body.playerToken.trim() ? body.playerToken.trim() : null;
  let color: PlayerColor = "w";
  let game: PvpGameRow;

  if (!gameId) {
    if (matchType !== "free") throw new HttpError(400, "Wager lobby requires a prepared wager game");
    await requirePracticeQueueFriction(body);
    const created = await createPracticeWaitingGame(sessionId, format);
    gameId = created.gameId;
    playerToken = created.playerToken;
    game = await fetchGame(created.gameId);
  } else {
    if (!playerToken) throw new HttpError(400, "Missing playerToken");
    game = await fetchGame(gameId);
    const tokenOwner = await tokenColor(game, playerToken);
    if (tokenOwner !== "w" || game.white_session_id !== sessionId || game.status !== "waiting" || game.black_session_id) {
      throw new HttpError(403, "You cannot publish this lobby");
    }
    color = tokenOwner;
  }

  if (matchType === "free" && !isPracticeMatchmakingRow(game)) {
    throw new HttpError(400, "Free lobby requires a practice game");
  }
  if (matchType === "wager" && (!isWagerRow(game) || game.payment_status !== "white_deposited")) {
    throw new HttpError(409, "Wager lobby requires a funded waiting wager");
  }
  if (matchType === "wager" && formatForClock(game).timeControl !== format.timeControl) {
    throw new HttpError(409, "Wager lobby clock does not match the selected format");
  }

  const now = nowIso();
  const stakeRaw = matchType === "wager"
    ? (typeof body.stakeRaw === "string" && /^[0-9]+$/.test(body.stakeRaw) ? body.stakeRaw : game.wager_stake_raw ?? null)
    : null;
  const { data, error } = await admin
    .from("pvp_lobbies")
    .upsert({
      game_id: gameId,
      host_session_id: sessionId,
      name: lobbyName,
      host_name: hostName,
      match_type: matchType,
      access,
      preferred_color: preferredColor,
      time_control: timeControl,
      stake_raw: stakeRaw,
      stake_label: matchType === "wager" ? cleanLobbyText(body.stakeLabel, "", 32) || null : null,
      asset_symbol: matchType === "wager"
        ? cleanLobbyText(body.assetSymbol, game.wager_asset_symbol ?? "", 16) || null
        : null,
      status: "waiting",
      last_heartbeat_at: now,
      expires_at: lobbyExpiryIso(),
      updated_at: now,
    }, { onConflict: "game_id" })
    .select("*")
    .single();

  if (error) throw error;

  return {
    ok: true,
    gameId,
    color,
    playerToken,
    game: publicGame(game),
    lobby: publicLobby(data as PvpLobbyRow, game),
  };
}

async function handleListLobbies() {
  await expireStaleLobbies();
  const queueCounts = await buildQueueCounts();
  const { data: lobbyRows, error } = await admin
    .from("pvp_lobbies")
    .select("*")
    .eq("status", "waiting")
    .neq("access", "invite")
    .gt("expires_at", nowIso())
    .order("updated_at", { ascending: false })
    .limit(lobbyListLimit);

  if (error) throw error;
  const lobbies = (lobbyRows ?? []) as PvpLobbyRow[];
  const gameIds = lobbies.map((lobby) => lobby.game_id);
  if (!gameIds.length) return { ok: true, lobbies: [], queueCounts };

  const { data: gameRows, error: gamesError } = await admin
    .from("pvp_games")
    .select(gameColumns)
    .in("id", gameIds);

  if (gamesError) throw gamesError;
  const gameById = new Map((gameRows ?? []).map((row) => [(row as PvpGameRow).id, row as PvpGameRow]));
  const visible = [];

  for (const lobby of lobbies) {
    const game = gameById.get(lobby.game_id);
    if (!game || !lobbyGameJoinable(lobby, game)) {
      await markLobbyForGame(lobby.game_id, game?.status === "active" ? "active" : "expired");
      continue;
    }
    visible.push(publicLobby(lobby, game));
  }

  return { ok: true, lobbies: visible, queueCounts };
}

async function activeLobbyGameIds(gameIds: string[]): Promise<Set<string>> {
  if (!gameIds.length) return new Set();
  const { data, error } = await admin
    .from("pvp_lobbies")
    .select("game_id")
    .in("game_id", gameIds)
    .eq("status", "waiting")
    .gt("expires_at", nowIso());

  if (error) throw error;
  return new Set((data ?? []).map((row) => row.game_id).filter(Boolean));
}

async function quickQueueRows(matchType: LobbyMatchType, format: TimeControlFormat): Promise<PvpGameRow[]> {
  let query = admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("status", "waiting")
    .is("black_session_id", null)
    .eq("clock_initial_ms", format.clockMs)
    .eq("clock_increment_ms", format.incrementMs)
    .gt("updated_at", queueCutoffIso())
    .order("created_at", { ascending: true })
    .limit(queueCountLimit);

  if (matchType === "free") {
    query = query
      .is("payment_status", null)
      .is("payment_mode", null)
      .is("wager_asset_kind", null)
      .is("wager_asset_mint", null)
      .is("wager_stake_raw", null)
      .is("escrow_contest_id", null)
      .is("white_wallet_address", null)
      .is("black_wallet_address", null);
  } else {
    query = query
      .eq("payment_status", "white_deposited")
      .eq("settlement_status", "none")
      .not("wager_asset_mint", "is", null)
      .not("wager_stake_raw", "is", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as PvpGameRow[];
  const gameIds = rows.map((row) => row.id).filter(Boolean);
  const lobbyGameIds = await activeLobbyGameIds(gameIds);
  return rows.filter((row) => !lobbyGameIds.has(row.id));
}

async function buildQueueCounts() {
  const counts = [];
  for (const format of supportedTimeControls) {
    const freeRows = await quickQueueRows("free", format);
    counts.push({
      matchType: "free",
      formatId: format.id,
      formatFamily: format.family,
      formatLabel: format.label,
      timeControl: format.timeControl,
      players: freeRows.length,
    });

    const wagerRows = await quickQueueRows("wager", format);
    const wagerCounts = new Map<string, {
      players: number;
      stakeRaw: string;
      assetSymbol: string | null;
    }>();
    for (const row of wagerRows) {
      const stakeRaw = typeof row.wager_stake_raw === "string" && /^[0-9]+$/.test(row.wager_stake_raw)
        ? row.wager_stake_raw
        : "0";
      const assetSymbol = typeof row.wager_asset_symbol === "string" && row.wager_asset_symbol.trim()
        ? row.wager_asset_symbol.trim()
        : null;
      const key = `${stakeRaw}:${assetSymbol ?? ""}`;
      const current = wagerCounts.get(key);
      wagerCounts.set(key, {
        players: (current?.players ?? 0) + 1,
        stakeRaw,
        assetSymbol,
      });
    }
    for (const wagerCount of wagerCounts.values()) {
      counts.push({
        matchType: "wager",
        formatId: format.id,
        formatFamily: format.family,
        formatLabel: format.label,
        timeControl: format.timeControl,
        stakeRaw: wagerCount.stakeRaw,
        assetSymbol: wagerCount.assetSymbol,
        players: wagerCount.players,
      });
    }
  }
  return counts;
}

async function handleJoinLobby(body: RefereeRequest) {
  const lobbyId = requireString(body.lobbyId, "lobbyId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const lobby = await fetchLobby(lobbyId);
  assertLobbyJoinable(lobby);

  const game = await fetchGame(lobby.game_id);
  if (!lobbyGameJoinable(lobby, game)) {
    await markLobbyForGame(lobby.game_id, game.status === "active" ? "active" : "expired");
    throw new HttpError(409, "Lobby is no longer joinable");
  }
  if (lobby.match_type === "wager") {
    return {
      ok: true,
      requiresWager: true,
      gameId: lobby.game_id,
      lobby: publicLobby(lobby, game),
    };
  }

  const claimed = await claimWaitingGame(lobby.game_id, sessionId);
  if (!claimed) {
    await markLobbyForGame(lobby.game_id, "active");
    throw new HttpError(409, "Lobby was already taken");
  }

  const latestLobby = await fetchLobby(lobby.id).catch(() => lobby);
  const claimedGame = await fetchGame(lobby.game_id).catch(() => game);
  return {
    ...claimed,
    lobby: publicLobby(latestLobby, claimedGame),
  };
}

async function handleCancelLobby(body: RefereeRequest) {
  const lobbyId = requireString(body.lobbyId, "lobbyId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const lobby = await fetchLobby(lobbyId);
  const game = await fetchGame(lobby.game_id);
  const color = await tokenColor(game, playerToken);

  if (color !== "w" || game.white_session_id !== sessionId || game.status !== "waiting" || game.black_session_id) {
    throw new HttpError(403, "You cannot cancel this lobby");
  }

  await markLobbyForGame(lobby.game_id, "cancelled");
  if (lobby.match_type === "free" && isPracticeMatchmakingRow(game)) {
    await cancelPracticeWaitingRow(game.id);
  }

  const latest = await fetchGame(game.id).catch(() => game);
  return { ok: true, lobby: publicLobby({ ...lobby, status: "cancelled" }, latest), game: publicGame(latest) };
}

async function handleHeartbeatLobby(body: RefereeRequest) {
  const lobbyId = requireString(body.lobbyId, "lobbyId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const lobby = await fetchLobby(lobbyId);
  const game = await fetchGame(lobby.game_id);
  const color = await tokenColor(game, playerToken);

  if (color !== "w" || game.white_session_id !== sessionId || game.status !== "waiting" || game.black_session_id) {
    throw new HttpError(403, "You cannot heartbeat this lobby");
  }

  await touchLobbyForGame(lobby.game_id, "waiting");
  const latestLobby = await fetchLobby(lobby.id);
  return { ok: true, lobby: publicLobby(latestLobby, game), game: publicGame(game) };
}

async function assertWaitingOwner(body: RefereeRequest): Promise<PvpGameRow> {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);

  if (
    color !== "w" ||
    row.white_session_id !== sessionId ||
    row.status !== "waiting" ||
    row.black_session_id
  ) {
    throw new HttpError(403, "You cannot change this waiting match");
  }

  return row;
}

async function handleHeartbeat(body: RefereeRequest) {
  const row = await assertWaitingOwner(body);
  const lobby = await waitingLobbyForGame(row.id);

  if (isPracticeMatchmakingRow(row) && !lobby) {
    const candidates = await practiceWaitingCandidates(row.white_session_id, formatForClock(row), row.id);
    if (candidates.length) {
      const oldestCandidate = candidates[0];
      const shouldMoveToCandidate =
        !row.created_at ||
        !oldestCandidate.created_at ||
        oldestCandidate.created_at <= row.created_at;

      if (shouldMoveToCandidate) {
        const cancelled = await cancelPracticeWaitingRow(row.id);
        if (cancelled) {
          for (const candidate of candidates) {
            const claimed = await claimWaitingGame(candidate.id, row.white_session_id);
            if (claimed) return claimed;
          }
          return createPracticeWaitingGame(row.white_session_id, formatForClock(row));
        }

        const latest = await fetchGame(row.id);
        if (latest.status !== "waiting" || latest.black_session_id) {
          return { ok: true, game: publicGame(latest) };
        }
      }
    }
  }

  let query = admin
    .from("pvp_games")
    .update({ updated_at: nowIso() })
    .eq("id", row.id)
    .eq("status", "waiting")
    .is("black_session_id", null);

  if (isPracticeMatchmakingRow(row)) {
    query = query
      .is("payment_status", null)
      .is("payment_mode", null)
      .is("wager_asset_kind", null)
      .is("wager_asset_mint", null)
      .is("wager_stake_raw", null)
      .is("escrow_contest_id", null)
      .is("white_wallet_address", null)
      .is("black_wallet_address", null);
  }

  const { data, error } = await query
    .select(gameColumns)
    .single();

  if (error) throw error;
  if (lobby) await touchLobbyForGame(row.id, "waiting");
  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleCancelWaiting(body: RefereeRequest) {
  const row = await assertWaitingOwner(body);
  if (!isPracticeMatchmakingRow(row)) {
    throw new HttpError(403, "Use wager cancellation for wagered matches");
  }
  const cancelCount = await countCancelledBySession(row.white_session_id).catch(() => 0) + 1;
  const suspicious = buildSuspiciousUpdate(row, {
    queueCancelCount: cancelCount,
    abandonmentCount: cancelCount,
  });
  const { data, error } = await admin
    .from("pvp_games")
    .update({
      status: "cancelled",
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: nowIso(),
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .is("payment_status", null)
    .is("payment_mode", null)
    .is("wager_asset_kind", null)
    .is("wager_asset_mint", null)
    .is("wager_stake_raw", null)
    .is("escrow_contest_id", null)
    .is("white_wallet_address", null)
    .is("black_wallet_address", null)
    .is("black_session_id", null)
    .select(gameColumns)
    .single();

  if (error) throw error;
  if (suspicious) {
    await logAbuseEvent({
      sessionId: row.white_session_id,
      gameId: row.id,
      action: "cancel_waiting",
      eventType: suspicious.flags[0] ?? "queue_cancel_churn",
      severity: "warning",
      evidence: { cancelCount },
    });
  }
  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handlePrepareWagerQueue(body: RefereeRequest) {
  const sessionId = requireString(body.sessionId, "sessionId");
  const walletAddress = await requireWalletProof(body, "prepare_wager_queue", null);
  const terms = { ...configuredWagerTerms(body), ...await automaticEntryTerms(body, walletAddress) };
  const format = requestTimeControlFormat(body.timeControl);
  if (terms.paymentMode !== "robinhood_eth_escrow") await enforceWagerHoldGate(walletAddress);
  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);
  const now = nowIso();
  const { clockMs, incrementMs } = wagerClockConfig(format.timeControl);

  const queueClaimInput = { sessionId, walletAddress, terms, format, playerToken, playerTokenHash: tokenHash };
  const fundedClaim = await claimFundedWsolWager(queueClaimInput);
  if (fundedClaim) return fundedClaim;

  const preparedClaim = await waitForPreparedWsolOpponent(queueClaimInput);
  if (preparedClaim) return preparedClaim;

  const { data, error } = await admin
    .from("pvp_games")
    .insert({
      white_session_id: sessionId,
      white_player_token_hash: tokenHash,
      white_wallet_address: walletAddress,
      status: "waiting",
      moves: [],
      updated_at: now,
      payment_mode: terms.paymentMode,
      wager_asset_kind: terms.assetKind,
      wager_asset_mint: terms.assetMint,
      wager_asset_symbol: terms.symbol,
      wager_asset_decimals: terms.decimals,
      wager_stake_raw: terms.stakeRaw,
      escrow_contest_id: terms.escrowContestId,
      ...payoutRowFields(terms),
      payment_status: "white_prepared",
      settlement_status: "none",
      clock_initial_ms: clockMs,
      clock_increment_ms: incrementMs,
      white_clock_ms: clockMs,
      black_clock_ms: clockMs,
      clock_turn: null,
      clock_started_at: null,
      clock_last_started_at: null,
    })
    .select(gameColumns)
    .single();

  if (error) throw error;

  return {
    gameId: data.id,
    color: "w" as const,
    depositRole: "white" as const,
    playerToken,
    contestId: terms.escrowContestId,
    stakeLamports: terms.stakeRaw,
    assetMint: terms.assetMint,
    assetKind: terms.assetKind,
    paymentMode: terms.paymentMode,
    ...payoutResponse(data as PvpGameRow, "w"),
    game: publicGame(data as PvpGameRow),
  };
}

async function handlePrepareWagerLobby(body: RefereeRequest) {
  const sessionId = requireString(body.sessionId, "sessionId");
  const walletAddress = await requireWalletProof(body, "prepare_wager_lobby", null);
  const terms = { ...configuredWagerTerms(body), ...await automaticEntryTerms(body, walletAddress) };
  const format = requestTimeControlFormat(body.timeControl);
  if (terms.paymentMode !== "robinhood_eth_escrow") await enforceWagerHoldGate(walletAddress);
  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);
  const now = nowIso();
  const { clockMs, incrementMs } = wagerClockConfig(format.timeControl);

  const { data, error } = await admin
    .from("pvp_games")
    .insert({
      white_session_id: sessionId,
      white_player_token_hash: tokenHash,
      white_wallet_address: walletAddress,
      status: "waiting",
      moves: [],
      updated_at: now,
      payment_mode: terms.paymentMode,
      wager_asset_kind: terms.assetKind,
      wager_asset_mint: terms.assetMint,
      wager_asset_symbol: terms.symbol,
      wager_asset_decimals: terms.decimals,
      wager_stake_raw: terms.stakeRaw,
      escrow_contest_id: terms.escrowContestId,
      ...payoutRowFields(terms),
      payment_status: "white_prepared",
      settlement_status: "none",
      clock_initial_ms: clockMs,
      clock_increment_ms: incrementMs,
      white_clock_ms: clockMs,
      black_clock_ms: clockMs,
      clock_turn: null,
      clock_started_at: null,
      clock_last_started_at: null,
    })
    .select(gameColumns)
    .single();

  if (error) throw error;

  return {
    gameId: data.id,
    color: "w" as const,
    depositRole: "white" as const,
    playerToken,
    contestId: terms.escrowContestId,
    stakeLamports: terms.stakeRaw,
    assetMint: terms.assetMint,
    assetKind: terms.assetKind,
    paymentMode: terms.paymentMode,
    ...payoutResponse(data as PvpGameRow, "w"),
    game: publicGame(data as PvpGameRow),
  };
}

function sponsoredWagerState(row: PvpGameRow) {
  return {
    gameId: row.id,
    paymentMode: row.payment_mode ?? null,
    assetKind: row.wager_asset_kind ?? null,
    paymentStatus: row.payment_status ?? null,
    settlementStatus: row.settlement_status ?? null,
    refundStatus: row.refund_status ?? null,
    rentReclaimStatus: row.rent_reclaim_status ?? null,
    stakeRaw: row.wager_stake_raw ?? null,
    assetMint: row.wager_asset_mint ?? null,
    escrowContestId: row.escrow_contest_id ?? null,
    whiteWalletAddress: row.white_wallet_address ?? null,
    blackWalletAddress: row.black_wallet_address ?? null,
    rentSponsorAddress: row.rent_sponsor_address ?? null,
    rentRecipientAddress: row.rent_recipient_address ?? null,
    whiteSponsorSignature: row.white_sponsor_signature ?? null,
    blackSponsorSignature: row.black_sponsor_signature ?? null,
    cancelSponsorSignature: row.cancel_sponsor_signature ?? null,
    updatedAt: row.updated_at,
  };
}

async function handlePrepareSponsoredWager(
  body: RefereeRequest,
  session: SessionContext,
  fingerprint: RequestFingerprint,
) {
  const idempotency = await beginIdempotentRequest(body, "prepare_sponsored_wager", null);
  if (idempotency && "duplicate" in idempotency) return idempotency.payload;

  try {
    const sessionId = requireString(body.sessionId, "sessionId");
    const walletAddress = await requireWalletProof(body, "prepare_sponsored_wager", null);
    const terms = configuredSponsoredWagerTerms(body);
    const format = requestTimeControlFormat(body.timeControl);
    await enforceWagerHoldGate(walletAddress);
    const sponsoredRequestId = idempotency && "requestId" in idempotency ? idempotency.requestId : null;
    await expireStalePreparedSponsoredWagersForIdentity(sessionId, walletAddress);
    await enforceSponsoredWagerGuard({
      session,
      fingerprint,
      walletAddress,
      stakeRaw: terms.stakeRaw,
      rentSponsorAddress: terms.rentSponsorAddress,
    });
    const playerToken = newPlayerToken();
    const tokenHash = await sha256Hex(playerToken);
    const now = nowIso();
    const { clockMs, incrementMs } = wagerClockConfig(format.timeControl);

    const retryRow = await reusePreparedSponsoredWagerForRetry({
      sessionId,
      walletAddress,
      assetMint: terms.assetMint,
      stakeRaw: terms.stakeRaw,
      format,
      rentSponsorAddress: terms.rentSponsorAddress,
      rentRecipientAddress: terms.rentRecipientAddress,
      playerTokenHash: tokenHash,
      sponsoredRequestId,
    });

    if (retryRow?.escrow_contest_id) {
      assertSponsoredWagerTerms(retryRow, {
        ...terms,
        escrowContestId: retryRow.escrow_contest_id,
      });
      const response = {
        gameId: retryRow.id,
        color: "w" as const,
        depositRole: "white" as const,
        playerToken,
        contestId: retryRow.escrow_contest_id,
        stakeLamports: requireString(retryRow.wager_stake_raw, "wager_stake_raw"),
        assetMint: requireString(retryRow.wager_asset_mint, "wager_asset_mint"),
        assetKind: "native_sol" as const,
        paymentMode: "native_sol_sponsored" as const,
        rentSponsorAddress: requireString(retryRow.rent_sponsor_address, "rent_sponsor_address"),
        rentRecipientAddress: requireString(retryRow.rent_recipient_address, "rent_recipient_address"),
        game: publicGame(retryRow),
      };
      if (idempotency && "complete" in idempotency) await idempotency.complete(response);
      return response;
    }

    const queueClaimInput = {
      sessionId,
      walletAddress,
      terms,
      format,
      playerToken,
      playerTokenHash: tokenHash,
      sponsoredRequestId,
    };
    const fundedClaim = await claimFundedSponsoredWager(queueClaimInput);
    if (fundedClaim) {
      if (idempotency && "complete" in idempotency) await idempotency.complete(fundedClaim);
      return fundedClaim;
    }

    const preparedClaim = await waitForPreparedSponsoredOpponent(queueClaimInput);
    if (preparedClaim) {
      if (idempotency && "complete" in idempotency) await idempotency.complete(preparedClaim);
      return preparedClaim;
    }

    const { data, error } = await admin
      .from("pvp_games")
      .insert({
        white_session_id: sessionId,
        white_player_token_hash: tokenHash,
        white_wallet_address: walletAddress,
        status: "waiting",
        moves: [],
        updated_at: now,
        payment_mode: terms.paymentMode,
        wager_asset_kind: terms.assetKind,
        wager_asset_mint: terms.assetMint,
        wager_asset_symbol: terms.symbol,
        wager_asset_decimals: terms.decimals,
        wager_stake_raw: terms.stakeRaw,
        escrow_contest_id: terms.escrowContestId,
        payment_status: "white_prepared",
        settlement_status: "none",
        rent_sponsor_address: terms.rentSponsorAddress,
        rent_recipient_address: terms.rentRecipientAddress,
        rent_reclaim_status: "pending",
        sponsored_request_id: sponsoredRequestId,
        clock_initial_ms: clockMs,
        clock_increment_ms: incrementMs,
        white_clock_ms: clockMs,
        black_clock_ms: clockMs,
        clock_turn: null,
        clock_started_at: null,
        clock_last_started_at: null,
      })
      .select(gameColumns)
      .single();

    if (error) throw error;

    const response = {
      gameId: data.id,
      color: "w" as const,
      depositRole: "white" as const,
      playerToken,
      contestId: terms.escrowContestId,
      stakeLamports: terms.stakeRaw,
      assetMint: terms.assetMint,
      assetKind: terms.assetKind,
      paymentMode: terms.paymentMode,
      rentSponsorAddress: terms.rentSponsorAddress,
      rentRecipientAddress: terms.rentRecipientAddress,
      game: publicGame(data as PvpGameRow),
    };
    if (idempotency && "complete" in idempotency) await idempotency.complete(response);
    return response;
  } catch (error) {
    if (idempotency && "abandon" in idempotency) await idempotency.abandon();
    throw error;
  }
}

async function handleConfirmSponsoredDeposit(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const row = await fetchGame(gameId);
  const terms = requestSponsoredWagerTerms(body, row);
  const color = await tokenColor(row, playerToken);
  const maybePlayerSignature = optionalTxSignature(body);
  const maybeSponsorSignature = maybePlayerSignature;

  if (color === "w" && row.payment_status === "white_deposited" && row.white_deposit_signature === maybePlayerSignature) {
    if (row.white_sponsor_signature === maybeSponsorSignature && row.white_wallet_address === walletAddress) {
      assertSponsoredWagerTerms(row, terms);
      return { ok: true, game: publicGame(row), sponsoredWager: sponsoredWagerState(row) };
    }
  }
  if (color === "b" && row.payment_status === "both_deposited" && row.black_deposit_signature === maybePlayerSignature) {
    if (row.black_sponsor_signature === maybeSponsorSignature && row.black_wallet_address === walletAddress) {
      assertSponsoredWagerTerms(row, terms);
      return { ok: true, game: publicGame(row), sponsoredWager: sponsoredWagerState(row) };
    }
  }

  if (color === "w") {
    assertWagerIdentity(row, {
      color,
      sessionId,
      walletAddress,
      expectedStatus: "waiting",
      expectedPaymentStatus: "white_prepared",
      expectedSettlementStatus: "none",
    });
    if (row.black_session_id) throw new HttpError(403, "Only white can confirm the first sponsored deposit");
    assertSponsoredWagerTerms(row, terms);
    const signatures = await verifySponsoredNativeTransition("white_deposit", row, body);

    let update = admin
      .from("pvp_games")
      .update({
        payment_status: "white_deposited",
        white_deposit_signature: signatures.playerSignature,
        white_sponsor_signature: signatures.sponsorSignature,
        updated_at: nowIso(),
      })
      .eq("id", row.id)
      .eq("status", "waiting")
      .eq("payment_mode", "native_sol_sponsored")
      .eq("wager_asset_kind", "native_sol")
      .eq("payment_status", "white_prepared")
      .eq("settlement_status", "none")
      .eq("white_wallet_address", walletAddress)
      .eq("wager_stake_raw", terms.stakeRaw)
      .eq("escrow_contest_id", terms.escrowContestId)
      .is("black_session_id", null)
      .select(gameColumns);

    update = guardUpdatedAt(update, row);
    const { data, error } = await update.maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(409, "Sponsored white deposit state changed before confirmation");
    return { ok: true, game: publicGame(data as PvpGameRow), sponsoredWager: sponsoredWagerState(data as PvpGameRow) };
  }

  assertWagerIdentity(row, {
    color,
    sessionId,
    walletAddress,
    expectedStatus: "waiting",
    expectedPaymentStatus: "black_prepared",
    expectedSettlementStatus: "none",
  });
  if (color !== "b") throw new HttpError(403, "Only black can confirm the second sponsored deposit");
  assertSponsoredWagerTerms(row, terms);
  const signatures = await verifySponsoredNativeTransition("black_deposit", row, body);
  const now = nowIso();
  const clock = initialClockState(
    now,
    Number(row.clock_initial_ms ?? wagerClockConfig().clockMs),
    Number(row.clock_increment_ms ?? wagerClockConfig().incrementMs),
  );
  let update = admin
    .from("pvp_games")
    .update({
      status: "active",
      payment_status: "both_deposited",
      black_deposit_signature: signatures.playerSignature,
      black_sponsor_signature: signatures.sponsorSignature,
      settlement_status: "none",
      updated_at: now,
      ...clock,
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("payment_status", "black_prepared")
    .eq("settlement_status", "none")
    .eq("black_wallet_address", walletAddress)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .select(gameColumns);

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Sponsored black deposit state changed before confirmation");
  await markLobbyForGame((data as PvpGameRow).id, "active");
  return { ok: true, game: publicGame(data as PvpGameRow), sponsoredWager: sponsoredWagerState(data as PvpGameRow) };
}

async function handleCancelSponsoredWager(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const walletAddress = await requireWalletProof(body, "cancel_sponsored_wager", gameId);
  const row = await fetchGame(gameId);
  const terms = requestSponsoredWagerTerms(body, row);
  const color = await tokenColor(row, playerToken);
  const cancellableStatuses = ["white_prepared", "white_deposited", "black_prepared"];

  if (color !== "w") throw new HttpError(403, "Only white can cancel a waiting sponsored wager");
  assertWagerIdentity(row, { color, sessionId, walletAddress, expectedStatus: "waiting" });
  if (!cancellableStatuses.includes(String(row.payment_status))) {
    throw new HttpError(409, "Sponsored wager cannot be cancelled from this payment state");
  }
  assertSponsoredWagerTerms(row, terms);
  assertRefundOpen(row);

  const signatures = row.payment_status === "white_prepared"
    ? null
    : await verifySponsoredNativeTransition("cancel_waiting", row, body);
  const now = nowIso();
  const cancelCount = await countCancelledBySession(row.white_session_id).catch(() => 0) + 1;
  const suspicious = buildSuspiciousUpdate(row, {
    queueCancelCount: cancelCount,
    abandonmentCount: cancelCount,
  });

  let update = admin
    .from("pvp_games")
    .update({
      status: "cancelled",
      payment_status: "cancelled",
      refund_status: signatures ? "refunded" : "none",
      refund_signature: signatures?.playerSignature ?? null,
      cancel_sponsor_signature: signatures?.sponsorSignature ?? null,
      rent_reclaim_status: signatures ? "reclaimed" : "pending",
      rent_reclaim_signature: signatures?.sponsorSignature ?? null,
      rent_reclaimed_at: signatures ? now : null,
      refund_error: null,
      refunded_at: signatures ? now : null,
      cancelled_at: now,
      clock_turn: null,
      clock_last_started_at: null,
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_kind", "native_sol")
    .eq("white_wallet_address", walletAddress)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .in("payment_status", cancellableStatuses)
    .select(gameColumns);

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Sponsored cancel state changed before confirmation");
  await markLobbyForGame((data as PvpGameRow).id, "cancelled");
  if (suspicious) {
    await logAbuseEvent({
      sessionId: row.white_session_id,
      gameId: row.id,
      walletAddress,
      action: "cancel_sponsored_wager",
      eventType: suspicious.flags[0] ?? "queue_cancel_churn",
      severity: "warning",
      evidence: { cancelCount },
    });
  }

  return { ok: true, game: publicGame(data as PvpGameRow), sponsoredWager: sponsoredWagerState(data as PvpGameRow) };
}

async function handleGetSponsoredWagerState(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);
  if (!color) throw new HttpError(403, "Invalid player token");
  if (row.payment_mode !== "native_sol_sponsored" || row.wager_asset_kind !== "native_sol") {
    throw new HttpError(409, "Game is not a sponsored native SOL wager");
  }
  return { ok: true, sponsoredWager: sponsoredWagerState(row), game: publicGame(row) };
}

async function handleConfirmWhiteDeposit(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  const color = await tokenColor(row, playerToken);
  const maybeSignature = optionalTxSignature(body);

  if (
    color === "w" &&
    row.white_session_id === sessionId &&
    Boolean(maybeSignature) &&
    row.white_deposit_signature === maybeSignature &&
    row.white_wallet_address === walletAddress
  ) {
    assertWsolEscrowLane(row);
    assertWagerTerms(row, terms);
    return { ok: true, game: publicGame(row) };
  }

  assertWagerIdentity(row, {
    color,
    sessionId,
    walletAddress,
    expectedStatus: "waiting",
    expectedPaymentStatus: "white_prepared",
    expectedSettlementStatus: "none",
  });
  if (color !== "w" || row.black_session_id) throw new HttpError(403, "Only white can confirm the first deposit");
  assertWsolEscrowLane(row);
  assertWagerTerms(row, terms);

  const signature = await verifyEscrowTransition("white_deposit", row, body);
  let update = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      payment_status: "white_deposited",
      white_deposit_signature: signature,
      updated_at: nowIso(),
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("payment_status", "white_prepared")
    .eq("settlement_status", "none")
    .eq("white_wallet_address", walletAddress)
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .is("black_session_id", null)
    .select(gameColumns));

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "White deposit state changed before confirmation");

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handlePrepareBlackDeposit(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const walletAddress = await requireWalletProof(body, "prepare_black_deposit", gameId);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  const payoutTerms = await automaticEntryTerms(body, walletAddress, row);
  if (rowPaymentMode(row) !== "robinhood_eth_escrow") await enforceWagerHoldGate(walletAddress);

  if (row.status !== "waiting" || row.payment_status !== "white_deposited") {
    throw new HttpError(409, "Wager is not ready for black deposit");
  }
  if (row.settlement_status !== "none") throw new HttpError(409, "Wager settlement state is not open");
  if (row.black_session_id) throw new HttpError(409, "Black seat is already claimed");
  if (row.white_session_id === sessionId) throw new HttpError(403, "White cannot claim the black seat");
  if (row.white_wallet_address === walletAddress) throw new HttpError(403, "White wallet cannot claim the black seat");
  assertWsolEscrowLane(row);
  assertWagerTerms(row, terms);
  const robinhood = rowPaymentMode(row) === "robinhood_eth_escrow";
  if (robinhood) {
    // A funded contest remains joinable until its on-chain expiry, even when
    // wallet signing or recovery takes longer than the practice queue heartbeat.
    await verifyEscrowTransition("white_deposit", row, {
      ...body,
      transactionSignature: requireString(row.white_deposit_signature, "white_deposit_signature"),
    });
  }

  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);
  let update = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      black_session_id: sessionId,
      black_player_token_hash: tokenHash,
      black_wallet_address: walletAddress,
      ...(payoutTerms.payoutMode === "automatic_rblx" ? { black_minimum_rblx: payoutTerms.minimumRblxOut } : {}),
      payment_status: "black_prepared",
      updated_at: nowIso(),
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("payment_status", "white_deposited")
    .eq("settlement_status", "none")
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .is("black_session_id", null)
    .neq("white_session_id", sessionId)
    .neq("white_wallet_address", walletAddress)
    .select(gameColumns));

  if (!robinhood) update = update.gt("updated_at", queueCutoffIso());
  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Black deposit state changed before preparation");

  return {
    gameId: data.id,
    color: "b" as const,
    playerToken,
    ...payoutResponse(data as PvpGameRow, "b"),
    game: publicGame(data as PvpGameRow),
  };
}

async function handleConfirmBlackDeposit(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  const color = await tokenColor(row, playerToken);
  const maybeSignature = optionalTxSignature(body);

  if (
    color === "b" &&
    row.black_session_id === sessionId &&
    Boolean(maybeSignature) &&
    row.black_deposit_signature === maybeSignature &&
    row.black_wallet_address === walletAddress
  ) {
    assertWsolEscrowLane(row);
    assertWagerTerms(row, terms);
    return { ok: true, game: publicGame(row) };
  }

  assertWagerIdentity(row, {
    color,
    sessionId,
    walletAddress,
    expectedStatus: "waiting",
    expectedPaymentStatus: "black_prepared",
    expectedSettlementStatus: "none",
  });
  if (color !== "b") throw new HttpError(403, "Only black can confirm the second deposit");
  assertWsolEscrowLane(row);
  assertWagerTerms(row, terms);

  const signature = await verifyEscrowTransition("black_deposit", row, body);
  const now = nowIso();
  const clock = initialClockState(
    now,
    Number(row.clock_initial_ms ?? wagerClockConfig().clockMs),
    Number(row.clock_increment_ms ?? wagerClockConfig().incrementMs),
  );
  let update = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      status: "active",
      payment_status: "both_deposited",
      black_deposit_signature: signature,
      settlement_status: "none",
      updated_at: now,
      ...clock,
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("payment_status", "black_prepared")
    .eq("settlement_status", "none")
    .eq("black_wallet_address", walletAddress)
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .select(gameColumns));

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Black deposit state changed before confirmation");
  await markLobbyForGame((data as PvpGameRow).id, "active");

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleListWagerRecovery(body: RefereeRequest) {
  const walletAddress = await requireWalletProof(body, "list_wager_recovery", null);
  const recoveryQuery = guardWsolEscrowLane(admin
    .from("pvp_games")
    .select(gameColumns)
    .eq("white_wallet_address", walletAddress)
    .eq("status", "waiting")
    .in("payment_status", recoverableOrphanPaymentStatuses)
    .is("black_session_id", null)
    .not("escrow_contest_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(20));

  const { data, error } = await recoveryQuery;

  if (error) throw error;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const recoverable = [];
  for (const row of (data ?? []) as PvpGameRow[]) {
    const snapshot = await maybeEscrowSnapshot(row);
    const stakeRaw = BigInt(normalizeRawAmount(row.wager_stake_raw));
    if (!snapshot || snapshot.vaultAmount < stakeRaw) continue;
    if (!snapshot.contest.creator.equals(publicKey(walletAddress, "walletAddress"))) continue;
    if (!snapshot.contest.joiner.equals(publicKey(defaultPubkey, "empty joiner"))) continue;

    recoverable.push({
      gameId: row.id,
      contestId: requireString(row.escrow_contest_id, "escrow_contest_id"),
      stakeLamports: stakeRaw.toString(),
      assetMint: requireString(row.wager_asset_mint, "wager_asset_mint"),
      assetSymbol: row.wager_asset_symbol ?? "SOL",
      assetDecimals: row.wager_asset_decimals ?? 9,
      whiteWalletAddress: walletAddress,
      blackWalletAddress: row.black_wallet_address ?? null,
      paymentStatus: row.payment_status ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      contestAddress: snapshot.contestAddress.toBase58(),
      vaultAddress: snapshot.vaultAddress.toBase58(),
      vaultAmount: snapshot.vaultAmount.toString(),
      escrowState: snapshot.contest.state,
      expiresAt: snapshot.contest.expiresAt.toString(),
      canRefund: snapshot.contest.state === 0 && snapshot.contest.expiresAt <= BigInt(nowSeconds),
    });
  }

  return { ok: true, recoverable };
}

async function handleRecoverOrphanedWagerRefund(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const walletAddress = await requireWalletProof(body, "recover_orphaned_wager_refund", gameId);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);

  if (row.white_wallet_address !== walletAddress) throw new HttpError(403, "Wallet address does not own this wager");
  if (row.status !== "waiting") throw new HttpError(409, "Only waiting orphaned wagers can be recovered");
  if (row.black_session_id || row.black_wallet_address) throw new HttpError(409, "Matched wagers cannot use orphan recovery");
  if (!recoverableOrphanPaymentStatuses.includes(String(row.payment_status))) {
    throw new HttpError(409, "Wager is not in an orphan-recoverable payment state");
  }
  assertWsolEscrowLane(row);
  assertWagerTerms(row, terms);
  assertRefundOpen(row);

  const signature = await verifyEscrowTransition("white_refund", row, body).catch(async (error) => {
    if (optionalTxSignature(body)) await markRefundRetryable(row, error);
    throw error;
  });
  const now = nowIso();

  let update = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      status: "cancelled",
      payment_status: "refunded",
      refund_status: "refunded",
      refund_signature: signature,
      refund_error: null,
      refunded_at: now,
      cancelled_at: now,
      rent_reclaim_status: "pending",
      rent_reclaim_signature: null,
      rent_reclaimed_at: null,
      rent_recipient_address: row.rent_recipient_address ?? row.white_wallet_address,
      escrow_onchain_state: "refunded",
      escrow_checked_at: now,
      clock_turn: null,
      clock_last_started_at: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("white_wallet_address", walletAddress)
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .is("black_session_id", null)
    .in("payment_status", recoverableOrphanPaymentStatuses)
    .select(gameColumns));

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Wager recovery state changed before confirmation");

  return { ok: true, refundSignature: signature, game: publicGame(data as PvpGameRow) };
}

async function handleListRobinhoodGames(body: RefereeRequest) {
  const walletAddress = await requireWalletProof(body, "list_robinhood_games", null);
  if (!/^0x[0-9a-f]{40}$/.test(walletAddress)) throw new HttpError(400, "Connect an EVM wallet");
  let query = admin.from("pvp_games").select(gameColumns)
    .eq("payment_mode", "robinhood_eth_escrow").eq("wager_asset_kind", "native_eth")
    .or(`white_wallet_address.eq.${walletAddress},black_wallet_address.eq.${walletAddress}`)
    .order("created_at", { ascending: false }).limit(50);
  if (body.before) {
    const before = Date.parse(body.before);
    if (!Number.isFinite(before)) throw new HttpError(400, "Invalid recovery cursor");
    query = query.lt("created_at", new Date(before).toISOString());
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as PvpGameRow[];
  return {
    ok: true,
    games: rows.map((row) => ({ gameId: row.id, contestId: row.escrow_contest_id,
      color: robinhoodRecoveryColor(row, walletAddress), stakeWei: row.wager_stake_raw,
      status: row.status, paymentStatus: row.payment_status, createdAt: row.created_at,
      escrowAddress: escrowForRow(row), payoutMode: row.payout_mode, payoutStatus: row.auto_payout_status, payoutSignature: row.auto_payout_signature, payoutAmount: row.auto_payout_amount,
      whiteDepositHash: row.white_deposit_signature, blackDepositHash: row.black_deposit_signature })),
    nextCursor: rows.length === 50 ? rows[rows.length - 1].created_at : null,
  };
}

async function handleRecoverRobinhoodSeat(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const walletAddress = await requireWalletProof(body, "recover_robinhood_seat", gameId);
  const row = await fetchGame(gameId);
  const color = robinhoodRecoveryColor(row, walletAddress);
  if (!color) throw new HttpError(403, "This wallet does not own a seat in this match");
  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);
  const prefix = color === "w" ? "white" : "black";
  // A fresh wallet proof authorizes replacing this wallet's old browser credential.
  // Never change the opponent, match result, clocks, or payment state.
  let update = admin.from("pvp_games")
    .update(color === "w"
      ? { white_session_id: sessionId, white_player_token_hash: tokenHash, updated_at: nowIso() }
      : { black_session_id: sessionId, black_player_token_hash: tokenHash, updated_at: nowIso() })
    .eq("id", gameId).eq(`${prefix}_wallet_address`, walletAddress).select(gameColumns);
  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Match changed during recovery. Please try again.");
  return { gameId, color, playerToken, game: publicGame(data as PvpGameRow) };
}

async function handleCancelWagerWaiting(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const walletAddress = await requireWalletProof(body, "cancel_wager_waiting", gameId);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  const color = await tokenColor(row, playerToken);
  const cancellableStatuses = ["white_prepared", "white_deposited", "black_prepared"];

  if (color !== "w") throw new HttpError(403, "Only white can cancel a waiting wager");
  assertWagerIdentity(row, { color, sessionId, walletAddress, expectedStatus: "waiting" });
  if (!cancellableStatuses.includes(String(row.payment_status))) {
    throw new HttpError(409, "Wager cannot be cancelled from this payment state");
  }
  assertWsolEscrowLane(row);
  assertWagerTerms(row, terms);
  assertRefundOpen(row);

  const refundSignature = row.payment_status === "white_prepared"
    ? null
    : await verifyEscrowTransition("white_refund", row, body).catch(async (error) => {
      if (optionalTxSignature(body)) await markRefundRetryable(row, error);
      throw error;
    });
  const now = nowIso();
  const cancelCount = await countCancelledBySession(row.white_session_id).catch(() => 0) + 1;
  const suspicious = buildSuspiciousUpdate(row, {
    queueCancelCount: cancelCount,
    abandonmentCount: cancelCount,
  });

  let update = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      status: "cancelled",
      payment_status: "cancelled",
      refund_status: refundSignature ? "refunded" : "none",
      refund_signature: refundSignature,
      refund_error: null,
      refunded_at: refundSignature ? now : null,
      cancelled_at: now,
      rent_reclaim_status: refundSignature ? "pending" : "not_applicable",
      rent_reclaim_signature: null,
      rent_reclaimed_at: null,
      rent_recipient_address: refundSignature ? row.rent_recipient_address ?? row.white_wallet_address : row.rent_recipient_address ?? null,
      escrow_onchain_state: refundSignature ? "refunded" : "not_created",
      escrow_checked_at: now,
      clock_turn: null,
      clock_last_started_at: null,
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "waiting")
    .eq("white_wallet_address", walletAddress)
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .in("payment_status", cancellableStatuses)
    .select(gameColumns));

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Wager cancel state changed before confirmation");
  await markLobbyForGame((data as PvpGameRow).id, "cancelled");
  if (suspicious) {
    await logAbuseEvent({
      sessionId: row.white_session_id,
      gameId: row.id,
      walletAddress,
      action: "cancel_wager_waiting",
      eventType: suspicious.flags[0] ?? "queue_cancel_churn",
      severity: "warning",
      evidence: { cancelCount },
    });
  }

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleRequestWagerRefund(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const walletAddress = await requireWalletProof(body, "request_wager_refund", gameId);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  const color = await tokenColor(row, playerToken);

  assertWagerIdentity(row, { color, sessionId, walletAddress });
  assertWsolEscrowLane(row);
  assertWagerTerms(row, terms);
  assertRefundOpen(row);
  if (row.payment_status !== "both_deposited") {
    throw new HttpError(409, "Only fully funded wagers can use expired refund");
  }
  if (row.status !== "active") {
    throw new HttpError(409, "Only active stale wagers can be refunded by players");
  }

  const timeoutMs = numberEnv("PVP_WAGER_ACTIVE_REFUND_TIMEOUT_MS", 30 * 60 * 1000);
  const updatedAt = row.updated_at ? Date.parse(row.updated_at) : 0;
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    throw new HttpError(409, "Wager timestamp is invalid for player refund");
  }
  if (Date.now() - updatedAt < timeoutMs) {
    throw new HttpError(409, "Wager is not old enough for player refund");
  }

  const signature = await verifyEscrowTransition("white_refund", row, body).catch(async (error) => {
    if (optionalTxSignature(body)) await markRefundRetryable(row, error);
    throw error;
  });
  const now = nowIso();

  let update = guardWsolEscrowLane(admin
    .from("pvp_games")
    .update({
      status: "cancelled",
      payment_status: "refunded",
      refund_status: "refunded",
      refund_signature: signature,
      refund_error: null,
      refunded_at: now,
      rent_reclaim_status: "pending",
      rent_reclaim_signature: null,
      rent_reclaimed_at: null,
      rent_recipient_address: row.rent_recipient_address ?? row.white_wallet_address,
      escrow_onchain_state: "refunded",
      escrow_checked_at: now,
      clock_turn: null,
      clock_last_started_at: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "active")
    .eq("payment_status", "both_deposited")
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .select(gameColumns));

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Wager refund state changed before confirmation");

  return { ok: true, refundSignature: signature, game: publicGame(data as PvpGameRow) };
}

async function handleClaimTimeout(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);
  if (!color) throw new HttpError(403, "You are not a player in this game");

  const wagerGame = isWagerRow(row);
  let walletAddress: string | null = null;
  if (wagerGame) {
    walletAddress = await requireWalletProof(body, "claim_timeout", gameId);
    assertWagerIdentity(row, {
      color,
      sessionId,
      walletAddress,
      expectedStatus: "active",
      expectedPaymentStatus: "both_deposited",
      expectedSettlementStatus: "none",
    });
  } else {
    const expectedSessionId = color === "w" ? row.white_session_id : row.black_session_id;
    if (expectedSessionId !== sessionId) throw new HttpError(403, "Session does not own this seat");
  }

  const now = nowIso();
  const timeout = claimTimeoutClock(row, color as PlayerColor, now);
  const resultHash = wagerGame
    ? await refereeResultHash(row, {
      winner: timeout.winner,
      reason: timeout.result_reason,
    })
    : null;
  const timeoutWins = await countFinishedSameOpponentWins(row, timeout.winner, "timeout").catch(() => 1);
  const suspicious = buildSuspiciousUpdate(row, {
    status: "finished",
    winner: timeout.winner,
    resultReason: timeout.result_reason,
    timeoutWins,
    sameOpponentWins: timeoutWins,
  });
  let update = admin
    .from("pvp_games")
    .update({
      status: "finished",
      winner: timeout.winner,
      result_reason: timeout.result_reason,
      timeout_claimed_at: timeout.timeout_claimed_at,
      finished_at: now,
      white_clock_ms: timeout.white_clock_ms,
      black_clock_ms: timeout.black_clock_ms,
      clock_turn: timeout.clock_turn,
      clock_last_started_at: timeout.clock_last_started_at,
      ...(wagerGame && {
        referee_result_hash: resultHash,
        settlement_status: "pending",
      }),
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "active")
    .eq("clock_turn", row.clock_turn)
    .select(gameColumns);

  if (wagerGame) {
    update = update
      .eq("payment_status", "both_deposited")
      .eq("settlement_status", "none");
  }

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Timeout state changed before claim");
  if (suspicious) {
    await logAbuseEvent({
      sessionId: body.sessionId,
      gameId: row.id,
      walletAddress: walletAddress ?? undefined,
      action: "claim_timeout",
      eventType: suspicious.flags[0] ?? "timeout_abuse",
      severity: "warning",
      evidence: { timeoutWins },
    });
  }

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleSettleFinishedWager(body: RefereeRequest) {
  if (!boolEnv("PVP_WAGER_SETTLEMENT_ENABLED")) {
    throw new HttpError(503, "Wager settlement is disabled");
  }
  await requireServiceAction(body);

  const gameId = requireString(body.gameId, "gameId");
  const walletAddress = normalizeWalletAddress(body.walletAddress);
  const requestedPaymentMode = requestPaymentMode(body);
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  const maybeSignature = optionalTxSignature(body);

  if (
    row.settlement_status === "settled" &&
    row.payment_status === "settled" &&
    row.settlement_signature &&
    (!maybeSignature || row.settlement_signature === maybeSignature)
  ) {
    assertWagerTerms(row, terms);
    if (rowPaymentMode(row) !== requestedPaymentMode) throw new HttpError(409, "Wager payment mode mismatch");
    if (requestedPaymentMode === "wsol_escrow" || requestedPaymentMode === "robinhood_eth_escrow") {
      assertWsolEscrowLane(row);
    } else if (row.wager_asset_kind !== "native_sol") {
      throw new HttpError(409, "Wager asset kind mismatch");
    }
    return { ok: true, game: publicGame(row) };
  }

  if (row.status !== "finished") throw new HttpError(409, "Only finished wagers can be settled");
  if (row.payment_status !== "both_deposited") throw new HttpError(409, "Wager deposits are not complete");
  if (!row.winner) throw new HttpError(409, "Finished wager has no result");
  if (!["pending", "failed"].includes(String(row.settlement_status))) {
    throw new HttpError(409, "Wager settlement is not pending");
  }
  assertSettlementOpen(row);
  assertWagerTerms(row, terms);
  if (rowPaymentMode(row) !== requestedPaymentMode) throw new HttpError(409, "Wager payment mode mismatch");
  if (requestedPaymentMode === "wsol_escrow" || requestedPaymentMode === "robinhood_eth_escrow") {
    assertWsolEscrowLane(row);
  } else if (row.wager_asset_kind !== "native_sol") {
    throw new HttpError(409, "Wager asset kind mismatch");
  }
  const resultHash = await refereeResultHash(row);
  if (!row.referee_result_hash) {
    throw new HttpError(409, "Referee result hash is missing");
  }
  if (row.referee_result_hash !== resultHash) {
    throw new HttpError(409, "Referee result hash does not match the stored game result");
  }

  const expectedWinnerWallet = row.winner === "w"
    ? row.white_wallet_address
    : row.winner === "b"
      ? row.black_wallet_address
      : null;
  if (expectedWinnerWallet && expectedWinnerWallet !== walletAddress) {
    throw new HttpError(403, "Settlement wallet does not match winner");
  }
  if (!expectedWinnerWallet && walletAddress !== row.white_wallet_address && walletAddress !== row.black_wallet_address) {
    throw new HttpError(403, "Settlement wallet is not a wager participant");
  }

  const signature = await (
    requestedPaymentMode === "native_sol_sponsored"
      ? verifyNativeSponsoredSettlement(row, body)
      : verifyEscrowTransition("settle_finished", row, body)
  ).catch(async (error) => {
    if (optionalTxSignature(body)) await markSettlementRetryable(row, error);
    throw error;
  });
  const settledAt = nowIso();
  const rentReclaimStatus = requestedPaymentMode === "native_sol_sponsored"
    ? requestRentReclaimStatus(body)
    : requestedPaymentMode === "robinhood_eth_escrow" ? "not_applicable" : "pending";
  const nativeRentReclaimed = requestedPaymentMode === "native_sol_sponsored" && rentReclaimStatus === "reclaimed";

  let update = admin
    .from("pvp_games")
    .update({
      payment_status: "settled",
      payment_mode: requestedPaymentMode,
      settlement_status: "settled",
      settlement_signature: signature,
      result_hash: resultHash,
      settlement_attempted_at: settledAt,
      settlement_retry_count: Number(row.settlement_retry_count ?? 0) + 1,
      settlement_last_error: null,
      settlement_settled_at: settledAt,
      ...(row.payout_mode === "automatic_rblx" && expectedWinnerWallet ? { auto_payout_status: "pending" } : {}),
      rent_reclaim_status: rentReclaimStatus,
      rent_reclaim_signature: requestedPaymentMode === "native_sol_sponsored"
        ? (body.rentReclaimSignature ?? signature)
        : null,
      rent_reclaimed_at: nativeRentReclaimed
        ? settledAt
        : row.rent_reclaimed_at ?? null,
      rent_recipient_address: requestedPaymentMode === "wsol_escrow"
        ? row.rent_recipient_address ?? row.white_wallet_address
        : row.rent_recipient_address ?? null,
      escrow_onchain_state: nativeRentReclaimed
        ? "closed"
        : "settled",
      escrow_checked_at: settledAt,
      updated_at: settledAt,
    })
    .eq("id", row.id)
    .eq("status", "finished")
    .eq("payment_status", "both_deposited")
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .in("settlement_status", ["pending", "failed"])
    .select(gameColumns);

  update = requestedPaymentMode === "native_sol_sponsored"
    ? update.eq("payment_mode", "native_sol_sponsored").eq("wager_asset_kind", "native_sol")
    : requestedPaymentMode === "robinhood_eth_escrow"
      ? update.eq("payment_mode", "robinhood_eth_escrow").eq("wager_asset_kind", "native_eth")
      : guardWsolEscrowLane(update);

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Wager settlement state changed before confirmation");

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

function payoutResponse(row: PvpGameRow, color: "w" | "b") {
  if (rowPaymentMode(row) !== "robinhood_eth_escrow") return {};
  return { escrowAddress: escrowForRow(row), payoutMode: row.payout_mode ?? "eth_claim",
    minimumRblxOut: color === "w" ? row.white_minimum_rblx : row.black_minimum_rblx };
}

function payoutRowFields(terms: { escrowAddress?: string; payoutMode?: string; minimumRblxOut?: string }) {
  if (!terms.escrowAddress) return {};
  return { robinhood_escrow_address: terms.escrowAddress, payout_mode: terms.payoutMode,
    white_minimum_rblx: terms.minimumRblxOut ?? null };
}

async function automaticEntryTerms(body: RefereeRequest, walletAddress: string, row?: PvpGameRow): Promise<{ escrowAddress?: string; payoutMode?: string; minimumRblxOut?: string }> {
  if ((row ? rowPaymentMode(row) : body.paymentMode) !== "robinhood_eth_escrow") return {};
  const automatic = row ? row.payout_mode === "automatic_rblx" : boolEnv("PVP_AUTOMATIC_RBLX_PAYOUT_ENABLED");
  if (!automatic) return { escrowAddress: row ? escrowForRow(row) : configuredRobinhoodEscrow(), payoutMode: "eth_claim" };
  const escrowAddress = row ? escrowForRow(row) : configuredAutomaticEscrow();
  if (body.payoutAuthorization?.accepted !== true) throw new HttpError(400, "Review and authorize the automatic RBLX payout before depositing.");
  try {
    const authorization = await verifyRblxAuthorization(body.payoutAuthorization.token, serviceRoleKey ?? "", {
      walletAddress, escrowAddress, stakeWei: normalizeRawAmount(row?.wager_stake_raw ?? body.stakeRaw ?? body.stakeLamports),
    });
    return { escrowAddress, payoutMode: "automatic_rblx", minimumRblxOut: authorization.minimumRblxOut };
  } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid payout authorization"); }
}

async function handleRblxEntryQuote(body: RefereeRequest) {
  const gameId = body.gameId || null;
  // This session grants quote reads only. Match preparation and deposits still
  // require their own wallet proofs and transaction-specific authorization.
  const walletAddress = requireString(body.walletAddress, "walletAddress");
  const sessionId = requireString(body.sessionId, "sessionId");
  let quoteSession: QuoteSession;
  if (body.quoteSessionToken) {
    try { quoteSession = await verifyQuoteSession(body.quoteSessionToken, serviceRoleKey ?? "", { walletAddress, sessionId }); }
    catch { throw new HttpError(403, "Quote session expired. Continue to reconnect it in your wallet.", "quote_session_expired"); }
  } else {
    await requireWalletProof(body, "get_rblx_entry_quote", gameId);
    if (body.playTermsVersion !== PLAY_TERMS_VERSION || body.stockTokenEligibilityAttested !== true || body.uniswapTermsAccepted !== true) {
      throw new HttpError(400, "Review the current play terms and Stock Token eligibility before continuing.", "play_terms_required");
    }
    const acceptedAt = new Date().toISOString();
    const { error: consentError } = await admin.from("pvp_play_consents").upsert({
      wallet_address: walletAddress.toLowerCase(), terms_version: PLAY_TERMS_VERSION,
      accepted_at: acceptedAt, session_id: sessionId, stock_token_eligibility_attested: true,
    }, { onConflict: "wallet_address,terms_version", ignoreDuplicates: true });
    if (consentError) throw new HttpError(503, "Could not save your terms acceptance. No deposit was requested.");
    quoteSession = { purpose: "rblx_quote_only", version: PLAY_TERMS_VERSION, walletAddress,
      sessionId, acceptedAt, expiresAt: new Date(Date.now() + QUOTE_SESSION_TTL_MS).toISOString() };
  }
  const { data: consent, error: consentReadError } = await admin.from("pvp_play_consents")
    .select("accepted_at").eq("wallet_address", walletAddress.toLowerCase()).eq("terms_version", PLAY_TERMS_VERSION).maybeSingle();
  if (consentReadError) throw new HttpError(503, "Could not verify saved terms. Try again shortly.");
  if (!consent) throw new HttpError(403, "Review the current play terms again.", "play_terms_required");
  const row = gameId ? await fetchGame(gameId) : null;
  if (row && rowPaymentMode(row) !== "robinhood_eth_escrow") throw new HttpError(409, "This is not a Robinhood ETH wager.");
  if (row && row.payout_mode !== "automatic_rblx") return { payoutMode: "eth_claim" };
  if (!row && !boolEnv("PVP_AUTOMATIC_RBLX_PAYOUT_ENABLED")) return { payoutMode: "eth_claim" };
  if (body.uniswapTermsAccepted !== true) throw new HttpError(400, "Accept Uniswap terms before requesting a quote.");
  const terms = configuredWagerTerms({ ...body, paymentMode: "robinhood_eth_escrow", assetMint: ROBINHOOD_NATIVE_ETH });
  if (row && terms.stakeRaw !== row.wager_stake_raw) throw new HttpError(409, "Invite stake does not match the match.");
  const escrowAddress = row ? escrowForRow(row) : configuredAutomaticEscrow();
  const apiKey = Deno.env.get("UNISWAP_API_KEY")?.trim();
  if (!apiKey) throw new HttpError(503, "RBLX conversion is not configured.");
  const quote = await buildRblxSwapQuote({ apiKey, walletAddress, payoutWei: BigInt(terms.stakeRaw) * 2n, slippageBps: 100 });
  const payload: RblxEntryAuthorization = { version: 1, chainId: 4663, escrowAddress, walletAddress,
    stakeWei: terms.stakeRaw, minimumRblxOut: quote.minimumRblxOut, quotedRblxOut: quote.quotedRblxOut,
    expiresAt: quote.expiresAt, fallbackSeconds: 900 };
  return { ...payload, payoutMode: "automatic_rblx", token: await signRblxAuthorization(payload, serviceRoleKey ?? ""),
    quoteSessionToken: await signQuoteSession(quoteSession, serviceRoleKey ?? ""),
    quoteSessionExpiresAt: quoteSession.expiresAt, termsVersion: PLAY_TERMS_VERSION, termsAcceptedAt: consent.accepted_at };
}

async function handleAutomaticRblxQuote(body: RefereeRequest) {
  await requireServiceAction(body);
  const row = await fetchGame(requireString(body.gameId, "gameId"));
  if (row.payout_mode !== "automatic_rblx" || row.status !== "finished" || row.settlement_status !== "settled" || !["w", "b"].includes(row.winner || "")) throw new HttpError(409, "Automatic prize is not ready.");
  const walletAddress = requireString(row.winner === "w" ? row.white_wallet_address : row.black_wallet_address, "winnerWallet");
  const escrowAddress = escrowForRow(row);
  const client = createPublicClient({ transport: http(Deno.env.get("ROBINHOOD_RPC_URL") || "https://rpc.mainnet.chain.robinhood.com") });
  if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) throw new HttpError(503, "Wrong payout network.");
  const contest = await client.readContract({ address: escrowAddress, abi: robinhoodEscrowAbi, functionName: "getContest", args: [robinhoodContestKey(row.escrow_contest_id!)] });
  if (contest.state !== 3 || contest.winner.toLowerCase() !== walletAddress.toLowerCase() || contest.stake !== BigInt(row.wager_stake_raw!)) throw new HttpError(409, "On-chain prize does not match the game.");
  const apiKey = Deno.env.get("UNISWAP_API_KEY")?.trim();
  if (!apiKey) throw new HttpError(503, "RBLX conversion is not configured.");
  return buildRblxSwapQuote({ apiKey, walletAddress, swapperAddress: escrowAddress, payoutWei: contest.stake * 2n, slippageBps: 100 });
}

async function handleRblxSwapQuote(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const walletAddress = await requireWalletProof(body, "get_rblx_swap_quote", gameId);
  const playerToken = requireString(body.playerToken, "playerToken");
  const claimTransactionHash = requireString(body.claimTransactionHash, "claimTransactionHash");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);
  const expectedWallet = color === "w" ? row.white_wallet_address : color === "b" ? row.black_wallet_address : null;
  if (!expectedWallet || expectedWallet !== walletAddress) throw new HttpError(403, "Wallet does not match this player");
  if (rowPaymentMode(row) !== "robinhood_eth_escrow" || row.wager_asset_kind !== "native_eth") {
    throw new HttpError(409, "Game is not a Robinhood Chain ETH wager");
  }
  if (row.status !== "finished" || row.settlement_status !== "settled" || row.payment_status !== "settled") {
    throw new HttpError(409, "Prize is not ready to claim");
  }
  const winnerWallet = row.winner === "w" ? row.white_wallet_address : row.winner === "b" ? row.black_wallet_address : null;
  if (!winnerWallet || winnerWallet !== walletAddress) throw new HttpError(403, "Only the winner can choose RBLX");

  await verifyRobinhoodTransition("winner_claim", claimTransactionHash, {
    contestId: requireString(row.escrow_contest_id, "escrowContestId"),
    escrowAddress: row.robinhood_escrow_address,
    payoutMode: row.payout_mode,
    stakeRaw: normalizeRawAmount(row.wager_stake_raw),
    whiteWallet: requireString(row.white_wallet_address, "whiteWallet"),
    blackWallet: requireString(row.black_wallet_address, "blackWallet"),
    winnerWallet,
  });

  const apiKey = Deno.env.get("UNISWAP_API_KEY")?.trim();
  if (!apiKey) throw new HttpError(503, "RBLX conversion is not configured");
  if (body.uniswapTermsAccepted !== true) throw new HttpError(400, "Accept the Uniswap terms before requesting a swap quote.");
  try {
    const quote = await buildRblxSwapQuote({
      apiKey,
      walletAddress,
      payoutWei: BigInt(normalizeRawAmount(row.wager_stake_raw)) * 2n,
      slippageBps: Number(Deno.env.get("UNISWAP_RBLX_SLIPPAGE_BPS") || 100),
    });
    return { ...quote, gameId, claimTransactionHash };
  } catch (error) {
    if (error instanceof RblxQuoteError) throw new HttpError(error.status, error.message);
    throw error;
  }
}

async function handleReconcileSponsoredRent(body: RefereeRequest) {
  await requireServiceAction(body);

  const gameId = requireString(body.gameId, "gameId");
  const requestedPaymentMode = requestPaymentMode(body);
  if (requestedPaymentMode !== "native_sol_sponsored") throw new HttpError(409, "Only native sponsored wagers reclaim rent");

  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  assertWagerTerms(row, terms);
  if (rowPaymentMode(row) !== "native_sol_sponsored" || row.wager_asset_kind !== "native_sol") {
    throw new HttpError(409, "Wager is not native sponsored");
  }

  if (
    row.settlement_status === "settled" &&
    row.rent_reclaim_status === "reclaimed" &&
    row.escrow_onchain_state === "closed"
  ) {
    return { ok: true, game: publicGame(row) };
  }

  await verifyNativeSponsoredRentReclaim(row, body);

  const now = nowIso();
  const rentReclaimStatus = requestRentReclaimStatus(body);
  const contestClosed = body.contestClosed === true || rentReclaimStatus === "reclaimed";
  const signature = optionalTxSignature(body) ?? row.settlement_signature ?? row.rent_reclaim_signature ?? null;
  const updateValues: Record<string, unknown> = {
    rent_reclaim_status: contestClosed ? "reclaimed" : rentReclaimStatus,
    rent_reclaim_signature: contestClosed ? signature : row.rent_reclaim_signature ?? signature,
    rent_reclaimed_at: contestClosed ? now : row.rent_reclaimed_at ?? null,
    escrow_onchain_state: contestClosed ? "closed" : "open",
    escrow_checked_at: now,
    updated_at: now,
  };

  if (contestClosed && row.status === "finished" && row.payment_status === "both_deposited" && ["pending", "failed"].includes(String(row.settlement_status))) {
    updateValues.payment_status = "settled";
    updateValues.settlement_status = "settled";
    updateValues.settlement_signature = signature;
    updateValues.settlement_attempted_at = now;
    updateValues.settlement_settled_at = now;
    updateValues.settlement_last_error = null;
    updateValues.settlement_retry_count = Number(row.settlement_retry_count ?? 0) + 1;
  }

  let update = admin
    .from("pvp_games")
    .update(updateValues)
    .eq("id", row.id)
    .eq("payment_mode", "native_sol_sponsored")
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .select(gameColumns);

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Sponsored rent state changed before reconciliation");

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleReconcileContestRent(body: RefereeRequest) {
  await requireServiceAction(body);

  const requestedPaymentMode = requestPaymentMode(body);
  if (requestedPaymentMode === "native_sol_sponsored") {
    return handleReconcileSponsoredRent(body);
  }

  const gameId = requireString(body.gameId, "gameId");
  const row = await fetchGame(gameId);
  const terms = requestWagerTerms(body, row);
  assertWagerTerms(row, terms);
  assertWsolEscrowLane(row);
  if (rowPaymentMode(row) !== "wsol_escrow") throw new HttpError(409, "Wager payment mode mismatch");

  const signature = optionalTxSignature(body) ?? row.rent_reclaim_signature ?? null;
  if (row.rent_reclaim_status === "reclaimed" && row.escrow_onchain_state === "closed") {
    const suppliedSignature = optionalTxSignature(body);
    if (suppliedSignature && row.rent_reclaim_signature && suppliedSignature !== row.rent_reclaim_signature) {
      throw new HttpError(409, "wSOL rent reclaim signature mismatch");
    }
    return { ok: true, game: publicGame(row) };
  }

  const rentRecipientAddress = wsolRentRecipient(row, body);
  assertWsolRentReclaimable(row, rentRecipientAddress);
  await verifyWsolContestRentReclaim(row, body);

  const now = nowIso();
  const rentReclaimStatus = requestRentReclaimStatus(body);
  const contestClosed = body.contestClosed === true && body.vaultClosed !== false;
  if (rentReclaimStatus === "reclaimed" && !contestClosed) {
    throw new HttpError(409, "wSOL rent reclaim requires closed contest and vault proof");
  }
  const updateValues: Record<string, unknown> = {
    rent_reclaim_status: contestClosed ? "reclaimed" : rentReclaimStatus,
    rent_reclaim_signature: contestClosed ? signature : row.rent_reclaim_signature ?? signature,
    rent_reclaimed_at: contestClosed ? now : row.rent_reclaimed_at ?? null,
    rent_recipient_address: row.rent_recipient_address ?? rentRecipientAddress,
    escrow_onchain_state: contestClosed ? "closed" : row.escrow_onchain_state ?? "settled",
    escrow_checked_at: now,
    updated_at: now,
  };

  let update = admin
    .from("pvp_games")
    .update(updateValues)
    .eq("id", row.id)
    .eq("payment_mode", "wsol_escrow")
    .eq("wager_asset_kind", "spl_token")
    .eq("wager_asset_mint", terms.assetMint)
    .eq("wager_stake_raw", terms.stakeRaw)
    .eq("escrow_contest_id", terms.escrowContestId)
    .select(gameColumns);

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "wSOL rent state changed before reconciliation");

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleResign(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);
  if (!color) throw new HttpError(403, "You are not a player in this game");

  const expectedSessionId = color === "w" ? row.white_session_id : row.black_session_id;
  if (expectedSessionId !== sessionId) throw new HttpError(403, "Session does not own this seat");
  if (row.status !== "active" || !row.black_session_id) throw new HttpError(409, "Game is not active");

  const currentPly = row.moves?.length ?? 0;
  if (!Number.isInteger(body.expectedPly) || Number(body.expectedPly) < 0) {
    throw new HttpError(400, "Missing expectedPly");
  }
  if (body.expectedPly !== currentPly) {
    throw new HttpError(409, "Stale resign expectedPly");
  }

  const wagerGame = isWagerRow(row);
  if (wagerGame) {
    if (row.payment_status !== "both_deposited") throw new HttpError(409, "Wager deposits are not complete");
    if ((row.settlement_status ?? "none") !== "none") throw new HttpError(409, "Wager settlement is not open");
  }

  const now = nowIso();
  const winner: PlayerColor = color === "w" ? "b" : "w";
  const resultReason = "resignation";
  const resultHash = wagerGame
    ? await refereeResultHash(row, { winner, reason: resultReason })
    : null;
  const sameOpponentWins = await countFinishedSameOpponentWins(row, winner, resultReason).catch(() => 1);
  const resignationCount = await countResignationsBySession(color, sessionId).catch(() => 0) + 1;
  const suspicious = buildSuspiciousUpdate(row, {
    acceptedAt: now,
    nextMoveCount: currentPly,
    status: "finished",
    winner,
    resultReason,
    sameOpponentWins,
    abandonmentCount: resignationCount,
  });
  const clockSnapshot = isClockedRow(row) ? activeClockSnapshot(row, now) : null;

  let update = admin
    .from("pvp_games")
    .update({
      status: "finished",
      winner,
      result_reason: resultReason,
      finished_at: now,
      clock_turn: null,
      clock_last_started_at: null,
      ...(clockSnapshot && {
        white_clock_ms: clockSnapshot.white_clock_ms,
        black_clock_ms: clockSnapshot.black_clock_ms,
      }),
      ...(wagerGame && {
        settlement_status: "pending",
        referee_result_hash: resultHash,
      }),
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("status", "active")
    .select(gameColumns);

  if (wagerGame) {
    update = update
      .eq("payment_status", "both_deposited")
      .eq("settlement_status", "none");
  }

  update = guardUpdatedAt(update, row);
  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Game state changed before resignation was accepted");

  if (suspicious) {
    await logAbuseEvent({
      sessionId,
      gameId: row.id,
      walletAddress: color === "w" ? row.white_wallet_address : row.black_wallet_address,
      action: "resign",
      eventType: suspicious.flags[0] ?? "repeated_abandonment",
      severity: "warning",
      evidence: { flags: suspicious.flags, reason: suspicious.reason, resignationCount, sameOpponentWins },
    });
  }

  return { ok: true, game: publicGame(data as PvpGameRow) };
}

async function handleMove(body: RefereeRequest) {
  const gameId = requireString(body.gameId, "gameId");
  const sessionId = requireString(body.sessionId, "sessionId");
  const playerToken = requireString(body.playerToken, "playerToken");
  const row = await fetchGame(gameId);
  const color = await tokenColor(row, playerToken);
  if (!color) throw new HttpError(403, "You are not a player in this game");
  const expectedSessionId = color === "w" ? row.white_session_id : row.black_session_id;
  if (!expectedSessionId || expectedSessionId !== sessionId) {
    throw new HttpError(403, "Session does not own this game seat");
  }

  const idempotency = await beginMoveIdempotency(body, gameId);
  if (idempotency && "duplicate" in idempotency) return idempotency.payload;

  try {
  const acceptedAt = nowIso();
  const currentPly = row.moves?.length ?? 0;
  const move = validateMoveRequest({
    from: body.from,
    to: body.to,
    promotion: body.promotion,
    expectedPly: body.expectedPly,
    currentPly,
    maxPlies: numberEnv("PVP_MAX_PLIES", 300),
  });

  if (row.status !== "active" || !row.black_session_id) {
    throw new HttpError(409, "Game is not active");
  }

  const game = replayStoredMoves(row.moves);
  const moveResult = applyLegalMove(game, color, move);

  const nextMoves = game.history();
  const status: GameStatus = game.isGameOver() ? "finished" : "active";
  const winner = game.isCheckmate()
    ? game.turn() === "w" ? "b" : "w"
    : game.isDraw()
      ? "draw"
      : null;
  const wagerGame = isWagerRow(row);
  const clockedGame = isClockedRow(row);
  const clockUpdate = clockedGame
    ? applyAcceptedMoveClock(row, color, game.turn() as PlayerColor, acceptedAt, status === "finished")
    : null;
  const resultReason = game.isCheckmate()
    ? "checkmate"
    : game.isDraw()
      ? "draw"
      : row.result_reason ?? null;
  const resultHash = wagerGame && status === "finished"
    ? await refereeResultHash(row, { moves: nextMoves, winner, reason: resultReason })
    : null;
  const sameOpponentWins = status === "finished"
    ? await countFinishedSameOpponentWins(row, winner, resultReason).catch(() => 1)
    : 0;
  const suspicious = buildSuspiciousUpdate(row, {
    acceptedAt,
    nextMoveCount: nextMoves.length,
    status,
    winner,
    resultReason,
    sameOpponentWins,
    timeoutWins: resultReason === "timeout" ? sameOpponentWins : 0,
  });

  let update = admin
    .from("pvp_games")
    .update({
      moves: nextMoves,
      status,
      winner,
      updated_at: acceptedAt,
      accepted_move_count: nextMoves.length,
      last_accepted_move_at: acceptedAt,
      ...(status === "finished" && {
        finished_at: acceptedAt,
      }),
      ...(clockUpdate && {
        white_clock_ms: clockUpdate.white_clock_ms,
        black_clock_ms: clockUpdate.black_clock_ms,
        clock_turn: clockUpdate.clock_turn,
        clock_last_started_at: clockUpdate.clock_last_started_at,
      }),
      ...(suspicious && {
        suspicious_flags: suspicious.flags,
        suspicious_reason: suspicious.reason,
      }),
      ...(wagerGame && status === "finished" && {
        settlement_status: "pending",
        result_reason: resultReason,
        referee_result_hash: resultHash,
      }),
    })
    .eq("id", row.id)
    .select(gameColumns);

  if (wagerGame) {
    update = update
      .eq("payment_status", "both_deposited")
      .eq("settlement_status", "none");
  }
  if (clockedGame) update = update.eq("clock_turn", color);

  update = guardUpdatedAt(update, row);

  const { data, error } = await update.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(409, "Board changed before this move was accepted");

  const response = {
    ok: true,
    move: moveResult.san,
    game: publicGame(data as PvpGameRow),
  };
  if (suspicious) {
    await logAbuseEvent({
      sessionId,
      gameId: row.id,
      walletAddress: color === "w" ? row.white_wallet_address : row.black_wallet_address,
      action: "move",
      eventType: suspicious.flags[0] ?? "manual_review_required",
      severity: "warning",
      evidence: { flags: suspicious.flags, reason: suspicious.reason, sameOpponentWins },
    });
  }
  if (idempotency) await idempotency.complete(response);
  return response;
  } catch (error) {
    if (idempotency) await idempotency.abandon();
    throw error;
  }
}

async function routeRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) throw new HttpError(500, "Referee is not configured");
  const fingerprint = await requestFingerprint(req);

  const body = await req.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  }) as RefereeRequest;
  const action = body.action as RefereeSecurityAction | undefined;

  if (action === "init_session") {
    await enforceRateLimit("init_session", fingerprint, body, null);
    return jsonResponse(await handleInitSession(body, fingerprint));
  }

  let session: SessionContext | null = null;
  if (action && browserCallableActions.has(action)) {
    session = await requireSessionProof(body, fingerprint);
    await enforceRateLimit(action, fingerprint, body, session);
  } else if (
    action === "settle_finished_wager" ||
    action === "get_automatic_rblx_quote" ||
    action === "reconcile_contest_rent" ||
    action === "reconcile_sponsored_rent"
  ) {
    await requireServiceAction(body);
    await enforceRateLimit(action, fingerprint, body, null);
  }

  switch (body.action) {
    case "list_robinhood_games":
      return jsonResponse(await handleListRobinhoodGames(body));
    case "recover_robinhood_seat":
      return jsonResponse(await handleRecoverRobinhoodSeat(body));
    case "create_wallet_proof_challenge":
      return jsonResponse(await handleCreateWalletProofChallenge(body));
    case "submit_cpu_result":
      if (!session) throw new HttpError(403, "Invalid session proof", "missing_session");
      return jsonResponse(await handleSubmitCpuResult(body, session));
    case "list_cpu_leaderboard":
      return jsonResponse(await handleListCpuLeaderboard(body));
    case "get_game":
      return jsonResponse(await handleGetGame(body));
    case "join_queue":
      return jsonResponse(await handleJoinQueue(body));
    case "join_game":
      return jsonResponse(await handleJoinGame(body));
    case "create_lobby":
      return jsonResponse(await handleCreateLobby(body));
    case "list_lobbies":
      return jsonResponse(await handleListLobbies());
    case "join_lobby":
      return jsonResponse(await handleJoinLobby(body));
    case "cancel_lobby":
      return jsonResponse(await handleCancelLobby(body));
    case "heartbeat_lobby":
      return jsonResponse(await handleHeartbeatLobby(body));
    case "heartbeat":
      return jsonResponse(await handleHeartbeat(body));
    case "cancel_waiting":
      return jsonResponse(await handleCancelWaiting(body));
    case "prepare_wager_queue":
      return jsonResponse(await handlePrepareWagerQueue(body));
    case "prepare_wager_lobby":
      return jsonResponse(await handlePrepareWagerLobby(body));
    case "prepare_sponsored_wager":
      if (!session) throw new HttpError(403, "Invalid session proof", "missing_session");
      return jsonResponse(await handlePrepareSponsoredWager(body, session, fingerprint));
    case "confirm_white_deposit":
      return jsonResponse(await handleConfirmWhiteDeposit(body));
    case "confirm_sponsored_deposit":
      return jsonResponse(await handleConfirmSponsoredDeposit(body));
    case "prepare_black_deposit":
      return jsonResponse(await handlePrepareBlackDeposit(body));
    case "confirm_black_deposit":
      return jsonResponse(await handleConfirmBlackDeposit(body));
    case "cancel_wager_waiting":
      return jsonResponse(await handleCancelWagerWaiting(body));
    case "cancel_sponsored_wager":
      return jsonResponse(await handleCancelSponsoredWager(body));
    case "get_sponsored_wager_state":
      return jsonResponse(await handleGetSponsoredWagerState(body));
    case "get_robinhood_payout_mode": {
      const row = await fetchGame(requireString(body.gameId, "gameId"));
      if (rowPaymentMode(row) !== "robinhood_eth_escrow") throw new HttpError(409, "This is not an ETH wager.");
      return jsonResponse({ payoutMode: row.payout_mode ?? "eth_claim", stakeRaw: row.wager_stake_raw });
    }
    case "get_rblx_entry_quote":
      return jsonResponse(await handleRblxEntryQuote(body));
    case "get_automatic_rblx_quote":
      return jsonResponse(await handleAutomaticRblxQuote(body));
    case "get_rblx_swap_quote":
      return jsonResponse(await handleRblxSwapQuote(body));
    case "list_wager_recovery":
      return jsonResponse(await handleListWagerRecovery(body));
    case "recover_orphaned_wager_refund":
      return jsonResponse(await handleRecoverOrphanedWagerRefund(body));
    case "request_wager_refund":
      return jsonResponse(await handleRequestWagerRefund(body));
    case "claim_timeout":
      return jsonResponse(await handleClaimTimeout(body));
    case "settle_finished_wager":
      return jsonResponse(await handleSettleFinishedWager(body));
    case "reconcile_contest_rent":
      return jsonResponse(await handleReconcileContestRent(body));
    case "reconcile_sponsored_rent":
      return jsonResponse(await handleReconcileSponsoredRent(body));
    case "resign":
      return jsonResponse(await handleResign(body));
    case "move":
      return jsonResponse(await handleMove(body));
    default:
      throw new HttpError(400, "Unknown referee action");
  }
}

Deno.serve(async (req) => {
  try {
    return await routeRequest(req);
  } catch (error) {
    console.error(error);
    if (error instanceof RateLimitError) {
      return jsonResponse(
        { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
        error.status,
        { "Retry-After": String(error.retryAfterSeconds) },
      );
    }
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof WagerRuleError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof MoveIntegrityError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    if (error instanceof CpuLeaderboardValidationError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    console.error("Unexpected pvp-referee error", error);
    return jsonResponse({ error: "Unexpected referee error" }, 500);
  }
});
