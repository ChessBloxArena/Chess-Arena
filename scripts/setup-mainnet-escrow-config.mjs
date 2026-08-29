#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { sha256 } from "@noble/hashes/sha256";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_PROGRAM_ID = "9KqSa63Un4ZSge7RquC76yNRVetu2gaWD7VLDwwczsTs";
const DEFAULT_ADMIN_KEYPAIR = "~/.config/solana/chess-arena-deployer.json";
const DEFAULT_GAME_ID = "chess-arena";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const DISCRIMINATORS = {
  initializeGlobalConfig: Buffer.from([113, 216, 122, 131, 225, 209, 22, 55]),
  registerGame: Buffer.from([122, 44, 95, 58, 89, 33, 40, 59]),
  updateGameConfig: Buffer.from([180, 82, 7, 205, 89, 182, 61, 128]),
};

function usage() {
  console.log(`Usage:
node scripts/setup-mainnet-escrow-config.mjs \\
  --confirm-mainnet \\
  --result-authority <public-key>

Options:
  --admin-keypair <path>      Deployer/admin keypair path. Default: ${DEFAULT_ADMIN_KEYPAIR}
  --program-id <public-key>   Escrow program id. Default: ${DEFAULT_PROGRAM_ID}
  --rpc <url>                 Mainnet RPC URL. Default: ${DEFAULT_RPC_URL}
  --game-id <id>              Game id. Default: ${DEFAULT_GAME_ID}
  --supported-mint <mint>     Supported mint. Default: wSOL
  --max-stake-raw <integer>   Max stake in raw mint units. Default: 340000000
  --platform-fee-bps <bps>    Platform fee basis points. Default: 0
  --fee-authority <pubkey>    Fee authority. Default: admin public key
`);
}

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  return value;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function expandPath(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function loadKeypair(path) {
  const secret = JSON.parse(readFileSync(expandPath(path), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function seed(value) {
  return Buffer.from(value, "utf8");
}

function seedHash(value) {
  return Buffer.from(sha256(seed(value)));
}

function anchorString(value) {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value, 0);
  return buffer;
}

function bool(value) {
  return Buffer.from([value ? 1 : 0]);
}

function parseU16(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
  return parsed;
}

function parseU64(value, label) {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be a non-negative integer`);
  const parsed = BigInt(value);
  if (parsed > 18_446_744_073_709_551_615n) throw new Error(`${label} exceeds u64`);
  return parsed;
}

async function sendAndConfirm(connection, signer, instruction, label) {
  const transaction = new Transaction().add(instruction);
  transaction.feePayer = signer.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    maxRetries: 5,
    skipPreflight: false,
  });
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  console.log(`${label}: ${signature}`);
  return signature;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    usage();
    return;
  }
  if (!hasFlag("--confirm-mainnet")) {
    throw new Error("Refusing to setup mainnet escrow config without --confirm-mainnet");
  }

  const admin = loadKeypair(argValue("--admin-keypair", DEFAULT_ADMIN_KEYPAIR));
  const programId = new PublicKey(argValue("--program-id", DEFAULT_PROGRAM_ID));
  const rpcUrl = argValue("--rpc", DEFAULT_RPC_URL);
  const gameId = argValue("--game-id", DEFAULT_GAME_ID);
  const resultAuthorityInput = argValue("--result-authority", "");
  if (!resultAuthorityInput) throw new Error("Missing --result-authority <public-key>");

  const resultAuthority = new PublicKey(resultAuthorityInput);
  const supportedMint = new PublicKey(argValue("--supported-mint", WSOL_MINT));
  const feeAuthority = new PublicKey(argValue("--fee-authority", admin.publicKey.toBase58()));
  const maxStakeRaw = parseU64(argValue("--max-stake-raw", "340000000"), "max stake raw");
  const platformFeeBps = parseU16(argValue("--platform-fee-bps", "0"), "platform fee bps");

  const [globalConfig] = PublicKey.findProgramAddressSync([seed("global_config")], programId);
  const [gameConfig] = PublicKey.findProgramAddressSync([seed("game"), seedHash(gameId)], programId);

  const connection = new Connection(rpcUrl, "confirmed");
  const globalInfo = await connection.getAccountInfo(globalConfig, "confirmed");
  const gameInfo = await connection.getAccountInfo(gameConfig, "confirmed");

  console.log(`Program: ${programId.toBase58()}`);
  console.log(`Admin: ${admin.publicKey.toBase58()}`);
  console.log(`Result authority: ${resultAuthority.toBase58()}`);
  console.log(`Fee authority: ${feeAuthority.toBase58()}`);
  console.log(`Supported mint: ${supportedMint.toBase58()}`);
  console.log(`Game config: ${gameConfig.toBase58()}`);
  console.log(`Max stake raw: ${maxStakeRaw.toString()}`);
  console.log(`Platform fee bps: ${platformFeeBps}`);

  if (!globalInfo) {
    const data = Buffer.concat([
      DISCRIMINATORS.initializeGlobalConfig,
      feeAuthority.toBuffer(),
      u16(platformFeeBps),
    ]);
    await sendAndConfirm(connection, admin, new TransactionInstruction({
      programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }), "Initialized global config");
  } else {
    console.log("Global config already exists; leaving admin/fee authority unchanged.");
  }

  if (!gameInfo) {
    const data = Buffer.concat([
      DISCRIMINATORS.registerGame,
      anchorString(gameId),
      resultAuthority.toBuffer(),
      supportedMint.toBuffer(),
      u64(maxStakeRaw),
      u16(platformFeeBps),
    ]);
    await sendAndConfirm(connection, admin, new TransactionInstruction({
      programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: false },
        { pubkey: gameConfig, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }), "Registered game config");
  } else {
    const data = Buffer.concat([
      DISCRIMINATORS.updateGameConfig,
      resultAuthority.toBuffer(),
      supportedMint.toBuffer(),
      u64(maxStakeRaw),
      u16(platformFeeBps),
      bool(false),
      bool(true),
    ]);
    await sendAndConfirm(connection, admin, new TransactionInstruction({
      programId,
      keys: [
        { pubkey: globalConfig, isSigner: false, isWritable: false },
        { pubkey: gameConfig, isSigner: false, isWritable: true },
        { pubkey: admin.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    }), "Updated game config");
  }

  console.log("Mainnet escrow config setup complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
