import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { publicPaymentConfig } from "@/lib/paymentConfig";
import type {
  CancelEscrowInstructionArgs,
  CreateEscrowInstructionArgs,
  EscrowInstructionFactory,
  JoinEscrowInstructionArgs,
  RefundEscrowInstructionArgs,
  ReclaimEscrowRentInstructionArgs,
  SettleEscrowInstructionArgs,
} from "@/lib/solanaWagerTransactions";

const GLOBAL_CONFIG_SEED = "global_config";
const GAME_CONFIG_SEED = "game";
const CONTEST_SEED = "contest";
const CONTEST_VAULT_SEED = "contest_vault";
const VAULT_AUTHORITY_SEED = "vault_authority";
const DEFAULT_GAME_ID = "chess-arena";
const DEFAULT_RULES_HASH = "chess-arena-v1";
const DEFAULT_CONTEST_TTL_SECONDS = 10 * 60;
const DEFAULT_FEE_AUTHORITY = "11111111111111111111111111111111";

const DISCRIMINATORS = {
  createContest: Buffer.from([129, 189, 164, 27, 152, 242, 123, 93]),
  joinContest: Buffer.from([247, 243, 77, 111, 247, 254, 100, 133]),
  cancelContest: Buffer.from([255, 250, 141, 71, 184, 141, 109, 80]),
  refundExpiredContest: Buffer.from([222, 197, 170, 188, 114, 189, 2, 20]),
  settleContest: Buffer.from([79, 122, 33, 192, 110, 98, 219, 238]),
  reclaimContestRent: Buffer.from([94, 36, 53, 152, 64, 248, 229, 180]),
} as const;

export interface EscrowAnchorFactoryConfig {
  programId: PublicKey;
  gameId: string;
  rulesHash: string;
  contestTtlSeconds: number;
  feeAuthority: PublicKey;
}

interface DerivedEscrowAccounts {
  globalConfig: PublicKey;
  gameConfig: PublicKey;
  contest: PublicKey;
  contestVault: PublicKey;
  vaultAuthority: PublicKey;
}

function envString(name: keyof ImportMetaEnv, fallback: string): string {
  const value = import.meta.env[name]?.trim();
  return value || fallback;
}

function envPositiveInteger(name: keyof ImportMetaEnv, fallback: number): number {
  const value = Number(import.meta.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function assertSizedString(value: string, maxLength: number, label: string): string {
  if (!value || value.length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return value;
}

function seed(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function seedHash(value: string): Uint8Array {
  return sha256(seed(value));
}

function derive(programId: PublicKey, seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function deriveEscrowAccounts(
  config: EscrowAnchorFactoryConfig,
  contestId: string,
  mint: PublicKey,
): DerivedEscrowAccounts {
  assertSizedString(config.gameId, 32, "Escrow game id");
  assertSizedString(contestId, 64, "Escrow contest id");

  const globalConfig = derive(config.programId, [seed(GLOBAL_CONFIG_SEED)]);
  const gameConfig = derive(config.programId, [seed(GAME_CONFIG_SEED), seedHash(config.gameId)]);
  const contest = derive(config.programId, [
    seed(CONTEST_SEED),
    gameConfig.toBytes(),
    seedHash(contestId),
  ]);
  const contestVault = derive(config.programId, [
    seed(CONTEST_VAULT_SEED),
    contest.toBytes(),
    mint.toBytes(),
  ]);
  const vaultAuthority = derive(config.programId, [seed(VAULT_AUTHORITY_SEED), contest.toBytes()]);

  return { globalConfig, gameConfig, contest, contestVault, vaultAuthority };
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function u64(value: bigint): Buffer {
  if (value <= 0n || value > 18_446_744_073_709_551_615n) {
    throw new Error("Escrow amount must fit in a positive u64.");
  }
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

function i64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value, 0);
  return buffer;
}

function pubkey(value: PublicKey): Buffer {
  return Buffer.from(value.toBytes());
}

function anchorString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function optionPubkey(value: PublicKey | null): Buffer {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), pubkey(value)]);
}

function resultHashString(bytes: Uint8Array): string {
  const hash = Buffer.from(bytes).toString("hex");
  return assertSizedString(hash, 64, "Result hash");
}

function tokenProgram(programId: PublicKey): PublicKey {
  if (programId.equals(TOKEN_PROGRAM_ID) || programId.equals(TOKEN_2022_PROGRAM_ID)) {
    return programId;
  }
  throw new Error("Escrow token program must be SPL Token or Token-2022.");
}

function associatedTokenAccount(owner: PublicKey, mint: PublicKey, programId: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, false, tokenProgram(programId));
}

function contestExpiry(config: EscrowAnchorFactoryConfig): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + config.contestTtlSeconds);
}

export function createEscrowInstructionFactory(config: EscrowAnchorFactoryConfig): EscrowInstructionFactory {
  return {
    createContest(args: CreateEscrowInstructionArgs) {
      const tokenProgramId = tokenProgram(args.tokenProgramId);
      const accounts = deriveEscrowAccounts(config, args.contestId, args.assetMint);
      const rulesHash = assertSizedString(config.rulesHash, 64, "Escrow rules hash");
      const data = Buffer.concat([
        DISCRIMINATORS.createContest,
        anchorString(args.contestId),
        pubkey(args.assetMint),
        u64(args.stakeLamports),
        anchorString(rulesHash),
        i64(contestExpiry(config)),
      ]);

      return new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: accounts.globalConfig, isSigner: false, isWritable: false },
          { pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
          { pubkey: args.assetMint, isSigner: false, isWritable: false },
          { pubkey: accounts.contest, isSigner: false, isWritable: true },
          { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
          { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: args.creatorTokenAccount, isSigner: false, isWritable: true },
          { pubkey: args.creator, isSigner: true, isWritable: true },
          { pubkey: tokenProgramId, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
    },

    joinContest(args: JoinEscrowInstructionArgs) {
      const tokenProgramId = tokenProgram(args.tokenProgramId);
      const accounts = deriveEscrowAccounts(config, args.contestId, args.assetMint);

      return new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: accounts.globalConfig, isSigner: false, isWritable: false },
          { pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
          { pubkey: args.assetMint, isSigner: false, isWritable: false },
          { pubkey: accounts.contest, isSigner: false, isWritable: true },
          { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
          { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: args.joinerTokenAccount, isSigner: false, isWritable: true },
          { pubkey: args.joiner, isSigner: true, isWritable: true },
          { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.joinContest,
      });
    },

    cancelContest(args: CancelEscrowInstructionArgs) {
      const tokenProgramId = tokenProgram(args.tokenProgramId);
      const accounts = deriveEscrowAccounts(config, args.contestId, args.assetMint);

      return new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: accounts.contest, isSigner: false, isWritable: true },
          { pubkey: args.assetMint, isSigner: false, isWritable: false },
          { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
          { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: args.creatorTokenAccount, isSigner: false, isWritable: true },
          { pubkey: args.creator, isSigner: true, isWritable: true },
          { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.cancelContest,
      });
    },

    refundExpiredContest(args: RefundEscrowInstructionArgs) {
      const tokenProgramId = tokenProgram(args.tokenProgramId);
      const accounts = deriveEscrowAccounts(config, args.contestId, args.assetMint);
      const creatorTokenAccount = args.creatorTokenAccount ?? args.playerTokenAccount;
      const joinerTokenAccount = args.joinerTokenAccount ?? args.playerTokenAccount;

      return new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: accounts.contest, isSigner: false, isWritable: true },
          { pubkey: args.assetMint, isSigner: false, isWritable: false },
          { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
          { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
          { pubkey: joinerTokenAccount, isSigner: false, isWritable: true },
          { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.refundExpiredContest,
      });
    },

    settleContest(args: SettleEscrowInstructionArgs) {
      const tokenProgramId = tokenProgram(args.tokenProgramId);
      const accounts = deriveEscrowAccounts(config, args.contestId, args.assetMint);
      const winnerTokenAccount = args.winner
        ? associatedTokenAccount(args.winner, args.assetMint, tokenProgramId)
        : args.whiteTokenAccount;
      const feeTokenAccount = associatedTokenAccount(config.feeAuthority, args.assetMint, tokenProgramId);
      const data = Buffer.concat([
        DISCRIMINATORS.settleContest,
        optionPubkey(args.winner),
        anchorString(resultHashString(args.resultHash)),
      ]);

      return new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: accounts.globalConfig, isSigner: false, isWritable: false },
          { pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
          { pubkey: config.feeAuthority, isSigner: false, isWritable: false },
          { pubkey: args.assetMint, isSigner: false, isWritable: false },
          { pubkey: accounts.contest, isSigner: false, isWritable: true },
          { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
          { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: args.resultAuthority, isSigner: true, isWritable: false },
          { pubkey: winnerTokenAccount, isSigner: false, isWritable: true },
          { pubkey: args.whiteTokenAccount, isSigner: false, isWritable: true },
          { pubkey: args.blackTokenAccount, isSigner: false, isWritable: true },
          { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
          { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        ],
        data,
      });
    },

    reclaimContestRent(args: ReclaimEscrowRentInstructionArgs) {
      const tokenProgramId = tokenProgram(args.tokenProgramId);
      const accounts = deriveEscrowAccounts(config, args.contestId, args.assetMint);

      return new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: accounts.contest, isSigner: false, isWritable: true },
          { pubkey: args.assetMint, isSigner: false, isWritable: false },
          { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
          { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
          { pubkey: args.rentRecipient, isSigner: false, isWritable: true },
          { pubkey: tokenProgramId, isSigner: false, isWritable: false },
        ],
        data: DISCRIMINATORS.reclaimContestRent,
      });
    },
  };
}

export function createConfiguredEscrowInstructionFactory(): EscrowInstructionFactory | null {
  const programId = publicPaymentConfig.wager.escrowProgramId;
  if (!programId) return null;

  return createEscrowInstructionFactory({
    programId: new PublicKey(programId),
    gameId: envString("VITE_WAGER_GAME_ID", DEFAULT_GAME_ID),
    rulesHash: envString("VITE_WAGER_RULES_HASH", DEFAULT_RULES_HASH),
    contestTtlSeconds: envPositiveInteger("VITE_WAGER_CONTEST_TTL_SECONDS", DEFAULT_CONTEST_TTL_SECONDS),
    feeAuthority: new PublicKey(envString("VITE_WAGER_FEE_AUTHORITY", DEFAULT_FEE_AUTHORITY)),
  });
}
