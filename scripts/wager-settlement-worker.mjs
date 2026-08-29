#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { sha256 } from "@noble/hashes/sha256";
import { createClient } from "@supabase/supabase-js";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const SETTLE_CONTEST_DISCRIMINATOR = Buffer.from([79, 122, 33, 192, 110, 98, 219, 238]);
const REFUND_EXPIRED_CONTEST_DISCRIMINATOR = Buffer.from([222, 197, 170, 188, 114, 189, 2, 20]);
const RECLAIM_CONTEST_RENT_DISCRIMINATOR = Buffer.from([94, 36, 53, 152, 64, 248, 229, 180]);
const NATIVE_SOL_ASSET_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_GAME_ID = "chess-arena";
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LOOP_INTERVAL_MS = 15_000;
const ZERO_PUBKEY = new PublicKey("11111111111111111111111111111111");
const NATIVE_CONTEST_CREATED_STATE = 0;
const CPU_REWARD_MINT = "Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump";
const CPU_REWARD_TOKEN_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const CPU_REWARD_DECIMALS = 6;
const CPU_REWARD_BATCH_SIZE = 5;
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function base58Encode(bytes) {
  if (!bytes.length) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    output += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
}

function optionalEnv(name, fallback) {
  const value = process.env[name]?.trim();
  return value || fallback;
}

function keypairFromEnv() {
  return keypairFromSpecificEnv("RESULT_SIGNER_KEYPAIR_JSON", "RESULT_SIGNER_KEYPAIR_PATH", "Result signer");
}

function keypairFromSpecificEnv(jsonName, pathName, label) {
  const rawJson = process.env[jsonName]?.trim();
  const path = process.env[pathName]?.trim();
  const raw = rawJson || (path ? readFileSync(path, "utf8") : "");
  if (!raw) throw new Error(`Missing ${jsonName} or ${pathName}`);
  const secret = JSON.parse(raw);
  if (!Array.isArray(secret)) throw new Error(`${label} keypair must be a JSON array`);
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function seed(value) {
  return new TextEncoder().encode(value);
}

function seedHash(value) {
  return sha256(seed(value));
}

function derive(programId, seeds) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function deriveEscrowAccounts(programId, gameId, contestId, mint) {
  const globalConfig = derive(programId, [seed("global_config")]);
  const gameConfig = derive(programId, [seed("game"), seedHash(gameId)]);
  const contest = derive(programId, [seed("contest"), gameConfig.toBytes(), seedHash(contestId)]);
  const contestVault = derive(programId, [seed("contest_vault"), contest.toBytes(), mint.toBytes()]);
  const vaultAuthority = derive(programId, [seed("vault_authority"), contest.toBytes()]);
  return { globalConfig, gameConfig, contest, contestVault, vaultAuthority };
}

function deriveNativeEscrowAccounts(programId, gameId, contestId) {
  const globalConfig = derive(programId, [seed("global_config")]);
  const gameConfig = derive(programId, [seed("game"), seedHash(gameId)]);
  const nativeContest = derive(programId, [seed("native_contest"), gameConfig.toBytes(), seedHash(contestId)]);
  return { globalConfig, gameConfig, nativeContest };
}

function discriminator(name) {
  return Buffer.from(sha256(seed(`global:${name}`))).subarray(0, 8);
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function anchorString(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function optionPubkey(value) {
  if (!value) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), Buffer.from(value.toBytes())]);
}

function tokenProgram(programId) {
  if (programId.equals(TOKEN_PROGRAM_ID) || programId.equals(TOKEN_2022_PROGRAM_ID)) return programId;
  throw new Error("Escrow token program must be SPL Token or Token-2022");
}

function paymentMode(row) {
  return row.payment_mode === "native_sol_sponsored" ? "native_sol_sponsored" : "wsol_escrow";
}

function ata(owner, mint, programId) {
  return getAssociatedTokenAddressSync(mint, owner, false, tokenProgram(programId), ASSOCIATED_TOKEN_PROGRAM_ID);
}

function cpuRewardPayerFromEnv() {
  return keypairFromSpecificEnv("CPU_REWARD_PAYER_KEYPAIR_JSON", "CPU_REWARD_PAYER_KEYPAIR_PATH", "CPU reward payer");
}

function winnerWallet(row) {
  if (row.winner === "w") return new PublicKey(row.white_wallet_address);
  if (row.winner === "b") return new PublicKey(row.black_wallet_address);
  return null;
}

function refereeWalletAddress(row) {
  const wallet = winnerWallet(row) ?? new PublicKey(row.white_wallet_address);
  return wallet.toBase58();
}

function eligibleBlocker(row) {
  if (row.status !== "finished") return "not finished";
  if (row.payment_status !== "both_deposited") return "deposits incomplete";
  if (!["wsol_escrow", "native_sol_sponsored"].includes(paymentMode(row))) return "unsupported payment mode";
  if (!["pending", "failed"].includes(String(row.settlement_status))) return "settlement not pending";
  if (row.settlement_signature || row.settlement_status === "settled") return "already settled";
  if (!["w", "b", "draw"].includes(String(row.winner))) return "missing winner";
  if (!row.referee_result_hash || row.referee_result_hash.length !== 64) return "missing referee result hash";
  if (!row.white_wallet_address || !row.black_wallet_address) return "missing player wallets";
  if (!row.wager_asset_mint || !row.wager_stake_raw || !row.escrow_contest_id) return "missing wager terms";
  return null;
}

function buildSettlementTransaction({ row, resultSigner, programId, gameId, mint, tokenProgramId, feeAuthority }) {
  const accounts = deriveEscrowAccounts(programId, gameId, row.escrow_contest_id, mint);
  const white = new PublicKey(row.white_wallet_address);
  const black = new PublicKey(row.black_wallet_address);
  const winner = winnerWallet(row);
  const whiteTokenAccount = ata(white, mint, tokenProgramId);
  const blackTokenAccount = ata(black, mint, tokenProgramId);
  const winnerTokenAccount = winner ? ata(winner, mint, tokenProgramId) : whiteTokenAccount;
  const feeTokenAccount = ata(feeAuthority, mint, tokenProgramId);
  const transaction = new Transaction();
  transaction.feePayer = resultSigner.publicKey;

  transaction.add(createAssociatedTokenAccountIdempotentInstruction(
    resultSigner.publicKey,
    whiteTokenAccount,
    white,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ));

  transaction.add(createAssociatedTokenAccountIdempotentInstruction(
    resultSigner.publicKey,
    blackTokenAccount,
    black,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ));

  transaction.add(createAssociatedTokenAccountIdempotentInstruction(
    resultSigner.publicKey,
    feeTokenAccount,
    feeAuthority,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ));

  transaction.add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: accounts.globalConfig, isSigner: false, isWritable: false },
      { pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: feeAuthority, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: accounts.contest, isSigner: false, isWritable: true },
      { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: resultSigner.publicKey, isSigner: true, isWritable: false },
      { pubkey: winnerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: whiteTokenAccount, isSigner: false, isWritable: true },
      { pubkey: blackTokenAccount, isSigner: false, isWritable: true },
      { pubkey: feeTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      SETTLE_CONTEST_DISCRIMINATOR,
      optionPubkey(winner),
      anchorString(row.referee_result_hash),
    ]),
  }));

  return transaction;
}

function buildReclaimContestRentTransaction({ row, resultSigner, programId, gameId, mint, tokenProgramId }) {
  if (row.wager_asset_mint && row.wager_asset_mint !== mint.toBase58()) {
    throw new Error("wSOL rent reclaim received a different mint");
  }
  const accounts = deriveEscrowAccounts(programId, gameId, row.escrow_contest_id, mint);
  const rentRecipient = new PublicKey(row.white_wallet_address);
  const transaction = new Transaction();
  transaction.feePayer = resultSigner.publicKey;

  transaction.add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: accounts.contest, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: rentRecipient, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: RECLAIM_CONTEST_RENT_DISCRIMINATOR,
  }));

  return { transaction, contest: accounts.contest, contestVault: accounts.contestVault, rentRecipient };
}

function buildNativeSponsoredSettlementTransaction({ row, resultSigner, programId, gameId, feeAuthority }) {
  if (row.wager_asset_mint && row.wager_asset_mint !== NATIVE_SOL_ASSET_MINT) {
    throw new Error("native sponsored settlement received a non-native asset mint");
  }
  const accounts = deriveNativeEscrowAccounts(programId, gameId, row.escrow_contest_id);
  const white = new PublicKey(row.white_wallet_address);
  const black = new PublicKey(row.black_wallet_address);
  const winner = winnerWallet(row);
  const rentRecipient = new PublicKey(row.rent_recipient_address || resultSigner.publicKey.toBase58());
  const transaction = new Transaction();
  transaction.feePayer = resultSigner.publicKey;

  transaction.add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: accounts.globalConfig, isSigner: false, isWritable: false },
      { pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: feeAuthority, isSigner: false, isWritable: true },
      { pubkey: accounts.nativeContest, isSigner: false, isWritable: true },
      { pubkey: resultSigner.publicKey, isSigner: true, isWritable: false },
      { pubkey: white, isSigner: false, isWritable: true },
      { pubkey: black, isSigner: false, isWritable: true },
      { pubkey: rentRecipient, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat([
      discriminator("settle_native_contest"),
      optionPubkey(winner),
      anchorString(row.referee_result_hash),
    ]),
  }));

  return { transaction, contest: accounts.nativeContest, rentRecipient };
}

function readU32(data, offset) {
  const value = data.readUInt32LE(offset.value);
  offset.value += 4;
  return value;
}

function readI64(data, offset) {
  const value = data.readBigInt64LE(offset.value);
  offset.value += 8;
  return value;
}

function readU64(data, offset) {
  const value = data.readBigUInt64LE(offset.value);
  offset.value += 8;
  return value;
}

function readU16(data, offset) {
  const value = data.readUInt16LE(offset.value);
  offset.value += 2;
  return value;
}

function skipPubkey(offset) {
  offset.value += 32;
}

function readPubkey(data, offset) {
  const value = new PublicKey(data.subarray(offset.value, offset.value + 32));
  offset.value += 32;
  return value;
}

function skipString(data, offset) {
  const length = readU32(data, offset);
  offset.value += length;
}

function readString(data, offset) {
  const length = readU32(data, offset);
  const value = data.subarray(offset.value, offset.value + length).toString("utf8");
  offset.value += length;
  return value;
}

function decodeContestLifecycle(data) {
  const offset = { value: 8 };
  skipPubkey(offset); // game_config
  skipString(data, offset); // contest_id
  skipPubkey(offset); // mint
  skipPubkey(offset); // vault
  offset.value += 8; // stake_amount
  skipPubkey(offset); // creator
  skipPubkey(offset); // joiner
  skipPubkey(offset); // result_authority
  skipPubkey(offset); // winner
  skipString(data, offset); // rules_hash
  skipString(data, offset); // result_hash
  const expiresAt = readI64(data, offset);
  offset.value += 8; // created_at
  offset.value += 8; // settled_at
  const state = data[offset.value];
  return { expiresAt, state };
}

function decodeNativeContestLifecycle(data) {
  const offset = { value: 8 };
  const assetKind = data[offset.value];
  offset.value += 1;
  readPubkey(data, offset); // game_config
  const contestId = readString(data, offset);
  const stakeAmount = readU64(data, offset);
  const creator = readPubkey(data, offset);
  const joiner = readPubkey(data, offset);
  readPubkey(data, offset); // rent_payer
  const rentRecipient = readPubkey(data, offset);
  readPubkey(data, offset); // result_authority
  readPubkey(data, offset); // winner
  readString(data, offset); // rules_hash
  readString(data, offset); // result_hash
  const expiresAt = readI64(data, offset);
  offset.value += 8; // created_at
  offset.value += 8; // settled_at
  readU16(data, offset); // platform_fee_bps
  const state = data[offset.value];
  return { assetKind, contestId, stakeAmount, creator, joiner, rentRecipient, expiresAt, state };
}

async function orphanRefundBlocker({ row, connection, programId, gameId, mint }) {
  if (row.status !== "waiting") return "not waiting";
  if (!["white_prepared", "white_deposited"].includes(String(row.payment_status))) return "not an orphan deposit state";
  if (row.black_session_id || row.black_wallet_address) return "opponent already attached";
  if (row.refund_signature || row.refund_status === "refunded" || row.payment_status === "refunded") return "already refunded";
  if (!row.white_wallet_address || !row.wager_asset_mint || !row.wager_stake_raw || !row.escrow_contest_id) return "missing wager terms";

  if (paymentMode(row) === "native_sol_sponsored") {
    if (row.wager_asset_mint !== NATIVE_SOL_ASSET_MINT) return "native sponsored row has non-native mint";
    const accounts = deriveNativeEscrowAccounts(programId, gameId, row.escrow_contest_id);
    const account = await connection.getAccountInfo(accounts.nativeContest, "confirmed");
    if (!account) return "native contest was never created";
    if (!account.owner.equals(programId)) return "native contest owner mismatch";

    const lifecycle = decodeNativeContestLifecycle(Buffer.from(account.data));
    if (lifecycle.assetKind !== 0) return "native contest asset kind mismatch";
    if (lifecycle.contestId !== row.escrow_contest_id) return "native contest id mismatch";
    if (lifecycle.creator.toBase58() !== row.white_wallet_address) return "native contest creator mismatch";
    if (lifecycle.stakeAmount !== BigInt(row.wager_stake_raw)) return "native contest stake mismatch";
    if (row.rent_recipient_address && lifecycle.rentRecipient.toBase58() !== row.rent_recipient_address) {
      return "native contest rent recipient mismatch";
    }
    if (lifecycle.state !== NATIVE_CONTEST_CREATED_STATE) return "native contest is not waiting for opponent";
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    if (lifecycle.expiresAt > nowSeconds) return "native contest not expired yet";
    if (BigInt(account.lamports) < BigInt(row.wager_stake_raw)) return "native contest is not funded";
    return null;
  }

  if (row.wager_asset_mint !== mint.toBase58()) return "different mint";

  const accounts = deriveEscrowAccounts(programId, gameId, row.escrow_contest_id, mint);
  const account = await connection.getAccountInfo(accounts.contest, "confirmed");
  if (!account) return "escrow was never created";
  if (!account.owner.equals(programId)) return "escrow owner mismatch";

  const lifecycle = decodeContestLifecycle(Buffer.from(account.data));
  if (lifecycle.state !== 0) return "escrow is not waiting for opponent";
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  if (lifecycle.expiresAt > nowSeconds) return "escrow not expired yet";

  const balance = await connection.getTokenAccountBalance(accounts.contestVault, "confirmed").catch(() => null);
  if (!balance || BigInt(balance.value.amount) < BigInt(row.wager_stake_raw)) return "escrow vault is not funded";
  return null;
}

function buildOrphanRefundTransaction({ row, resultSigner, programId, gameId, mint, tokenProgramId }) {
  if (paymentMode(row) === "native_sol_sponsored") {
    const accounts = deriveNativeEscrowAccounts(programId, gameId, row.escrow_contest_id);
    const creator = new PublicKey(row.white_wallet_address);
    const joiner = new PublicKey(row.black_wallet_address || row.white_wallet_address);
    const rentRecipient = new PublicKey(row.rent_recipient_address || row.rent_sponsor_address || resultSigner.publicKey.toBase58());
    const transaction = new Transaction();
    transaction.feePayer = resultSigner.publicKey;
    transaction.add(new TransactionInstruction({
      programId,
      keys: [
        { pubkey: accounts.nativeContest, isSigner: false, isWritable: true },
        { pubkey: creator, isSigner: false, isWritable: true },
        { pubkey: joiner, isSigner: false, isWritable: true },
        { pubkey: rentRecipient, isSigner: false, isWritable: true },
      ],
      data: discriminator("refund_expired_native_contest"),
    }));
    return transaction;
  }

  const accounts = deriveEscrowAccounts(programId, gameId, row.escrow_contest_id, mint);
  const creator = new PublicKey(row.white_wallet_address);
  const creatorTokenAccount = ata(creator, mint, tokenProgramId);
  const joinerTokenAccount = creatorTokenAccount;
  const transaction = new Transaction();
  transaction.feePayer = resultSigner.publicKey;

  transaction.add(createAssociatedTokenAccountIdempotentInstruction(
    resultSigner.publicKey,
    creatorTokenAccount,
    creator,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ));

  transaction.add(new TransactionInstruction({
    programId,
    keys: [
      { pubkey: accounts.contest, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: accounts.contestVault, isSigner: false, isWritable: true },
      { pubkey: accounts.vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: creatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: joinerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: REFUND_EXPIRED_CONTEST_DISCRIMINATOR,
  }));

  return transaction;
}

async function markFailure(supabase, row, error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Settlement worker failed";
  const retryCount = Number(row.settlement_retry_count ?? 0);
  await supabase.from("pvp_games").update({
    settlement_status: "failed",
    settlement_last_error: message,
    settlement_retry_count: Number.isFinite(retryCount) ? retryCount + 1 : 1,
    settlement_attempted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
}

async function markRefundFailure(supabase, row, error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Refund worker failed";
  const retryCount = Number(row.refund_retry_count ?? 0);
  await supabase.from("pvp_games").update({
    refund_status: "refund_retryable",
    refund_error: message,
    refund_retry_count: Number.isFinite(retryCount) ? retryCount + 1 : 1,
    refund_retryable_at: new Date().toISOString(),
    escrow_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
}

async function markRentReclaimFailure(supabase, row, error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Rent reclaim failed";
  await supabase.from("pvp_games").update({
    rent_reclaim_status: "failed",
    escrow_checked_at: new Date().toISOString(),
    operator_notes: message,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
}

async function markCpuRewardFailure(supabase, row, error) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "CPU reward payout failed";
  const retryCount = Number(row.payout_retry_count ?? 0);
  await supabase.from("cpu_match_results").update({
    payout_status: "failed",
    payout_error: message,
    payout_retry_count: Number.isFinite(retryCount) ? retryCount + 1 : 1,
    payout_attempted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).in("payout_status", ["pending", "failed", "processing"]);
}

function booleanEnv(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

function wsolRentReclaimEnabled() {
  return booleanEnv("PVP_WSOL_RENT_RECLAIM_ENABLED");
}

function cpuRewardsEnabled() {
  return booleanEnv("CPU_REWARDS_ENABLED");
}

function cpuRewardBatchSize() {
  const value = Number(optionalEnv("CPU_REWARD_WORKER_BATCH_SIZE", String(CPU_REWARD_BATCH_SIZE)));
  return Number.isFinite(value) && value > 0 ? Math.min(50, Math.floor(value)) : CPU_REWARD_BATCH_SIZE;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlockhashExpiredError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /block height exceeded|blockhash not found|has expired|transaction expired/i.test(message);
}

function isRetryableSendError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return isBlockhashExpiredError(error) ||
    /minimum context slot|node is behind|timeout|timed out|429|too many requests|try again/i.test(message);
}

async function signatureLanded(connection, signature) {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = value[0];
  if (!status) return false;
  if (status.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
  return status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized";
}

async function cpuRewardSignatureState(connection, signature) {
  const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const status = value[0];
  if (!status) return { state: "unknown" };
  if (status.err) return { state: "failed", error: JSON.stringify(status.err) };
  if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
    return { state: "paid" };
  }
  return { state: "submitted" };
}

function buildCpuRewardTransaction({ row, payer, mint, tokenProgramId, decimals }) {
  const recipient = new PublicKey(row.payout_wallet_address);
  const sourceTokenAccount = ata(payer.publicKey, mint, tokenProgramId);
  const recipientTokenAccount = ata(recipient, mint, tokenProgramId);
  const amountRaw = BigInt(row.payout_amount_raw ?? 0);
  if (amountRaw <= 0n) throw new Error("CPU reward payout amount is missing");

  const transaction = new Transaction();
  transaction.feePayer = payer.publicKey;
  transaction.add(createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    sourceTokenAccount,
    payer.publicKey,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ));
  transaction.add(createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    recipientTokenAccount,
    recipient,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  ));
  transaction.add(createTransferCheckedInstruction(
    sourceTokenAccount,
    mint,
    recipientTokenAccount,
    payer.publicKey,
    amountRaw,
    decimals,
    [],
    tokenProgramId,
  ));
  transaction.add(new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(`Chess Arena CPU reward:${row.id}`, "utf8"),
  }));
  return transaction;
}

async function claimCpuRewardRow(context, row) {
  const now = new Date().toISOString();
  const retryCount = Number(row.payout_retry_count ?? 0);
  const { data, error } = await context.supabase
    .from("cpu_match_results")
    .update({
      payout_status: "processing",
      payout_payer_address: context.cpuRewardPayer.publicKey.toBase58(),
      payout_error: null,
      payout_retry_count: Number.isFinite(retryCount) ? retryCount + 1 : 1,
      payout_attempted_at: now,
      updated_at: now,
    })
    .eq("id", row.id)
    .in("payout_status", ["pending", "failed"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function markCpuRewardSubmitted(context, row, signature) {
  const now = new Date().toISOString();
  const { error } = await context.supabase
    .from("cpu_match_results")
    .update({
      payout_status: "submitted",
      payout_signature: signature,
      payout_error: null,
      payout_submitted_at: now,
      updated_at: now,
    })
    .eq("id", row.id)
    .eq("payout_status", "processing");
  if (error) {
    console.error(JSON.stringify({
      resultId: row.id,
      status: "cpu_reward_signature_update_failed",
      signature,
      error: error.message,
    }));
    return false;
  }
  return true;
}

async function reconcileCpuRewardSignature(context, row) {
  if (!row.payout_signature) return false;
  const signatureState = await cpuRewardSignatureState(context.connection, row.payout_signature);
  const now = new Date().toISOString();
  if (signatureState.state === "paid") {
    const { error } = await context.supabase.from("cpu_match_results").update({
      payout_status: "paid",
      payout_error: null,
      payout_paid_at: now,
      updated_at: now,
    }).eq("id", row.id);
    if (error) throw error;
    console.log(JSON.stringify({ resultId: row.id, status: "cpu_reward_paid", signature: row.payout_signature }));
    return true;
  }
  if (signatureState.state === "failed") {
    const { error } = await context.supabase.from("cpu_match_results").update({
      payout_status: "failed",
      payout_error: `Submitted transaction failed: ${signatureState.error ?? "unknown error"}`.slice(0, 500),
      updated_at: now,
    }).eq("id", row.id);
    if (error) throw error;
    console.error(JSON.stringify({ resultId: row.id, status: "cpu_reward_transaction_failed", signature: row.payout_signature }));
    return true;
  }
  console.log(JSON.stringify({ resultId: row.id, status: "cpu_reward_confirmation_pending", signature: row.payout_signature }));
  return false;
}

async function waitForCpuRewardConfirmation(context, row, signature) {
  const deadlineMs = Date.now() + 45_000;
  while (Date.now() < deadlineMs) {
    const handled = await reconcileCpuRewardSignature(context, { ...row, payout_signature: signature });
    if (handled) return;
    await sleep(1500);
  }
}

async function payCpuRewardRow(context, row) {
  if (row.payout_status === "submitted") {
    await reconcileCpuRewardSignature(context, row);
    return;
  }

  const claimed = await claimCpuRewardRow(context, row);
  if (!claimed) {
    console.log(JSON.stringify({ resultId: row.id, status: "cpu_reward_claim_skipped" }));
    return;
  }

  const transaction = buildCpuRewardTransaction({
    row: claimed,
    payer: context.cpuRewardPayer,
    mint: context.cpuRewardMint,
    tokenProgramId: context.cpuRewardTokenProgramId,
    decimals: context.cpuRewardDecimals,
  });
  const { context: blockhashContext, value: latestBlockhash } = await context.connection.getLatestBlockhashAndContext("confirmed");
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  transaction.sign(context.cpuRewardPayer);
  const payerSignature = transaction.signatures.find(({ publicKey }) => publicKey.equals(context.cpuRewardPayer.publicKey))?.signature;
  if (!payerSignature) throw new Error("CPU reward transaction was not signed");
  const signature = base58Encode(payerSignature);
  const signatureStored = await markCpuRewardSubmitted(context, claimed, signature);
  if (!signatureStored) return;

  try {
    await context.connection.sendRawTransaction(transaction.serialize(), {
      maxRetries: 3,
      minContextSlot: blockhashContext.slot,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "CPU reward broadcast failed";
    await context.supabase.from("cpu_match_results").update({
      payout_error: `Broadcast status unknown: ${message}`,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id).eq("payout_signature", signature);
    console.error(JSON.stringify({
      resultId: row.id,
      status: "cpu_reward_broadcast_unknown",
      signature,
      error: message,
    }));
    return;
  }
  console.log(JSON.stringify({
    resultId: row.id,
    status: "cpu_reward_submitted",
    walletAddress: claimed.payout_wallet_address,
    amountRaw: String(claimed.payout_amount_raw),
    signature,
  }));
  await waitForCpuRewardConfirmation(context, claimed, signature);
}

async function sendAndConfirmResilient(connection, transaction, signers) {
  let lastError = null;
  const submittedSignatures = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { context, value: latestBlockhash } = await connection.getLatestBlockhashAndContext("confirmed");
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
    transaction.sign(...signers);
    const rawTransaction = transaction.serialize();
    let signature = null;

    try {
      signature = await connection.sendRawTransaction(rawTransaction, {
        maxRetries: 5,
        minContextSlot: context.slot,
        preflightCommitment: "confirmed",
        skipPreflight: attempt > 0,
      });
      submittedSignatures.push(signature);
    } catch (error) {
      lastError = error;
      for (const submittedSignature of submittedSignatures) {
        if (await signatureLanded(connection, submittedSignature)) return submittedSignature;
      }
      if (!isRetryableSendError(error) && !/already been processed|already processed/i.test(String(error))) throw error;
      await sleep(1200);
      continue;
    }

    try {
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      }, "confirmed");
      if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      return signature;
    } catch (error) {
      lastError = error;
      for (const submittedSignature of submittedSignatures) {
        if (await signatureLanded(connection, submittedSignature)) return submittedSignature;
      }
      if (!isRetryableSendError(error)) throw error;
      await sleep(1200);
    }
  }

  for (const submittedSignature of submittedSignatures) {
    if (await signatureLanded(connection, submittedSignature)) return submittedSignature;
  }
  throw lastError ?? new Error("Transaction expired before confirmation");
}

async function confirmAccountClosed(connection, account, label) {
  const info = await connection.getAccountInfo(account, "confirmed");
  if (info) throw new Error(`${label} was not closed after settlement`);
}

async function accountIsClosed(connection, account) {
  const info = await connection.getAccountInfo(account, "confirmed");
  return !info;
}

async function settleWsolEscrow(context, row) {
  const transaction = buildSettlementTransaction({
    row,
    resultSigner: context.resultSigner,
    programId: context.programId,
    gameId: context.gameId,
    mint: context.mint,
    tokenProgramId: context.tokenProgramId,
    feeAuthority: context.feeAuthority,
  });
  const signature = await sendAndConfirmResilient(context.connection, transaction, [context.resultSigner]);
  return { signature, rentReclaimStatus: "pending", rentReclaimSignature: null };
}

async function settleNativeSponsored(context, row) {
  if (row.referee_result_hash?.length !== 64) throw new Error("missing canonical referee result hash");
  const { transaction, contest } = buildNativeSponsoredSettlementTransaction({
    row,
    resultSigner: context.resultSigner,
    programId: context.programId,
    gameId: context.gameId,
    feeAuthority: context.feeAuthority,
  });
  const signature = await sendAndConfirmResilient(context.connection, transaction, [context.resultSigner]);
  await confirmAccountClosed(context.connection, contest, "Native sponsored contest account");
  return { signature, rentReclaimStatus: "reclaimed" };
}

async function settleRow(context, row) {
  return paymentMode(row) === "native_sol_sponsored"
    ? settleNativeSponsored(context, row)
    : settleWsolEscrow(context, row);
}

async function findRelevantSignature(connection, contest, resultSigner) {
  const signatures = await connection.getSignaturesForAddress(contest, { limit: 20 }, "confirmed").catch(() => []);
  for (const entry of signatures) {
    if (entry.err) continue;
    const tx = await connection.getParsedTransaction(entry.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }).catch(() => null);
    if (!tx || tx.meta?.err) continue;
    const keys = tx.transaction.message.accountKeys.map((account) => (
      "pubkey" in account ? account.pubkey.toBase58() : String(account)
    ));
    if (keys.includes(contest.toBase58()) && keys.includes(resultSigner.toBase58())) return entry.signature;
  }
  return null;
}

async function sponsoredRentEvidence(context, row) {
  const accounts = deriveNativeEscrowAccounts(context.programId, context.gameId, row.escrow_contest_id);
  const account = await context.connection.getAccountInfo(accounts.nativeContest, "confirmed");
  if (account) {
    return {
      contestClosed: false,
      transactionSignature: row.settlement_signature || row.rent_reclaim_signature || null,
      rentReclaimStatus: "pending",
    };
  }

  return {
    contestClosed: true,
    transactionSignature:
      row.settlement_signature ||
      row.rent_reclaim_signature ||
      await findRelevantSignature(context.connection, accounts.nativeContest, context.resultSigner.publicKey),
    rentReclaimStatus: "reclaimed",
  };
}

async function reclaimWsolEscrowRent(context, row) {
  const { transaction, contest, contestVault } = buildReclaimContestRentTransaction({
    row,
    resultSigner: context.resultSigner,
    programId: context.programId,
    gameId: context.gameId,
    mint: context.mint,
    tokenProgramId: context.tokenProgramId,
  });
  const signature = await sendAndConfirmResilient(context.connection, transaction, [context.resultSigner]);
  await confirmAccountClosed(context.connection, contest, "wSOL contest account");
  await confirmAccountClosed(context.connection, contestVault, "wSOL contest vault");
  return {
    contestClosed: true,
    vaultClosed: true,
    transactionSignature: signature,
    rentReclaimStatus: "reclaimed",
  };
}

async function wsolRentEvidence(context, row) {
  const accounts = deriveEscrowAccounts(context.programId, context.gameId, row.escrow_contest_id, context.mint);
  const [contestClosed, vaultClosed] = await Promise.all([
    accountIsClosed(context.connection, accounts.contest),
    accountIsClosed(context.connection, accounts.contestVault),
  ]);

  if (contestClosed && vaultClosed) {
    return {
      contestClosed: true,
      vaultClosed: true,
      transactionSignature:
        row.rent_reclaim_signature ||
        await findRelevantSignature(context.connection, accounts.contest, context.resultSigner.publicKey),
      rentReclaimStatus: "reclaimed",
    };
  }

  if (contestClosed !== vaultClosed) {
    throw new Error("wSOL escrow rent accounts are partially closed");
  }

  const balance = await context.connection.getTokenAccountBalance(accounts.contestVault, "confirmed").catch(() => null);
  if (balance && BigInt(balance.value.amount) !== 0n) {
    throw new Error("wSOL contest vault is not empty");
  }

  return reclaimWsolEscrowRent(context, row);
}

function createWorkerContext() {
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const connection = new Connection(optionalEnv("PVP_WAGER_SOLANA_RPC_URL", DEFAULT_RPC_URL), "confirmed");
  const resultSigner = keypairFromEnv();
  const serviceToken = requiredEnv("PVP_REFEREE_SERVICE_TOKEN");
  const programId = new PublicKey(requiredEnv("PVP_WAGER_ESCROW_PROGRAM_ID"));
  const gameId = optionalEnv("PVP_WAGER_GAME_ID", DEFAULT_GAME_ID);
  const mint = new PublicKey(optionalEnv("PVP_WAGER_ALLOWED_MINT", "So11111111111111111111111111111111111111112"));
  const tokenProgramId = new PublicKey(optionalEnv("PVP_WAGER_TOKEN_PROGRAM_ID", TOKEN_PROGRAM_ID.toBase58()));
  const feeAuthority = new PublicKey(optionalEnv("PVP_WAGER_FEE_AUTHORITY", ZERO_PUBKEY.toBase58()));
  const batchSize = Number(optionalEnv("PVP_SETTLEMENT_WORKER_BATCH_SIZE", String(DEFAULT_BATCH_SIZE)));
  const intervalMs = Number(optionalEnv("PVP_SETTLEMENT_WORKER_INTERVAL_MS", String(DEFAULT_LOOP_INTERVAL_MS)));
  const cpuRewards = cpuRewardsEnabled();
  const cpuRewardPayer = cpuRewards ? cpuRewardPayerFromEnv() : null;

  return {
    supabase,
    connection,
    resultSigner,
    serviceToken,
    programId,
    gameId,
    mint,
    tokenProgramId,
    feeAuthority,
    cpuRewards,
    cpuRewardPayer,
    cpuRewardMint: new PublicKey(optionalEnv("CPU_REWARD_TOKEN_MINT", CPU_REWARD_MINT)),
    cpuRewardTokenProgramId: new PublicKey(optionalEnv("CPU_REWARD_TOKEN_PROGRAM_ID", CPU_REWARD_TOKEN_PROGRAM_ID)),
    cpuRewardDecimals: Number(optionalEnv("CPU_REWARD_TOKEN_DECIMALS", String(CPU_REWARD_DECIMALS))),
    cpuRewardBatchSize: cpuRewardBatchSize(),
    batchSize,
    intervalMs: Number.isFinite(intervalMs) && intervalMs >= 5000 ? intervalMs : DEFAULT_LOOP_INTERVAL_MS,
  };
}

async function runSettlementPass(context) {
  const {
    supabase,
    serviceToken,
    batchSize,
  } = context;
  const { data, error } = await supabase
    .from("pvp_games")
    .select("*")
    .eq("status", "finished")
    .eq("payment_status", "both_deposited")
    .in("settlement_status", ["pending", "failed"])
    .order("updated_at", { ascending: true })
    .limit(Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE);

  if (error) throw error;

  for (const row of data ?? []) {
    const blocker = eligibleBlocker(row);
    if (blocker) {
      console.log(JSON.stringify({ gameId: row.id, status: "skipped", blocker }));
      continue;
    }

    try {
      const settlement = await settleRow(context, row);

      const response = await supabase.functions.invoke("pvp-referee", {
        body: {
          action: "settle_finished_wager",
          gameId: row.id,
          serviceToken,
          paymentMode: paymentMode(row),
          walletAddress: refereeWalletAddress(row),
          assetMint: row.wager_asset_mint,
          stakeRaw: row.wager_stake_raw,
          stakeLamports: row.wager_stake_raw,
          escrowContestId: row.escrow_contest_id,
          transactionSignature: settlement.signature,
          rentReclaimStatus: settlement.rentReclaimStatus,
          rentReclaimSignature: settlement.rentReclaimSignature ?? (
            paymentMode(row) === "native_sol_sponsored" ? settlement.signature : null
          ),
          contestClosed: paymentMode(row) === "native_sol_sponsored",
        },
      });

      if (response.error) throw response.error;
      console.log(JSON.stringify({ gameId: row.id, status: "settled", mode: paymentMode(row), signature: settlement.signature }));
    } catch (err) {
      await markFailure(supabase, row, err);
      console.error(JSON.stringify({
        gameId: row.id,
        status: "failed",
        error: err instanceof Error ? err.message : "Settlement failed",
      }));
    }
  }
}

async function runWsolRentReclaimPass(context) {
  const { supabase, serviceToken, batchSize } = context;
  if (!wsolRentReclaimEnabled()) {
    console.log(JSON.stringify({
      status: "wsol_rent_reclaim_disabled",
      reason: "Set PVP_WSOL_RENT_RECLAIM_ENABLED=true after the escrow program upgrade is live.",
    }));
    return;
  }

  const { data, error } = await supabase
    .from("pvp_games")
    .select("*")
    .eq("status", "finished")
    .eq("payment_mode", "wsol_escrow")
    .eq("payment_status", "settled")
    .eq("settlement_status", "settled")
    .or("rent_reclaim_status.is.null,rent_reclaim_status.in.(not_applicable,pending,reclaiming,failed,unknown)")
    .order("updated_at", { ascending: true })
    .limit(Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE);

  if (error) throw error;

  for (const row of data ?? []) {
    if (!row.escrow_contest_id || !row.wager_stake_raw || !row.white_wallet_address) {
      console.log(JSON.stringify({ gameId: row.id, status: "wsol_rent_reclaim_skipped", blocker: "missing wager terms" }));
      continue;
    }

    try {
      const evidence = await wsolRentEvidence(context, row);
      const response = await supabase.functions.invoke("pvp-referee", {
        body: {
          action: "reconcile_contest_rent",
          gameId: row.id,
          serviceToken,
          paymentMode: "wsol_escrow",
          assetMint: row.wager_asset_mint || NATIVE_SOL_ASSET_MINT,
          stakeRaw: row.wager_stake_raw,
          stakeLamports: row.wager_stake_raw,
          escrowContestId: row.escrow_contest_id,
          transactionSignature: evidence.transactionSignature,
          rentReclaimSignature: evidence.transactionSignature,
          rentReclaimStatus: evidence.rentReclaimStatus,
          contestClosed: evidence.contestClosed,
          vaultClosed: evidence.vaultClosed,
        },
      });
      if (response.error) throw response.error;
      console.log(JSON.stringify({
        gameId: row.id,
        status: evidence.contestClosed ? "wsol_rent_reclaimed" : "wsol_rent_pending",
        signature: evidence.transactionSignature,
      }));
    } catch (err) {
      await markRentReclaimFailure(supabase, row, err);
      console.error(JSON.stringify({
        gameId: row.id,
        status: "wsol_rent_reclaim_failed",
        error: err instanceof Error ? err.message : "wSOL rent reclamation failed",
      }));
    }
  }
}

async function runSponsoredRentReconcilePass(context) {
  const { supabase, serviceToken, batchSize } = context;
  const { data, error } = await supabase
    .from("pvp_games")
    .select("*")
    .eq("payment_mode", "native_sol_sponsored")
    .in("rent_reclaim_status", ["pending", "reclaiming", "failed", "unknown"])
    .order("updated_at", { ascending: true })
    .limit(Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE);

  if (error) throw error;

  for (const row of data ?? []) {
    if (!row.escrow_contest_id || !row.wager_stake_raw) {
      console.log(JSON.stringify({ gameId: row.id, status: "rent_reconcile_skipped", blocker: "missing wager terms" }));
      continue;
    }

    try {
      const evidence = await sponsoredRentEvidence(context, row);
      const response = await supabase.functions.invoke("pvp-referee", {
        body: {
          action: "reconcile_sponsored_rent",
          gameId: row.id,
          serviceToken,
          paymentMode: "native_sol_sponsored",
          assetMint: row.wager_asset_mint || NATIVE_SOL_ASSET_MINT,
          stakeRaw: row.wager_stake_raw,
          stakeLamports: row.wager_stake_raw,
          escrowContestId: row.escrow_contest_id,
          transactionSignature: evidence.transactionSignature,
          rentReclaimStatus: evidence.rentReclaimStatus,
          contestClosed: evidence.contestClosed,
        },
      });
      if (response.error) throw response.error;
      console.log(JSON.stringify({
        gameId: row.id,
        status: evidence.contestClosed ? "rent_reclaimed" : "rent_pending",
        signature: evidence.transactionSignature,
      }));
    } catch (err) {
      console.error(JSON.stringify({
        gameId: row.id,
        status: "rent_reconcile_failed",
        error: err instanceof Error ? err.message : "Sponsored rent reconciliation failed",
      }));
    }
  }
}

async function runCpuRewardPayoutPass(context) {
  if (!context.cpuRewards) return;
  if (!context.cpuRewardPayer) throw new Error("CPU reward payer is not configured");

  const { data, error } = await context.supabase
    .from("cpu_match_results")
    .select("*")
    .not("payout_wallet_address", "is", null)
    .in("payout_status", ["pending", "failed", "submitted"])
    .order("updated_at", { ascending: true })
    .limit(context.cpuRewardBatchSize);

  if (error) throw error;

  for (const row of data ?? []) {
    try {
      if (row.payout_token_mint !== context.cpuRewardMint.toBase58()) throw new Error("CPU reward mint mismatch");
      if (row.payout_token_program_id !== context.cpuRewardTokenProgramId.toBase58()) {
        throw new Error("CPU reward token program mismatch");
      }
      await payCpuRewardRow(context, row);
    } catch (err) {
      if (row.payout_status === "submitted" && row.payout_signature) {
        console.error(JSON.stringify({
          resultId: row.id,
          status: "cpu_reward_reconcile_failed",
          signature: row.payout_signature,
          error: err instanceof Error ? err.message : "CPU reward reconciliation failed",
        }));
        continue;
      }
      await markCpuRewardFailure(context.supabase, row, err);
      console.error(JSON.stringify({
        resultId: row.id,
        status: "cpu_reward_failed",
        error: err instanceof Error ? err.message : "CPU reward payout failed",
      }));
    }
  }
}

async function runOrphanRefundPass(context) {
  const {
    supabase,
    connection,
    resultSigner,
    programId,
    gameId,
    mint,
    tokenProgramId,
    batchSize,
  } = context;
  const { data, error } = await supabase
    .from("pvp_games")
    .select("*")
    .eq("status", "waiting")
    .in("payment_status", ["white_prepared", "white_deposited"])
    .is("black_session_id", null)
    .order("updated_at", { ascending: true })
    .limit(Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE);

  if (error) throw error;

  for (const row of data ?? []) {
    try {
      const blocker = await orphanRefundBlocker({ row, connection, programId, gameId, mint });
      if (blocker) {
        console.log(JSON.stringify({ gameId: row.id, status: "refund_skipped", blocker }));
        continue;
      }

      const transaction = buildOrphanRefundTransaction({
        row,
        resultSigner,
        programId,
        gameId,
        mint,
        tokenProgramId,
      });
      const signature = await sendAndConfirmResilient(connection, transaction, [resultSigner]);
      const now = new Date().toISOString();
      const { error: updateError } = await supabase.from("pvp_games").update({
        status: "cancelled",
        payment_status: "refunded",
        refund_status: "refunded",
        refund_signature: signature,
        refund_error: null,
        refunded_at: now,
        cancelled_at: now,
        escrow_onchain_state: "refunded",
        escrow_checked_at: now,
        updated_at: now,
      }).eq("id", row.id);

      if (updateError) throw updateError;
      console.log(JSON.stringify({ gameId: row.id, status: "refunded_orphan", signature }));
    } catch (err) {
      await markRefundFailure(supabase, row, err);
      console.error(JSON.stringify({
        gameId: row.id,
        status: "refund_failed",
        error: err instanceof Error ? err.message : "Refund failed",
      }));
    }
  }
}

async function main() {
  const context = createWorkerContext();
  const reconcileOnly =
    process.argv.includes("--reconcile-sponsored-rent") ||
    process.env.npm_lifecycle_event === "wager:reconcile-sponsored-rent";
  const reclaimContestRentOnly =
    process.argv.includes("--reclaim-contest-rent") ||
    process.env.npm_lifecycle_event === "wager:reclaim-contest-rent";

  if (reconcileOnly) {
    await runSponsoredRentReconcilePass(context);
    return;
  }

  if (reclaimContestRentOnly) {
    await runWsolRentReclaimPass(context);
    return;
  }

  if (!booleanEnv("PVP_SETTLEMENT_WORKER_LOOP")) {
    await runSettlementPass(context);
    await runWsolRentReclaimPass(context);
    await runSponsoredRentReconcilePass(context);
    await runOrphanRefundPass(context);
    await runCpuRewardPayoutPass(context);
    return;
  }

  console.log(JSON.stringify({
    status: "started",
    worker: "wager-settlement-worker",
    intervalMs: context.intervalMs,
  }));

  for (;;) {
    await runSettlementPass(context).catch((err) => {
      console.error(JSON.stringify({
        status: "pass_failed",
        error: err instanceof Error ? err.message : "Settlement pass failed",
      }));
    });
    await runWsolRentReclaimPass(context).catch((err) => {
      console.error(JSON.stringify({
        status: "wsol_rent_reclaim_pass_failed",
        error: err instanceof Error ? err.message : "wSOL rent reclamation pass failed",
      }));
    });
    await runOrphanRefundPass(context).catch((err) => {
      console.error(JSON.stringify({
        status: "refund_pass_failed",
        error: err instanceof Error ? err.message : "Refund pass failed",
      }));
    });
    await runSponsoredRentReconcilePass(context).catch((err) => {
      console.error(JSON.stringify({
        status: "rent_reconcile_pass_failed",
        error: err instanceof Error ? err.message : "Sponsored rent reconciliation pass failed",
      }));
    });
    await runCpuRewardPayoutPass(context).catch((err) => {
      console.error(JSON.stringify({
        status: "cpu_reward_pass_failed",
        error: err instanceof Error ? err.message : "CPU reward payout pass failed",
      }));
    });
    await sleep(context.intervalMs);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Settlement worker crashed");
  process.exit(1);
});
