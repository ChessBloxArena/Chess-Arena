import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { SPL_TOKEN_PROGRAM_ADDRESS, WSOL_MINT_ADDRESS } from "@/lib/wagerConfig";

export type WagerTransactionKind = "create" | "join" | "cancel" | "refund" | "settle" | "reclaim_rent" | "unwrap";

export interface WagerTransactionAccounts {
  payer: PublicKey;
  playerWsolAta?: PublicKey;
  opponentWsolAta?: PublicKey;
  escrowVault?: PublicKey;
  contest?: PublicKey;
  mint: PublicKey;
  tokenProgramId: PublicKey;
}

export interface EscrowInstructionContext {
  contestId: string;
  stakeLamports: bigint;
  assetMint: PublicKey;
  tokenProgramId: PublicKey;
}

export interface CreateEscrowInstructionArgs extends EscrowInstructionContext {
  creator: PublicKey;
  creatorTokenAccount: PublicKey;
}

export interface JoinEscrowInstructionArgs extends EscrowInstructionContext {
  joiner: PublicKey;
  joinerTokenAccount: PublicKey;
}

export interface CancelEscrowInstructionArgs extends EscrowInstructionContext {
  creator: PublicKey;
  creatorTokenAccount: PublicKey;
}

export interface RefundEscrowInstructionArgs extends EscrowInstructionContext {
  player: PublicKey;
  playerTokenAccount: PublicKey;
  creatorTokenAccount?: PublicKey;
  joinerTokenAccount?: PublicKey;
}

export interface SettleEscrowInstructionArgs extends EscrowInstructionContext {
  resultAuthority: PublicKey;
  winner: PublicKey | null;
  white: PublicKey;
  black: PublicKey;
  whiteTokenAccount: PublicKey;
  blackTokenAccount: PublicKey;
  resultHash: Uint8Array;
}

export interface ReclaimEscrowRentInstructionArgs extends EscrowInstructionContext {
  rentRecipient: PublicKey;
}

export interface EscrowInstructionFactory {
  createContest(args: CreateEscrowInstructionArgs): TransactionInstruction | Promise<TransactionInstruction>;
  joinContest(args: JoinEscrowInstructionArgs): TransactionInstruction | Promise<TransactionInstruction>;
  cancelContest(args: CancelEscrowInstructionArgs): TransactionInstruction | Promise<TransactionInstruction>;
  refundExpiredContest(args: RefundEscrowInstructionArgs): TransactionInstruction | Promise<TransactionInstruction>;
  settleContest(args: SettleEscrowInstructionArgs): TransactionInstruction | Promise<TransactionInstruction>;
  reclaimContestRent(args: ReclaimEscrowRentInstructionArgs): TransactionInstruction | Promise<TransactionInstruction>;
}

export interface WsolTransactionRequest {
  kind: WagerTransactionKind;
  contestId?: string;
  stakeLamports: bigint;
  transaction: Transaction;
  accounts: WagerTransactionAccounts;
  instructionLabels: string[];
}

export interface UserWsolEscrowArgs {
  walletPublicKey: PublicKey;
  contestId: string;
  stakeLamports: bigint;
  escrow: EscrowInstructionFactory;
  mint?: PublicKey;
  tokenProgramId?: PublicKey;
  creatorPublicKey?: PublicKey;
  joinerPublicKey?: PublicKey;
}

export interface SettleWsolEscrowArgs {
  resultAuthority: PublicKey;
  white: PublicKey;
  black: PublicKey;
  winner: PublicKey | null;
  contestId: string;
  stakeLamports: bigint;
  resultHash: Uint8Array;
  escrow: EscrowInstructionFactory;
  mint?: PublicKey;
  tokenProgramId?: PublicKey;
}

export interface ReclaimWsolEscrowRentArgs {
  payer: PublicKey;
  rentRecipient: PublicKey;
  contestId: string;
  stakeLamports: bigint;
  escrow: EscrowInstructionFactory;
  mint?: PublicKey;
  tokenProgramId?: PublicKey;
}

function assertSafeRawAmount(amount: bigint): void {
  if (amount <= 0n) throw new Error("Stake must be greater than zero");
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stake exceeds JavaScript safe integer range");
  }
}

function normalizeTokenProgram(tokenProgramId = new PublicKey(SPL_TOKEN_PROGRAM_ADDRESS)): PublicKey {
  if (!tokenProgramId.equals(TOKEN_PROGRAM_ID) && !tokenProgramId.equals(TOKEN_2022_PROGRAM_ID)) {
    throw new Error("Wager assets must use the SPL Token or Token-2022 program");
  }
  return tokenProgramId;
}

function userWsolAta(owner: PublicKey, mint: PublicKey, tokenProgramId: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
}

function addPrepareAssetAccountInstructions(
  transaction: Transaction,
  payer: PublicKey,
  tokenAccount: PublicKey,
  stakeRawAmount: bigint,
  mint: PublicKey,
  tokenProgramId: PublicKey,
  labels: string[]
): void {
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      tokenAccount,
      payer,
      mint,
      tokenProgramId,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );
  labels.push("create-associated-token-account-idempotent");

  if (!mint.equals(NATIVE_MINT)) return;

  transaction.add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: tokenAccount,
      lamports: Number(stakeRawAmount),
    })
  );
  labels.push("system-transfer-lamports-to-wsol-ata");

  transaction.add(createSyncNativeInstruction(tokenAccount, tokenProgramId));
  labels.push("sync-native");
}

async function baseUserArgs(args: UserWsolEscrowArgs) {
  assertSafeRawAmount(args.stakeLamports);
  const mint = args.mint ?? new PublicKey(WSOL_MINT_ADDRESS);
  const tokenProgramId = normalizeTokenProgram(args.tokenProgramId);
  const playerWsolAta = userWsolAta(args.walletPublicKey, mint, tokenProgramId);

  return { mint, tokenProgramId, playerWsolAta };
}

export async function buildCreateWsolContestTransaction(args: UserWsolEscrowArgs): Promise<WsolTransactionRequest> {
  const { mint, tokenProgramId, playerWsolAta } = await baseUserArgs(args);
  const transaction = new Transaction();
  transaction.feePayer = args.walletPublicKey;
  const instructionLabels: string[] = [];

  addPrepareAssetAccountInstructions(
    transaction,
    args.walletPublicKey,
    playerWsolAta,
    args.stakeLamports,
    mint,
    tokenProgramId,
    instructionLabels
  );

  transaction.add(await args.escrow.createContest({
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    assetMint: mint,
    tokenProgramId,
    creator: args.walletPublicKey,
    creatorTokenAccount: playerWsolAta,
  }));
  instructionLabels.push("escrow-create-contest");

  return {
    kind: "create",
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    transaction,
    accounts: {
      payer: args.walletPublicKey,
      playerWsolAta,
      mint,
      tokenProgramId,
    },
    instructionLabels,
  };
}

export async function buildJoinWsolContestTransaction(args: UserWsolEscrowArgs): Promise<WsolTransactionRequest> {
  const { mint, tokenProgramId, playerWsolAta } = await baseUserArgs(args);
  const transaction = new Transaction();
  transaction.feePayer = args.walletPublicKey;
  const instructionLabels: string[] = [];

  addPrepareAssetAccountInstructions(
    transaction,
    args.walletPublicKey,
    playerWsolAta,
    args.stakeLamports,
    mint,
    tokenProgramId,
    instructionLabels
  );

  transaction.add(await args.escrow.joinContest({
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    assetMint: mint,
    tokenProgramId,
    joiner: args.walletPublicKey,
    joinerTokenAccount: playerWsolAta,
  }));
  instructionLabels.push("escrow-join-contest");

  return {
    kind: "join",
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    transaction,
    accounts: {
      payer: args.walletPublicKey,
      playerWsolAta,
      mint,
      tokenProgramId,
    },
    instructionLabels,
  };
}

export async function buildCancelWsolContestTransaction(args: UserWsolEscrowArgs): Promise<WsolTransactionRequest> {
  assertSafeRawAmount(args.stakeLamports);
  const mint = args.mint ?? new PublicKey(WSOL_MINT_ADDRESS);
  const tokenProgramId = normalizeTokenProgram(args.tokenProgramId);
  const playerWsolAta = userWsolAta(args.walletPublicKey, mint, tokenProgramId);
  const transaction = new Transaction();
  transaction.feePayer = args.walletPublicKey;

  transaction.add(await args.escrow.cancelContest({
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    assetMint: mint,
    tokenProgramId,
    creator: args.walletPublicKey,
    creatorTokenAccount: playerWsolAta,
  }));

  return {
    kind: "cancel",
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    transaction,
    accounts: {
      payer: args.walletPublicKey,
      playerWsolAta,
      mint,
      tokenProgramId,
    },
    instructionLabels: ["escrow-cancel-contest"],
  };
}

export async function buildRefundExpiredWsolContestTransaction(args: UserWsolEscrowArgs): Promise<WsolTransactionRequest> {
  assertSafeRawAmount(args.stakeLamports);
  const mint = args.mint ?? new PublicKey(WSOL_MINT_ADDRESS);
  const tokenProgramId = normalizeTokenProgram(args.tokenProgramId);
  const playerWsolAta = userWsolAta(args.walletPublicKey, mint, tokenProgramId);
  const creatorTokenAccount = userWsolAta(args.creatorPublicKey ?? args.walletPublicKey, mint, tokenProgramId);
  const joinerTokenAccount = userWsolAta(args.joinerPublicKey ?? args.walletPublicKey, mint, tokenProgramId);
  const transaction = new Transaction();
  transaction.feePayer = args.walletPublicKey;

  transaction.add(await args.escrow.refundExpiredContest({
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    assetMint: mint,
    tokenProgramId,
    player: args.walletPublicKey,
    playerTokenAccount: playerWsolAta,
    creatorTokenAccount,
    joinerTokenAccount,
  }));

  return {
    kind: "refund",
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    transaction,
    accounts: {
      payer: args.walletPublicKey,
      playerWsolAta,
      opponentWsolAta: args.joinerPublicKey ? joinerTokenAccount : undefined,
      mint,
      tokenProgramId,
    },
    instructionLabels: ["escrow-refund-expired-contest"],
  };
}

export async function buildSettleWsolContestTransaction(args: SettleWsolEscrowArgs): Promise<WsolTransactionRequest> {
  assertSafeRawAmount(args.stakeLamports);
  const mint = args.mint ?? new PublicKey(WSOL_MINT_ADDRESS);
  const tokenProgramId = normalizeTokenProgram(args.tokenProgramId);
  const whiteTokenAccount = userWsolAta(args.white, mint, tokenProgramId);
  const blackTokenAccount = userWsolAta(args.black, mint, tokenProgramId);
  const transaction = new Transaction();
  transaction.feePayer = args.resultAuthority;

  transaction.add(await args.escrow.settleContest({
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    assetMint: mint,
    tokenProgramId,
    resultAuthority: args.resultAuthority,
    winner: args.winner,
    white: args.white,
    black: args.black,
    whiteTokenAccount,
    blackTokenAccount,
    resultHash: args.resultHash,
  }));

  return {
    kind: "settle",
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    transaction,
    accounts: {
      payer: args.resultAuthority,
      playerWsolAta: whiteTokenAccount,
      opponentWsolAta: blackTokenAccount,
      mint,
      tokenProgramId,
    },
    instructionLabels: ["escrow-settle-contest"],
  };
}

export async function buildReclaimWsolContestRentTransaction(args: ReclaimWsolEscrowRentArgs): Promise<WsolTransactionRequest> {
  assertSafeRawAmount(args.stakeLamports);
  const mint = args.mint ?? new PublicKey(WSOL_MINT_ADDRESS);
  const tokenProgramId = normalizeTokenProgram(args.tokenProgramId);
  const transaction = new Transaction();
  transaction.feePayer = args.payer;

  transaction.add(await args.escrow.reclaimContestRent({
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    assetMint: mint,
    tokenProgramId,
    rentRecipient: args.rentRecipient,
  }));

  return {
    kind: "reclaim_rent",
    contestId: args.contestId,
    stakeLamports: args.stakeLamports,
    transaction,
    accounts: {
      payer: args.payer,
      mint,
      tokenProgramId,
    },
    instructionLabels: ["escrow-reclaim-contest-rent"],
  };
}

export function buildUnwrapSolTransaction(owner: PublicKey): WsolTransactionRequest {
  const mint = NATIVE_MINT;
  const tokenProgramId = TOKEN_PROGRAM_ID;
  const playerWsolAta = userWsolAta(owner, mint, tokenProgramId);
  const transaction = new Transaction();
  transaction.feePayer = owner;
  transaction.add(createCloseAccountInstruction(
    playerWsolAta,
    owner,
    owner,
    [],
    tokenProgramId
  ));

  return {
    kind: "unwrap",
    stakeLamports: 0n,
    transaction,
    accounts: {
      payer: owner,
      playerWsolAta,
      mint,
      tokenProgramId,
    },
    instructionLabels: ["close-wsol-associated-token-account"],
  };
}
