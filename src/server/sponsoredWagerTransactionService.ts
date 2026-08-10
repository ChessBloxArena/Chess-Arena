import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  type BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";

export const SPONSORED_WAGER_ENV_NAMES = {
  enabled: "PVP_SPONSORED_WAGERS_ENABLED",
  refereeKillSwitch: "PVP_REFEREE_KILL_SWITCH",
  sponsorUnavailable: "PVP_WAGER_SPONSOR_UNAVAILABLE",
  treasuryLow: "PVP_SPONSOR_TREASURY_LOW",
  minTreasuryLamports: "PVP_SPONSOR_MIN_TREASURY_LAMPORTS",
  sponsorPublicKey: "PVP_WAGER_RENT_SPONSOR_ADDRESS",
  rentRecipient: "PVP_WAGER_RENT_RECIPIENT_ADDRESS",
  escrowProgramId: "PVP_WAGER_ESCROW_PROGRAM_ID",
  signerSecret: "PVP_WAGER_SPONSOR_KEYPAIR_JSON",
} as const;

export type SponsoredWagerAction = "white_deposit" | "black_deposit" | "cancel_waiting";
export type SponsoredRequestStatus = "reserved" | "duplicate" | "stale" | "leased";

export interface SponsoredTransactionRequest {
  action: SponsoredWagerAction;
  gameId: string;
  sessionId: string;
  sessionProof: string;
  playerToken: string;
  walletAddress: string;
  stakeRaw: string;
  assetKind: "native_sol";
  requestId: string;
  requestedAtMs: number;
  expectedEscrowContestId?: string;
  walletSignature?: string;
  walletProofNonce?: string;
  walletProofExpiresAt?: string;
}

export interface SponsoredWagerTerms {
  gameId: string;
  playerToken: string;
  color: "w" | "b";
  depositRole: "white" | "black";
  contestId: string;
  stakeLamports: string;
  assetMint: string;
  assetKind: "native_sol";
  paymentMode: "native_sol_sponsored";
  rentSponsorAddress: string;
  rentRecipientAddress: string;
  escrowProgramId: string;
}

export interface SponsoredWagerState {
  gameId: string;
  paymentMode: "native_sol_sponsored" | string | null;
  assetKind: "native_sol" | string | null;
  paymentStatus: string | null;
  stakeRaw: string | null;
  assetMint: string | null;
  escrowContestId: string | null;
  rentSponsorAddress: string | null;
  rentRecipientAddress: string | null;
  whiteWalletAddress?: string | null;
  blackWalletAddress?: string | null;
}

export interface SponsorRefereeClient {
  prepareSponsoredWager(request: SponsoredTransactionRequest): Promise<SponsoredWagerTerms>;
  getSponsoredWagerState(request: SponsoredTransactionRequest): Promise<SponsoredWagerState>;
}

export interface SponsoredInstructionBuild {
  instruction: TransactionInstruction;
  metadata: {
    action: SponsoredWagerAction;
    gameId: string;
    contestId: string;
    walletAddress: string;
    stakeRaw: string;
    assetKind: "native_sol";
    paymentMode: "native_sol_sponsored";
    rentSponsorAddress: string;
    rentRecipientAddress: string;
  };
}

export interface SponsoredNativeInstructionFactory {
  buildSponsoredInstruction(input: SponsoredTransactionRequest & SponsoredWagerTerms): Promise<SponsoredInstructionBuild>;
}

export interface SponsorSigner {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export interface SponsorConnection {
  getLatestBlockhash(commitment?: "confirmed"): Promise<BlockhashWithExpiryBlockHeight>;
}

export interface SponsorTreasury {
  balanceLamports(publicKey: PublicKey): Promise<bigint>;
}

export interface RequestIdStore {
  reserve(input: {
    requestId: string;
    gameId: string;
    sessionId: string;
    action: SponsoredWagerAction;
    walletAddress: string;
    contestId?: string;
    nowMs: number;
    requestedAtMs: number;
    actionLeaseMs: number;
  }): Promise<SponsoredRequestStatus>;
}

export interface SponsoredTransactionServiceConfig {
  enabled: boolean;
  refereeKillSwitch: boolean;
  sponsorUnavailable: boolean;
  treasuryLow: boolean;
  minTreasuryLamports: bigint;
  requestTtlMs: number;
  actionLeaseMs?: number;
  escrowProgramId: PublicKey;
  sponsorPublicKey: PublicKey;
  rentRecipientAddress: PublicKey;
}

export class SponsoredTransactionError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SponsoredTransactionError";
    this.code = code;
    this.status = status;
  }
}

export class MemorySponsoredRequestStore implements RequestIdStore {
  private readonly seen = new Set<string>();
  private readonly actionLeases = new Map<string, number>();

  async reserve(input: {
    requestId: string;
    gameId: string;
    sessionId: string;
    action: SponsoredWagerAction;
    walletAddress: string;
    contestId?: string;
    nowMs: number;
    requestedAtMs: number;
    actionLeaseMs: number;
  }): Promise<SponsoredRequestStatus> {
    if (input.nowMs - input.requestedAtMs > 5 * 60 * 1000) return "stale";
    for (const [key, expiresAt] of this.actionLeases.entries()) {
      if (expiresAt <= input.nowMs) this.actionLeases.delete(key);
    }
    const key = `${input.sessionId}:${input.gameId}:${input.requestId}`;
    if (this.seen.has(key)) return "duplicate";
    const actionKey = `${input.sessionId}:${input.gameId}:${input.action}:${input.walletAddress}:${input.contestId ?? "unknown-contest"}`;
    if (this.actionLeases.has(actionKey)) return "leased";
    this.seen.add(key);
    this.actionLeases.set(actionKey, input.nowMs + input.actionLeaseMs);
    return "reserved";
  }
}

function fail(code: string, message: string, status = 400): never {
  throw new SponsoredTransactionError(code, message, status);
}

function assertPublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    fail("invalid_public_key", `Invalid ${label}`);
  }
}

function assertBase58Address(value: string, label: string): string {
  return assertPublicKey(value, label).toBase58();
}

function assertRawAmount(value: string): string {
  if (!/^[0-9]+$/.test(value) || BigInt(value) <= 0n) {
    fail("invalid_stake", "stakeRaw must be a positive integer");
  }
  return value;
}

function validateRequestShape(request: SponsoredTransactionRequest, nowMs: number, requestTtlMs: number): void {
  if (!request.sessionId || !request.sessionProof) fail("missing_session_proof", "Missing session proof", 403);
  if (!request.playerToken || !/^[A-Za-z0-9._:-]{8,256}$/.test(request.playerToken)) {
    fail("invalid_player_token", "Invalid player token", 403);
  }
  if (!request.requestId || !/^[A-Za-z0-9._:-]{8,128}$/.test(request.requestId)) {
    fail("invalid_request_id", "Invalid request id");
  }
  if (!Number.isFinite(request.requestedAtMs) || nowMs - request.requestedAtMs > requestTtlMs) {
    fail("stale_request_id", "Sponsored transaction request is stale", 409);
  }
  assertBase58Address(request.walletAddress, "walletAddress");
  assertRawAmount(request.stakeRaw);
  if (request.assetKind !== "native_sol") fail("wrong_asset_kind", "Sponsored wagers only support native SOL");
}

function ensureSponsorAvailable(config: SponsoredTransactionServiceConfig): void {
  if (!config.enabled || config.refereeKillSwitch || config.sponsorUnavailable) {
    fail("sponsor_unavailable", "Sponsored wager signing is unavailable", 503);
  }
  if (config.treasuryLow) fail("treasury_low", "Sponsored wager treasury is below the safety threshold", 503);
}

function validateTerms(request: SponsoredTransactionRequest, terms: SponsoredWagerTerms, config: SponsoredTransactionServiceConfig): void {
  if (terms.gameId !== request.gameId) fail("wrong_contest", "Referee returned the wrong game id", 409);
  if (terms.stakeLamports !== request.stakeRaw) fail("wrong_stake", "Referee returned the wrong stake", 409);
  if (terms.assetKind !== "native_sol") fail("wrong_asset_kind", "Referee returned the wrong asset kind", 409);
  if (terms.paymentMode !== "native_sol_sponsored") fail("wrong_payment_mode", "Referee returned the wrong payment mode", 409);
  if (request.expectedEscrowContestId && terms.contestId !== request.expectedEscrowContestId) {
    fail("wrong_contest", "Referee returned the wrong contest id", 409);
  }
  if (terms.rentSponsorAddress !== config.sponsorPublicKey.toBase58()) {
    fail("wrong_sponsor", "Referee returned the wrong rent sponsor", 409);
  }
  if (terms.rentRecipientAddress !== config.rentRecipientAddress.toBase58()) {
    fail("wrong_rent_recipient", "Referee returned the wrong rent recipient", 409);
  }
  if (terms.escrowProgramId !== config.escrowProgramId.toBase58()) {
    fail("wrong_program", "Referee returned the wrong escrow program", 409);
  }
}

function validateState(request: SponsoredTransactionRequest, state: SponsoredWagerState, config: SponsoredTransactionServiceConfig): SponsoredWagerTerms {
  if (state.gameId !== request.gameId) fail("wrong_contest", "Referee returned the wrong game id", 409);
  if (state.stakeRaw !== request.stakeRaw) fail("wrong_stake", "Referee returned the wrong stake", 409);
  if (state.assetKind !== "native_sol") fail("wrong_asset_kind", "Referee returned the wrong asset kind", 409);
  if (state.paymentMode !== "native_sol_sponsored") fail("wrong_payment_mode", "Referee returned the wrong payment mode", 409);
  if (!state.escrowContestId || (request.expectedEscrowContestId && state.escrowContestId !== request.expectedEscrowContestId)) {
    fail("wrong_contest", "Referee returned the wrong contest id", 409);
  }
  if (state.rentSponsorAddress !== config.sponsorPublicKey.toBase58()) fail("wrong_sponsor", "Referee returned the wrong rent sponsor", 409);
  if (state.rentRecipientAddress !== config.rentRecipientAddress.toBase58()) {
    fail("wrong_rent_recipient", "Referee returned the wrong rent recipient", 409);
  }
  if (request.action === "white_deposit") {
    if (state.paymentStatus !== "white_prepared") fail("wrong_payment_state", "White deposit is not prepared", 409);
    if (state.whiteWalletAddress && state.whiteWalletAddress !== request.walletAddress) fail("wrong_wallet", "Prepared white wallet mismatch", 409);
  } else if (request.action === "black_deposit") {
    if (state.paymentStatus !== "black_prepared") fail("wrong_payment_state", "Black deposit is not prepared", 409);
    if (state.blackWalletAddress && state.blackWalletAddress !== request.walletAddress) fail("wrong_wallet", "Prepared black wallet mismatch", 409);
  } else {
    if (!["white_prepared", "white_deposited", "black_prepared"].includes(String(state.paymentStatus))) {
      fail("wrong_payment_state", "Sponsored wager is not cancellable", 409);
    }
    if (state.whiteWalletAddress && state.whiteWalletAddress !== request.walletAddress) fail("wrong_wallet", "Only the white wallet can cancel", 409);
  }
  return {
    gameId: request.gameId,
    playerToken: "",
    color: "w",
    depositRole: "white",
    contestId: state.escrowContestId,
    stakeLamports: request.stakeRaw,
    assetMint: state.assetMint ?? "So11111111111111111111111111111111111111112",
    assetKind: "native_sol",
    paymentMode: "native_sol_sponsored",
    rentSponsorAddress: config.sponsorPublicKey.toBase58(),
    rentRecipientAddress: config.rentRecipientAddress.toBase58(),
    escrowProgramId: config.escrowProgramId.toBase58(),
  };
}

function validateInstruction(
  request: SponsoredTransactionRequest,
  terms: SponsoredWagerTerms,
  build: SponsoredInstructionBuild,
  config: SponsoredTransactionServiceConfig,
): void {
  if (!build.instruction.programId.equals(config.escrowProgramId)) fail("wrong_program", "Refusing to sign a non-escrow instruction", 409);
  if (build.metadata.action !== request.action) fail("wrong_action", "Sponsored instruction action mismatch", 409);
  if (build.metadata.gameId !== request.gameId || build.metadata.contestId !== terms.contestId) {
    fail("wrong_contest", "Sponsored instruction contest mismatch", 409);
  }
  if (build.metadata.walletAddress !== request.walletAddress) fail("wrong_wallet", "Sponsored instruction wallet mismatch", 409);
  if (build.metadata.stakeRaw !== request.stakeRaw) fail("wrong_stake", "Sponsored instruction stake mismatch", 409);
  if (build.metadata.assetKind !== "native_sol") fail("wrong_asset_kind", "Sponsored instruction asset mismatch", 409);
  if (build.metadata.rentSponsorAddress !== config.sponsorPublicKey.toBase58()) fail("wrong_sponsor", "Sponsored instruction sponsor mismatch", 409);
  if (build.metadata.rentRecipientAddress !== config.rentRecipientAddress.toBase58()) {
    fail("wrong_rent_recipient", "Sponsored instruction rent recipient mismatch", 409);
  }

  for (const key of build.instruction.keys) {
    if (key.isSigner) {
      const signer = key.pubkey.toBase58();
      if (signer !== config.sponsorPublicKey.toBase58() && signer !== request.walletAddress) {
        fail("unexpected_signer", "Sponsored instruction contains an unexpected signer", 409);
      }
    }
  }
}

function countSponsorSignatures(transaction: Transaction, sponsorPublicKey: PublicKey): number {
  return transaction.signatures.filter((signature) => signature.publicKey.equals(sponsorPublicKey) && signature.signature).length;
}

function assertInstructionUnchanged(original: TransactionInstruction, signed: TransactionInstruction): void {
  if (!signed.programId.equals(original.programId)) fail("signer_mutated_transaction", "Sponsor signer changed the instruction program", 503);
  if (!Buffer.from(signed.data).equals(Buffer.from(original.data))) {
    fail("signer_mutated_transaction", "Sponsor signer changed the instruction data", 503);
  }
  if (signed.keys.length !== original.keys.length) {
    fail("signer_mutated_transaction", "Sponsor signer changed the instruction accounts", 503);
  }
  for (let index = 0; index < original.keys.length; index += 1) {
    const expected = original.keys[index];
    const actual = signed.keys[index];
    if (
      !actual.pubkey.equals(expected.pubkey) ||
      actual.isSigner !== expected.isSigner ||
      actual.isWritable !== expected.isWritable
    ) {
      fail("signer_mutated_transaction", "Sponsor signer changed the instruction accounts", 503);
    }
  }
}

function validateSignedTransaction(
  original: Transaction,
  signed: Transaction,
  config: SponsoredTransactionServiceConfig,
): number {
  if (!signed.feePayer?.equals(config.sponsorPublicKey)) {
    fail("signer_mutated_transaction", "Sponsor signer changed the transaction fee payer", 503);
  }
  if (signed.recentBlockhash !== original.recentBlockhash) {
    fail("signer_mutated_transaction", "Sponsor signer changed the transaction blockhash", 503);
  }
  if (signed.instructions.length !== original.instructions.length) {
    fail("signer_mutated_transaction", "Sponsor signer changed the transaction instructions", 503);
  }
  signed.instructions.forEach((instruction, index) => {
    if (!instruction.programId.equals(config.escrowProgramId)) {
      fail("wrong_program", "Sponsor signer returned a non-escrow instruction", 503);
    }
    assertInstructionUnchanged(original.instructions[index], instruction);
  });

  const sponsorSignatureCount = countSponsorSignatures(signed, config.sponsorPublicKey);
  if (sponsorSignatureCount < 1) {
    fail("missing_sponsor_signature", "Sponsor signer returned an unsigned transaction", 503);
  }
  return sponsorSignatureCount;
}

export async function prepareSponsoredWagerTransaction(args: {
  request: SponsoredTransactionRequest;
  config: SponsoredTransactionServiceConfig;
  referee: SponsorRefereeClient;
  instructionFactory: SponsoredNativeInstructionFactory;
  signer: SponsorSigner;
  connection: SponsorConnection;
  treasury: SponsorTreasury;
  requestStore: RequestIdStore;
  nowMs?: number;
}): Promise<{
  serializedTransaction: string;
  lastValidBlockHeight: number;
  sponsorSignatureCount: number;
  gameId: string;
  contestId: string;
  stakeRaw: string;
  escrowProgramId: string;
  rentSponsorAddress: string;
  rentRecipientAddress: string;
}> {
  const nowMs = args.nowMs ?? Date.now();
  validateRequestShape(args.request, nowMs, args.config.requestTtlMs);
  ensureSponsorAvailable(args.config);
  if (!args.signer.publicKey.equals(args.config.sponsorPublicKey)) {
    fail("wrong_sponsor", "Configured signer does not match sponsor public key", 503);
  }

  const requestStatus = await args.requestStore.reserve({
    requestId: args.request.requestId,
    gameId: args.request.gameId,
    sessionId: args.request.sessionId,
    action: args.request.action,
    walletAddress: args.request.walletAddress,
    contestId: args.request.expectedEscrowContestId,
    nowMs,
    requestedAtMs: args.request.requestedAtMs,
    actionLeaseMs: args.config.actionLeaseMs ?? 75_000,
  });
  if (requestStatus === "duplicate") fail("duplicate_request_id", "Duplicate sponsored transaction request", 409);
  if (requestStatus === "stale") fail("stale_request_id", "Sponsored transaction request is stale", 409);
  if (requestStatus === "leased") {
    fail("sponsored_action_in_flight", "A sponsored transaction for this wager is already in progress. Try again shortly.", 429);
  }

  const balance = await args.treasury.balanceLamports(args.config.sponsorPublicKey);
  if (balance < args.config.minTreasuryLamports) {
    fail("treasury_low", "Sponsored wager treasury is below the safety threshold", 503);
  }

  const terms = validateState(args.request, await args.referee.getSponsoredWagerState(args.request), args.config);
  validateTerms(args.request, terms, args.config);

  const build = await args.instructionFactory.buildSponsoredInstruction({ ...args.request, ...terms });
  validateInstruction(args.request, terms, build, args.config);

  const blockhash = await args.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = args.config.sponsorPublicKey;
  transaction.recentBlockhash = blockhash.blockhash;
  transaction.lastValidBlockHeight = blockhash.lastValidBlockHeight;
  transaction.add(build.instruction);

  const signed = await args.signer.signTransaction(transaction);
  const sponsorSignatureCount = validateSignedTransaction(transaction, signed, args.config);
  const serialized = signed.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    serializedTransaction: Buffer.from(serialized).toString("base64"),
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
    sponsorSignatureCount,
    gameId: terms.gameId,
    contestId: terms.contestId,
    stakeRaw: terms.stakeLamports,
    escrowProgramId: terms.escrowProgramId,
    rentSponsorAddress: terms.rentSponsorAddress,
    rentRecipientAddress: terms.rentRecipientAddress,
  };
}
