import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { supabase } from "@/integrations/supabase/client";
import { publicPaymentConfig } from "@/lib/paymentConfig";
import { clearStoredPvpSession, ensurePvpSession, isInvalidPvpSessionError } from "@/lib/pvpSession";
import {
  buildCancelWsolContestTransaction,
  buildCreateWsolContestTransaction,
  buildRefundExpiredWsolContestTransaction,
  buildJoinWsolContestTransaction,
  EscrowInstructionFactory,
} from "@/lib/solanaWagerTransactions";
import { createConfiguredEscrowInstructionFactory } from "@/lib/escrowAnchorInstructions";
import { RefereeClientError } from "@/lib/refereeErrors";

type WagerDepositRole = "white" | "black";
export type WagerPaymentMode = "wsol_escrow" | "native_sol_sponsored" | "robinhood_eth_escrow";
type WagerAssetKind = "spl_token" | "native_sol" | "native_eth";

export interface PrepareWagerQueueRequest {
  sessionId: string;
  walletAddress: string;
  assetMint: string;
  tokenProgramId: string;
  stakeLamports: bigint;
  paymentMode: WagerPaymentMode;
  timeControl?: string;
  payoutAuthorization?: { token: string; accepted: true };
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}

export interface PrepareSponsoredWagerRequest {
  sessionId: string;
  walletAddress: string;
  stakeLamports: bigint;
  requestId: string;
  escrowContestId?: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}

export interface PrepareSponsoredWagerResponse {
  gameId: string;
  playerToken: string;
  color: "w" | "b";
  depositRole: WagerDepositRole;
  contestId: string;
  stakeLamports: string;
  assetMint: string;
  assetKind: WagerAssetKind;
  paymentMode: WagerPaymentMode;
  rentSponsorAddress: string;
  rentRecipientAddress: string;
}

export interface SponsoredWagerState {
  gameId: string;
  paymentMode: WagerPaymentMode | null;
  assetKind: WagerAssetKind | null;
  paymentStatus: string | null;
  settlementStatus: string | null;
  refundStatus: string | null;
  rentReclaimStatus: string | null;
  stakeRaw: string | null;
  assetMint: string | null;
  escrowContestId: string | null;
  whiteWalletAddress: string | null;
  blackWalletAddress: string | null;
  rentSponsorAddress: string | null;
  rentRecipientAddress: string | null;
}

export interface PrepareWagerQueueResponse {
  escrowAddress?: string;
  payoutMode?: string;
  minimumRblxOut?: string | null;
  gameId: string;
  playerToken: string;
  color: "w" | "b";
  depositRole: WagerDepositRole;
  contestId: string;
  stakeLamports: string;
  assetMint: string;
  assetKind?: WagerAssetKind;
  paymentMode?: WagerPaymentMode;
  rentSponsorAddress?: string;
  rentRecipientAddress?: string;
  sponsorSignerUrl?: string;
  sponsoredTransaction?: SponsoredWagerTransactionResponse;
}

export interface ConfirmWagerDepositResponse {
  ok: boolean;
  gameId: string;
  status: "queued" | "matched" | "active";
}

export interface WagerStateMutationResponse {
  ok: boolean;
  game?: Record<string, unknown>;
  refundSignature?: string;
  settlementSignature?: string;
  rentReclaimSignature?: string;
}

export interface RecoverableWager {
  gameId: string;
  contestId: string;
  stakeLamports: string;
  assetMint: string;
  assetSymbol?: string;
  assetDecimals?: number | string;
  whiteWalletAddress: string;
  blackWalletAddress: string | null;
  paymentStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  contestAddress: string;
  vaultAddress: string;
  vaultAmount: string;
  escrowState: number;
  expiresAt: string;
  canRefund: boolean;
}

export interface EnterWagerQueueArgs extends PrepareWagerQueueRequest {
  walletPublicKey: PublicKey;
  escrow?: EscrowInstructionFactory;
  sponsorSignerUrl?: string | null;
  signAndSendTransaction: (transaction: import("@solana/web3.js").Transaction) => Promise<string>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

export interface WalletProofFields {
  walletSignature: string;
  walletProofNonce: string;
  walletProofExpiresAt: string;
}

export interface SponsoredWagerTransactionResponse {
  serializedTransaction: string;
  expiresAt?: string;
  lastValidBlockHeight?: number;
  requestId?: string;
  gameId?: string;
  contestId?: string;
  stakeRaw?: string;
  escrowProgramId?: string;
  rentSponsorAddress?: string;
  rentRecipientAddress?: string;
}

declare global {
  interface Window {
    chessArenaEscrowInstructions?: EscrowInstructionFactory;
  }
}

export async function invokeWagerReferee<T>(body: Record<string, unknown>, retryInvalidSession = true): Promise<T> {
  const session = body.action === "settle_finished_wager" ? null : await ensurePvpSession();
  const requestBody = session
    ? {
      ...body,
      sessionId: session.sessionId,
      sessionProof: session.sessionProof,
    }
    : body;
  const { data, error } = await supabase.functions.invoke("pvp-referee", { body: requestBody });

  if (error) {
    let message = error.message || "Wager referee request failed";
    let code: string | undefined;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const responseBody = await context.clone().json();
        if (responseBody?.error) message = responseBody.error;
        if (responseBody?.code) code = String(responseBody.code);
      } catch {
        // Keep the SDK error when the Edge Function did not return JSON.
      }
    }
    if (retryInvalidSession && isInvalidPvpSessionError(code, message)) {
      clearStoredPvpSession();
      return invokeWagerReferee<T>(body, false);
    }
    throw new RefereeClientError(message, code);
  }

  if (data && typeof data === "object" && "error" in data) {
    const response = data as { error: unknown; code?: unknown };
    const message = String(response.error);
    const code = response.code ? String(response.code) : undefined;
    if (retryInvalidSession && isInvalidPvpSessionError(code, message)) {
      clearStoredPvpSession();
      return invokeWagerReferee<T>(body, false);
    }
    throw new RefereeClientError(message, code);
  }

  return data as T;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function sponsoredActionForRole(role: WagerDepositRole): "white_deposit" | "black_deposit" {
  return role === "white" ? "white_deposit" : "black_deposit";
}

function sponsorTransactionUrl(configuredUrl: string): string {
  const url = new URL(configuredUrl);
  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new RefereeClientError("Sponsored signer URL must use HTTPS.", "sponsor_url_invalid");
  }
  if (url.pathname === "/" || url.pathname === "") {
    return new URL("/wager/sponsored-transaction", url).toString();
  }
  return url.toString();
}

type SponsoredWagerAction = "white_deposit" | "black_deposit" | "cancel_waiting";

export interface SponsoredTransactionExpectation {
  action: SponsoredWagerAction;
  contestId: string;
  stakeLamports: bigint;
  walletAddress: string;
  rentSponsorAddress: string;
  rentRecipientAddress: string;
  escrowProgramId?: string | null;
  gameId?: string;
  rulesHash?: string;
  contestTtlSeconds?: number;
}

const DEFAULT_WAGER_GAME_ID = "chess-arena";
const DEFAULT_RULES_HASH = "chess-arena-v1";
const DEFAULT_CONTEST_TTL_SECONDS = 10 * 60;
const NATIVE_CONTEST_SEED = "native_contest";
const GAME_CONFIG_SEED = "game";
const GLOBAL_CONFIG_SEED = "global_config";
const SPONSOR_TRANSACTION_INVALID = "sponsor_transaction_invalid";

function failSponsoredTransaction(message: string): never {
  throw new RefereeClientError(message, SPONSOR_TRANSACTION_INVALID);
}

function seed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function seedHash(value: string): Uint8Array {
  return sha256(seed(value));
}

function discriminator(name: string): Buffer {
  return Buffer.from(sha256(seed(`global:${name}`))).subarray(0, 8);
}

function deriveNativeSponsoredAccounts(programId: PublicKey, gameId: string, contestId: string) {
  const globalConfig = PublicKey.findProgramAddressSync([seed(GLOBAL_CONFIG_SEED)], programId)[0];
  const gameConfig = PublicKey.findProgramAddressSync([seed(GAME_CONFIG_SEED), seedHash(gameId)], programId)[0];
  const nativeContest = PublicKey.findProgramAddressSync(
    [seed(NATIVE_CONTEST_SEED), gameConfig.toBytes(), seedHash(contestId)],
    programId,
  )[0];
  return { globalConfig, gameConfig, nativeContest };
}

function expectPublicKey(value: string | null | undefined, label: string): PublicKey {
  if (!value) failSponsoredTransaction(`Sponsored transaction is missing ${label}.`);
  try {
    return new PublicKey(value);
  } catch {
    failSponsoredTransaction(`Sponsored transaction has an invalid ${label}.`);
  }
}

function assertKey(
  actual: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean } | undefined,
  expected: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
  label: string,
): void {
  if (!actual || !actual.pubkey.equals(expected) || actual.isSigner !== isSigner || actual.isWritable !== isWritable) {
    failSponsoredTransaction(`Sponsored transaction has an unexpected ${label} account.`);
  }
}

function readAnchorString(data: Buffer, offset: { value: number }, label: string): string {
  if (offset.value + 4 > data.length) failSponsoredTransaction(`Sponsored transaction ${label} is malformed.`);
  const length = data.readUInt32LE(offset.value);
  offset.value += 4;
  if (length > 256 || offset.value + length > data.length) {
    failSponsoredTransaction(`Sponsored transaction ${label} is malformed.`);
  }
  const value = data.subarray(offset.value, offset.value + length).toString("utf8");
  offset.value += length;
  return value;
}

function readU64(data: Buffer, offset: { value: number }, label: string): bigint {
  if (offset.value + 8 > data.length) failSponsoredTransaction(`Sponsored transaction ${label} is malformed.`);
  const value = data.readBigUInt64LE(offset.value);
  offset.value += 8;
  return value;
}

function readI64(data: Buffer, offset: { value: number }, label: string): bigint {
  if (offset.value + 8 > data.length) failSponsoredTransaction(`Sponsored transaction ${label} is malformed.`);
  const value = data.readBigInt64LE(offset.value);
  offset.value += 8;
  return value;
}

function assertDiscriminator(data: Buffer, name: string): void {
  if (data.length < 8 || !data.subarray(0, 8).equals(discriminator(name))) {
    failSponsoredTransaction("Sponsored transaction uses an unexpected escrow instruction.");
  }
}

function assertSponsorSigners(transaction: Transaction, wallet: PublicKey, sponsor: PublicKey): void {
  const allowed = new Set([wallet.toBase58(), sponsor.toBase58()]);
  const signers = transaction.signatures.map((signature) => signature.publicKey.toBase58());
  if (!signers.includes(wallet.toBase58()) || !signers.includes(sponsor.toBase58())) {
    failSponsoredTransaction("Sponsored transaction does not require both sponsor and player signatures.");
  }
  if (signers.some((signer) => !allowed.has(signer))) {
    failSponsoredTransaction("Sponsored transaction requires an unexpected signer.");
  }
  const sponsorSignature = transaction.signatures.find((signature) => signature.publicKey.equals(sponsor));
  if (!sponsorSignature?.signature) {
    failSponsoredTransaction("Sponsored transaction is missing the sponsor signature.");
  }
}

function configuredContestTtlSeconds(): number {
  const configured = Number(import.meta.env.VITE_WAGER_CONTEST_TTL_SECONDS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CONTEST_TTL_SECONDS;
}

export function assertSponsoredWagerTransactionSafe(
  transaction: Transaction,
  expectation: SponsoredTransactionExpectation,
): void {
  const escrowProgramId = expectPublicKey(
    expectation.escrowProgramId ?? publicPaymentConfig.wager.escrowProgramId,
    "escrow program id",
  );
  const wallet = expectPublicKey(expectation.walletAddress, "wallet address");
  const sponsor = expectPublicKey(expectation.rentSponsorAddress, "rent sponsor address");
  const rentRecipient = expectPublicKey(expectation.rentRecipientAddress, "rent recipient address");
  const gameId = (expectation.gameId ?? import.meta.env.VITE_WAGER_GAME_ID?.trim()) || DEFAULT_WAGER_GAME_ID;
  const rulesHash = (expectation.rulesHash ?? import.meta.env.VITE_WAGER_RULES_HASH?.trim()) || DEFAULT_RULES_HASH;
  const contestTtlSeconds = expectation.contestTtlSeconds ?? configuredContestTtlSeconds();
  const accounts = deriveNativeSponsoredAccounts(escrowProgramId, gameId, expectation.contestId);

  if (!transaction.feePayer?.equals(sponsor)) {
    failSponsoredTransaction("Sponsored transaction fee payer does not match the rent sponsor.");
  }
  if (!transaction.recentBlockhash) {
    failSponsoredTransaction("Sponsored transaction is missing a recent blockhash.");
  }
  assertSponsorSigners(transaction, wallet, sponsor);
  if (transaction.instructions.length !== 1) {
    failSponsoredTransaction("Sponsored transaction must contain exactly one escrow instruction.");
  }

  const instruction = transaction.instructions[0];
  if (!instruction.programId.equals(escrowProgramId)) {
    failSponsoredTransaction("Sponsored transaction targets an unexpected program.");
  }
  const data = Buffer.from(instruction.data);

  if (expectation.action === "white_deposit") {
    if (instruction.keys.length !== 6) failSponsoredTransaction("White sponsored deposit has unexpected accounts.");
    assertKey(instruction.keys[0], accounts.globalConfig, false, false, "global config");
    assertKey(instruction.keys[1], accounts.gameConfig, false, false, "game config");
    assertKey(instruction.keys[2], accounts.nativeContest, false, true, "native contest");
    assertKey(instruction.keys[3], wallet, true, true, "player");
    assertKey(instruction.keys[4], sponsor, true, true, "rent sponsor");
    assertKey(instruction.keys[5], SystemProgram.programId, false, false, "system program");
    assertDiscriminator(data, "create_native_contest");
    const offset = { value: 8 };
    const contestId = readAnchorString(data, offset, "contest id");
    const stake = readU64(data, offset, "stake");
    const transactionRulesHash = readAnchorString(data, offset, "rules hash");
    const expiresAt = readI64(data, offset, "expiry");
    if (offset.value !== data.length) failSponsoredTransaction("White sponsored deposit has extra instruction data.");
    if (contestId !== expectation.contestId) failSponsoredTransaction("White sponsored deposit contest id mismatch.");
    if (stake !== expectation.stakeLamports) failSponsoredTransaction("White sponsored deposit stake mismatch.");
    if (transactionRulesHash !== rulesHash) failSponsoredTransaction("White sponsored deposit rules hash mismatch.");
    const maxExpiry = BigInt(Math.floor(Date.now() / 1000) + contestTtlSeconds + 300);
    if (expiresAt <= 0n || expiresAt > maxExpiry) {
      failSponsoredTransaction("White sponsored deposit expiry is outside the allowed window.");
    }
    return;
  }

  if (expectation.action === "black_deposit") {
    if (instruction.keys.length !== 5) failSponsoredTransaction("Black sponsored deposit has unexpected accounts.");
    assertKey(instruction.keys[0], accounts.globalConfig, false, false, "global config");
    assertKey(instruction.keys[1], accounts.gameConfig, false, false, "game config");
    assertKey(instruction.keys[2], accounts.nativeContest, false, true, "native contest");
    assertKey(instruction.keys[3], wallet, true, true, "player");
    assertKey(instruction.keys[4], SystemProgram.programId, false, false, "system program");
    assertDiscriminator(data, "join_native_contest");
    if (data.length !== 8) failSponsoredTransaction("Black sponsored deposit has extra instruction data.");
    return;
  }

  if (instruction.keys.length !== 3) failSponsoredTransaction("Sponsored cancel has unexpected accounts.");
  assertKey(instruction.keys[0], accounts.nativeContest, false, true, "native contest");
  assertKey(instruction.keys[1], wallet, true, true, "player");
  assertKey(instruction.keys[2], rentRecipient, false, true, "rent recipient");
  assertDiscriminator(data, "cancel_native_contest");
  if (data.length !== 8) failSponsoredTransaction("Sponsored cancel has extra instruction data.");
}

export async function signWalletProof(args: {
  action: string;
  sessionId?: string;
  gameId?: string | null;
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<WalletProofFields> {
  const session = await ensurePvpSession();
  const response = await invokeWagerReferee<{
    walletProof: {
      message: string;
      nonce: string;
      expiresAt: string;
    };
  }>({
    action: "create_wallet_proof_challenge",
    proofAction: args.action,
    sessionId: session.sessionId,
    gameId: args.gameId ?? undefined,
    walletAddress: args.walletAddress,
  });
  const signature = await args.signMessage(new TextEncoder().encode(response.walletProof.message));
  return {
    walletSignature: bytesToBase64(signature),
    walletProofNonce: response.walletProof.nonce,
    walletProofExpiresAt: response.walletProof.expiresAt,
  };
}

export function resolveBrowserEscrowFactory(): EscrowInstructionFactory | null {
  const browserOverride = typeof window === "undefined" ? null : window.chessArenaEscrowInstructions ?? null;
  return browserOverride ?? createConfiguredEscrowInstructionFactory();
}

export async function prepareWagerQueue(request: PrepareWagerQueueRequest): Promise<PrepareWagerQueueResponse> {
  return invokeWagerReferee<PrepareWagerQueueResponse>({
    action: request.paymentMode === "native_sol_sponsored" ? "prepare_sponsored_wager" : "prepare_wager_queue",
    ...request,
    stakeLamports: request.stakeLamports.toString(),
    stakeRaw: request.stakeLamports.toString(),
    walletSignature: request.walletSignature,
    walletProofNonce: request.walletProofNonce,
    walletProofExpiresAt: request.walletProofExpiresAt,
  });
}

export async function prepareWagerLobby(request: PrepareWagerQueueRequest): Promise<PrepareWagerQueueResponse> {
  return invokeWagerReferee<PrepareWagerQueueResponse>({
    action: "prepare_wager_lobby",
    ...request,
    stakeLamports: request.stakeLamports.toString(),
    stakeRaw: request.stakeLamports.toString(),
    walletSignature: request.walletSignature,
    walletProofNonce: request.walletProofNonce,
    walletProofExpiresAt: request.walletProofExpiresAt,
  });
}

export async function prepareWagerLobbyJoin(request: PrepareWagerQueueRequest & {
  gameId: string;
}): Promise<PrepareWagerQueueResponse & { game?: Record<string, unknown> }> {
  return invokeWagerReferee<PrepareWagerQueueResponse & { game?: Record<string, unknown> }>({
    action: "prepare_black_deposit",
    gameId: request.gameId,
    sessionId: request.sessionId,
    walletAddress: request.walletAddress,
    assetMint: request.assetMint,
    tokenProgramId: request.tokenProgramId,
    stakeLamports: request.stakeLamports.toString(),
    stakeRaw: request.stakeLamports.toString(),
    paymentMode: request.paymentMode,
    timeControl: request.timeControl,
    payoutAuthorization: request.payoutAuthorization,
    walletSignature: request.walletSignature,
    walletProofNonce: request.walletProofNonce,
    walletProofExpiresAt: request.walletProofExpiresAt,
  });
}

export async function prepareSponsoredWager(request: PrepareSponsoredWagerRequest): Promise<PrepareSponsoredWagerResponse> {
  return invokeWagerReferee<PrepareSponsoredWagerResponse>({
    action: "prepare_sponsored_wager",
    sessionId: request.sessionId,
    walletAddress: request.walletAddress,
    stakeLamports: request.stakeLamports.toString(),
    stakeRaw: request.stakeLamports.toString(),
    paymentMode: "native_sol_sponsored",
    assetKind: "native_sol",
    requestId: request.requestId,
    escrowContestId: request.escrowContestId,
    walletSignature: request.walletSignature,
    walletProofNonce: request.walletProofNonce,
    walletProofExpiresAt: request.walletProofExpiresAt,
  });
}

export async function requestSponsoredWagerTransaction(args: {
  signerUrl: string;
  action: "white_deposit" | "black_deposit" | "cancel_waiting";
  gameId: string;
  sessionId: string;
  playerToken: string;
  walletAddress: string;
  stakeLamports: bigint;
  requestId: string;
  expectedEscrowContestId?: string;
}): Promise<SponsoredWagerTransactionResponse> {
  const session = await ensurePvpSession();
  const response = await fetch(sponsorTransactionUrl(args.signerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: args.action,
      gameId: args.gameId,
      sessionId: session.sessionId,
      sessionProof: session.sessionProof,
      playerToken: args.playerToken,
      walletAddress: args.walletAddress,
      stakeRaw: args.stakeLamports.toString(),
      assetKind: "native_sol",
      requestId: args.requestId,
      requestedAtMs: Date.now(),
      expectedEscrowContestId: args.expectedEscrowContestId,
    }),
  });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = typeof payload?.code === "string" ? payload.code : undefined;
    const message = typeof payload?.error === "string" ? payload.error : "Sponsor service unavailable. Try again shortly.";
    throw new RefereeClientError(message, code);
  }

  const serialized =
    typeof payload?.serializedTransaction === "string"
      ? payload.serializedTransaction
      : typeof payload?.transaction === "string"
        ? payload.transaction
        : null;
  if (!serialized) {
    throw new RefereeClientError("Sponsor service returned no transaction.", "sponsor_unavailable");
  }

  return {
    serializedTransaction: serialized,
    expiresAt: typeof payload?.expiresAt === "string" ? payload.expiresAt : undefined,
    lastValidBlockHeight:
      typeof payload?.lastValidBlockHeight === "number" && Number.isSafeInteger(payload.lastValidBlockHeight)
        ? payload.lastValidBlockHeight
        : undefined,
    requestId: typeof payload?.requestId === "string" ? payload.requestId : args.requestId,
    gameId: typeof payload?.gameId === "string" ? payload.gameId : undefined,
    contestId: typeof payload?.contestId === "string" ? payload.contestId : undefined,
    stakeRaw: typeof payload?.stakeRaw === "string" ? payload.stakeRaw : undefined,
    escrowProgramId: typeof payload?.escrowProgramId === "string" ? payload.escrowProgramId : undefined,
    rentSponsorAddress: typeof payload?.rentSponsorAddress === "string" ? payload.rentSponsorAddress : undefined,
    rentRecipientAddress: typeof payload?.rentRecipientAddress === "string" ? payload.rentRecipientAddress : undefined,
  };
}

export async function confirmWagerDeposit(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  color: "w" | "b";
  transactionSignature: string;
  walletAddress: string;
  assetMint: string;
  stakeLamports: bigint;
  escrowContestId: string;
}): Promise<ConfirmWagerDepositResponse> {
  return invokeWagerReferee<ConfirmWagerDepositResponse>({
    action: args.color === "w" ? "confirm_white_deposit" : "confirm_black_deposit",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    transactionSignature: args.transactionSignature,
    walletAddress: args.walletAddress,
    assetMint: args.assetMint,
    stakeLamports: args.stakeLamports.toString(),
    stakeRaw: args.stakeLamports.toString(),
    escrowContestId: args.escrowContestId,
  });
}

export async function confirmSponsoredWagerDeposit(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  color: "w" | "b";
  transactionSignature: string;
  walletAddress: string;
  stakeLamports: bigint;
  escrowContestId: string;
  requestId: string;
}): Promise<ConfirmWagerDepositResponse> {
  return invokeWagerReferee<ConfirmWagerDepositResponse>({
    action: "confirm_sponsored_deposit",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    color: args.color,
    transactionSignature: args.transactionSignature,
    walletAddress: args.walletAddress,
    stakeLamports: args.stakeLamports.toString(),
    stakeRaw: args.stakeLamports.toString(),
    escrowContestId: args.escrowContestId,
    paymentMode: "native_sol_sponsored",
    assetKind: "native_sol",
    requestId: args.requestId,
  });
}

export async function cancelWagerWaiting(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  walletAddress: string;
  assetMint: string;
  stakeLamports: bigint;
  escrowContestId: string;
  transactionSignature?: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}): Promise<WagerStateMutationResponse> {
  return invokeWagerReferee<WagerStateMutationResponse>({
    action: "cancel_wager_waiting",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    walletAddress: args.walletAddress,
    assetMint: args.assetMint,
    stakeLamports: args.stakeLamports.toString(),
    stakeRaw: args.stakeLamports.toString(),
    escrowContestId: args.escrowContestId,
    transactionSignature: args.transactionSignature,
    walletSignature: args.walletSignature,
    walletProofNonce: args.walletProofNonce,
    walletProofExpiresAt: args.walletProofExpiresAt,
  });
}

export async function cancelSponsoredWager(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  walletAddress: string;
  stakeLamports: bigint;
  escrowContestId: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}): Promise<WagerStateMutationResponse> {
  return invokeWagerReferee<WagerStateMutationResponse>({
    action: "cancel_sponsored_wager",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    walletAddress: args.walletAddress,
    stakeLamports: args.stakeLamports.toString(),
    stakeRaw: args.stakeLamports.toString(),
    escrowContestId: args.escrowContestId,
    paymentMode: "native_sol_sponsored",
    assetKind: "native_sol",
    walletSignature: args.walletSignature,
    walletProofNonce: args.walletProofNonce,
    walletProofExpiresAt: args.walletProofExpiresAt,
  });
}

export async function getSponsoredWagerState(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
}): Promise<WagerStateMutationResponse> {
  return invokeWagerReferee<WagerStateMutationResponse>({
    action: "get_sponsored_wager_state",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    paymentMode: "native_sol_sponsored",
  });
}

export async function settleFinishedWager(args: {
  gameId: string;
  playerToken: string;
}): Promise<{ ok: boolean; settlementSignature?: string }> {
  return invokeWagerReferee({
    action: "settle_finished_wager",
    gameId: args.gameId,
    playerToken: args.playerToken,
  });
}

export async function requestWagerRefund(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  walletAddress: string;
  assetMint: string;
  stakeLamports: bigint;
  escrowContestId: string;
  transactionSignature: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}): Promise<WagerStateMutationResponse> {
  return invokeWagerReferee<WagerStateMutationResponse>({
    action: "request_wager_refund",
    gameId: args.gameId,
    sessionId: args.sessionId,
    playerToken: args.playerToken,
    walletAddress: args.walletAddress,
    assetMint: args.assetMint,
    stakeLamports: args.stakeLamports.toString(),
    stakeRaw: args.stakeLamports.toString(),
    escrowContestId: args.escrowContestId,
    transactionSignature: args.transactionSignature,
    walletSignature: args.walletSignature,
    walletProofNonce: args.walletProofNonce,
    walletProofExpiresAt: args.walletProofExpiresAt,
  });
}

export async function listRecoverableWagers(args: {
  walletAddress: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<RecoverableWager[]> {
  const walletProof = await signWalletProof({
    action: "list_wager_recovery",
    sessionId: "",
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  const response = await invokeWagerReferee<{ ok: boolean; recoverable: RecoverableWager[] }>({
    action: "list_wager_recovery",
    walletAddress: args.walletAddress,
    ...walletProof,
  });
  return response.recoverable;
}

export async function recoverOrphanedWagerRefund(args: {
  gameId: string;
  walletPublicKey: PublicKey;
  walletAddress: string;
  whiteWalletAddress: string;
  blackWalletAddress?: string | null;
  assetMint: string;
  tokenProgramId: string;
  stakeLamports: bigint;
  escrowContestId: string;
  escrow: EscrowInstructionFactory;
  signAndSendTransaction: (transaction: import("@solana/web3.js").Transaction) => Promise<string>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<WagerStateMutationResponse> {
  const transactionRequest = await buildRefundExpiredWsolContestTransaction({
    walletPublicKey: args.walletPublicKey,
    contestId: args.escrowContestId,
    stakeLamports: args.stakeLamports,
    mint: new PublicKey(args.assetMint),
    tokenProgramId: new PublicKey(args.tokenProgramId),
    creatorPublicKey: new PublicKey(args.whiteWalletAddress),
    joinerPublicKey: new PublicKey(args.blackWalletAddress ?? args.whiteWalletAddress),
    escrow: args.escrow,
  });
  const signature = await args.signAndSendTransaction(transactionRequest.transaction);
  const walletProof = await signWalletProof({
    action: "recover_orphaned_wager_refund",
    sessionId: "",
    gameId: args.gameId,
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  return invokeWagerReferee<WagerStateMutationResponse>({
    action: "recover_orphaned_wager_refund",
    gameId: args.gameId,
    walletAddress: args.walletAddress,
    assetMint: args.assetMint,
    stakeLamports: args.stakeLamports.toString(),
    stakeRaw: args.stakeLamports.toString(),
    escrowContestId: args.escrowContestId,
    transactionSignature: signature,
    ...walletProof,
  });
}

export async function buildSignedCancelRequest(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  walletPublicKey: PublicKey;
  walletAddress: string;
  assetMint: string;
  tokenProgramId: string;
  stakeLamports: bigint;
  escrowContestId: string;
  escrow: EscrowInstructionFactory;
  signAndSendTransaction: (transaction: import("@solana/web3.js").Transaction) => Promise<string>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<WagerStateMutationResponse> {
  const transactionRequest = await buildCancelWsolContestTransaction({
    walletPublicKey: args.walletPublicKey,
    contestId: args.escrowContestId,
    stakeLamports: args.stakeLamports,
    mint: new PublicKey(args.assetMint),
    tokenProgramId: new PublicKey(args.tokenProgramId),
    escrow: args.escrow,
  });
  const signature = await args.signAndSendTransaction(transactionRequest.transaction);
  const walletProof = await signWalletProof({
    action: "cancel_wager_waiting",
    sessionId: args.sessionId,
    gameId: args.gameId,
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  return cancelWagerWaiting({ ...args, transactionSignature: signature, ...walletProof });
}

export async function buildSignedRefundRequest(args: {
  gameId: string;
  sessionId: string;
  playerToken: string;
  walletPublicKey: PublicKey;
  walletAddress: string;
  whiteWalletAddress: string;
  blackWalletAddress: string;
  assetMint: string;
  tokenProgramId: string;
  stakeLamports: bigint;
  escrowContestId: string;
  escrow: EscrowInstructionFactory;
  signAndSendTransaction: (transaction: import("@solana/web3.js").Transaction) => Promise<string>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}): Promise<WagerStateMutationResponse> {
  const transactionRequest = await buildRefundExpiredWsolContestTransaction({
    walletPublicKey: args.walletPublicKey,
    contestId: args.escrowContestId,
    stakeLamports: args.stakeLamports,
    mint: new PublicKey(args.assetMint),
    tokenProgramId: new PublicKey(args.tokenProgramId),
    creatorPublicKey: new PublicKey(args.whiteWalletAddress),
    joinerPublicKey: new PublicKey(args.blackWalletAddress),
    escrow: args.escrow,
  });
  const signature = await args.signAndSendTransaction(transactionRequest.transaction);
  const walletProof = await signWalletProof({
    action: "request_wager_refund",
    sessionId: args.sessionId,
    gameId: args.gameId,
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  return requestWagerRefund({ ...args, transactionSignature: signature, ...walletProof });
}

export async function enterWagerQueue(args: EnterWagerQueueArgs): Promise<{
  gameId: string;
  color: "w" | "b";
  playerToken: string;
  signature: string;
}> {
  const walletProof = await signWalletProof({
    action: args.paymentMode === "native_sol_sponsored" ? "prepare_sponsored_wager" : "prepare_wager_queue",
    sessionId: args.sessionId,
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  const prepared = await prepareWagerQueue({ ...args, ...walletProof });
  const stakeLamports = BigInt(prepared.stakeLamports);
  if (args.paymentMode === "native_sol_sponsored") {
    const sponsoredAction = sponsoredActionForRole(prepared.depositRole);
    const signerUrl = args.sponsorSignerUrl ?? prepared.sponsorSignerUrl;
    if (!signerUrl) {
      throw new RefereeClientError("Sponsored wagers are temporarily unavailable.", "sponsor_unavailable");
    }
    const requestId = crypto.randomUUID();
    const sponsored =
      prepared.sponsoredTransaction ??
      await requestSponsoredWagerTransaction({
        signerUrl,
        action: sponsoredAction,
        gameId: prepared.gameId,
        sessionId: args.sessionId,
        playerToken: prepared.playerToken,
        walletAddress: args.walletAddress,
        stakeLamports,
        requestId,
        expectedEscrowContestId: prepared.contestId,
      });
    const transaction = Transaction.from(base64ToBytes(sponsored.serializedTransaction));
    if (sponsored.lastValidBlockHeight) {
      transaction.lastValidBlockHeight = sponsored.lastValidBlockHeight;
    }
    const rentSponsorAddress = sponsored.rentSponsorAddress ?? prepared.rentSponsorAddress;
    const rentRecipientAddress = sponsored.rentRecipientAddress ?? prepared.rentRecipientAddress;
    if (!rentSponsorAddress || !rentRecipientAddress) {
      throw new RefereeClientError("Sponsored transaction is missing rent sponsor metadata.", SPONSOR_TRANSACTION_INVALID);
    }
    assertSponsoredWagerTransactionSafe(transaction, {
      action: sponsoredAction,
      contestId: prepared.contestId,
      stakeLamports,
      walletAddress: args.walletAddress,
      rentSponsorAddress,
      rentRecipientAddress,
      escrowProgramId: sponsored.escrowProgramId,
    });
    const signature = await args.signAndSendTransaction(transaction);
    const confirmArgs = {
      gameId: prepared.gameId,
      sessionId: args.sessionId,
      playerToken: prepared.playerToken,
      color: prepared.color,
      transactionSignature: signature,
      walletAddress: args.walletAddress,
      stakeLamports,
      escrowContestId: prepared.contestId,
      requestId: sponsored.requestId ?? requestId,
    };
    let lastConfirmError: unknown = null;
    for (const delayMs of [0, 1_000, 2_000, 4_000]) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        await confirmSponsoredWagerDeposit(confirmArgs);
        lastConfirmError = null;
        break;
      } catch (error) {
        lastConfirmError = error;
      }
    }
    if (lastConfirmError) throw lastConfirmError;

    return {
      gameId: prepared.gameId,
      color: prepared.color,
      playerToken: prepared.playerToken,
      signature,
    };
  }

  if (!args.escrow) throw new Error("Escrow SDK is not available in this worktree yet.");
  const transactionRequest = prepared.depositRole === "white"
    ? await buildCreateWsolContestTransaction({
      walletPublicKey: args.walletPublicKey,
      contestId: prepared.contestId,
      stakeLamports,
      mint: new PublicKey(prepared.assetMint),
      tokenProgramId: new PublicKey(args.tokenProgramId),
      escrow: args.escrow,
    })
    : await buildJoinWsolContestTransaction({
      walletPublicKey: args.walletPublicKey,
      contestId: prepared.contestId,
      stakeLamports,
      mint: new PublicKey(prepared.assetMint),
      tokenProgramId: new PublicKey(args.tokenProgramId),
      escrow: args.escrow,
    });

  const signature = await args.signAndSendTransaction(transactionRequest.transaction);

  const confirmArgs = {
    gameId: prepared.gameId,
    sessionId: args.sessionId,
    playerToken: prepared.playerToken,
    color: prepared.color,
    transactionSignature: signature,
    walletAddress: args.walletAddress,
    assetMint: prepared.assetMint,
    stakeLamports,
    escrowContestId: prepared.contestId,
  };
  let lastConfirmError: unknown = null;
  for (const delayMs of [0, 1_000, 2_000, 4_000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await confirmWagerDeposit(confirmArgs);
      lastConfirmError = null;
      break;
    } catch (error) {
      lastConfirmError = error;
    }
  }
  if (lastConfirmError) throw lastConfirmError;

  return {
    gameId: prepared.gameId,
    color: prepared.color,
    playerToken: prepared.playerToken,
    signature,
  };
}

export async function enterWagerLobbyHost(args: EnterWagerQueueArgs): Promise<{
  gameId: string;
  color: "w" | "b";
  playerToken: string;
  signature: string;
}> {
  if (args.paymentMode === "native_sol_sponsored") {
    throw new RefereeClientError(
      "Sponsored wager lobbies need a dedicated sponsor host endpoint.",
      "wager_lobby_unsupported",
    );
  }

  const walletProof = await signWalletProof({
    action: "prepare_wager_lobby",
    sessionId: args.sessionId,
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  const prepared = await prepareWagerLobby({ ...args, ...walletProof });
  if (prepared.color !== "w" || prepared.depositRole !== "white") {
    throw new RefereeClientError("Wager lobby host seat was not reserved.", "wager_lobby_host_failed");
  }
  if (!args.escrow) throw new Error("Escrow SDK is not available in this worktree yet.");

  const stakeLamports = BigInt(prepared.stakeLamports);
  const transactionRequest = await buildCreateWsolContestTransaction({
    walletPublicKey: args.walletPublicKey,
    contestId: prepared.contestId,
    stakeLamports,
    mint: new PublicKey(prepared.assetMint),
    tokenProgramId: new PublicKey(args.tokenProgramId),
    escrow: args.escrow,
  });
  const signature = await args.signAndSendTransaction(transactionRequest.transaction);

  const confirmArgs = {
    gameId: prepared.gameId,
    sessionId: args.sessionId,
    playerToken: prepared.playerToken,
    color: prepared.color,
    transactionSignature: signature,
    walletAddress: args.walletAddress,
    assetMint: prepared.assetMint,
    stakeLamports,
    escrowContestId: prepared.contestId,
  };
  let lastConfirmError: unknown = null;
  for (const delayMs of [0, 1_000, 2_000, 4_000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await confirmWagerDeposit(confirmArgs);
      lastConfirmError = null;
      break;
    } catch (error) {
      lastConfirmError = error;
    }
  }
  if (lastConfirmError) throw lastConfirmError;

  return {
    gameId: prepared.gameId,
    color: prepared.color,
    playerToken: prepared.playerToken,
    signature,
  };
}

export async function enterWagerLobby(args: EnterWagerQueueArgs & { gameId: string }): Promise<{
  gameId: string;
  color: "w" | "b";
  playerToken: string;
  signature: string;
}> {
  if (args.paymentMode === "native_sol_sponsored") {
    throw new RefereeClientError(
      "Sponsored wager lobby joins need the sponsor targeted-join endpoint.",
      "wager_lobby_unsupported",
    );
  }

  const walletProof = await signWalletProof({
    action: "prepare_black_deposit",
    sessionId: args.sessionId,
    gameId: args.gameId,
    walletAddress: args.walletAddress,
    signMessage: args.signMessage,
  });
  const prepared = await prepareWagerLobbyJoin({ ...args, ...walletProof });
  if (prepared.color !== "b") {
    throw new RefereeClientError("Wager lobby is no longer waiting for an opponent.", "wager_lobby_taken");
  }
  if (!args.escrow) throw new Error("Escrow SDK is not available in this worktree yet.");

  const game = prepared.game ?? {};
  const contestId = typeof game.escrow_contest_id === "string" ? game.escrow_contest_id : prepared.contestId;
  const assetMint = typeof game.wager_asset_mint === "string" ? game.wager_asset_mint : prepared.assetMint;
  const rawStake = typeof game.wager_stake_raw === "string" ? game.wager_stake_raw : prepared.stakeLamports;
  const stakeLamports = BigInt(rawStake);

  const transactionRequest = await buildJoinWsolContestTransaction({
    walletPublicKey: args.walletPublicKey,
    contestId,
    stakeLamports,
    mint: new PublicKey(assetMint),
    tokenProgramId: new PublicKey(args.tokenProgramId),
    escrow: args.escrow,
  });
  const signature = await args.signAndSendTransaction(transactionRequest.transaction);

  const confirmArgs = {
    gameId: prepared.gameId,
    sessionId: args.sessionId,
    playerToken: prepared.playerToken,
    color: prepared.color,
    transactionSignature: signature,
    walletAddress: args.walletAddress,
    assetMint,
    stakeLamports,
    escrowContestId: contestId,
  };
  let lastConfirmError: unknown = null;
  for (const delayMs of [0, 1_000, 2_000, 4_000]) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      await confirmWagerDeposit(confirmArgs);
      lastConfirmError = null;
      break;
    } catch (error) {
      lastConfirmError = error;
    }
  }
  if (lastConfirmError) throw lastConfirmError;

  return {
    gameId: prepared.gameId,
    color: prepared.color,
    playerToken: prepared.playerToken,
    signature,
  };
}
