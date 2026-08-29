#!/usr/bin/env node
import http from "node:http";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const REQUIRED_ENV_NAMES = [
  "PVP_SPONSORED_WAGERS_ENABLED",
  "PVP_REFEREE_KILL_SWITCH",
  "PVP_WAGER_SPONSOR_UNAVAILABLE",
  "PVP_SPONSOR_TREASURY_LOW",
  "PVP_SPONSOR_MIN_TREASURY_LAMPORTS",
  "PVP_WAGER_RENT_SPONSOR_ADDRESS",
  "PVP_WAGER_RENT_RECIPIENT_ADDRESS",
  "PVP_WAGER_ESCROW_PROGRAM_ID",
  "PVP_WAGER_SPONSOR_KEYPAIR_JSON",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const DEFAULT_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const DEFAULT_GAME_ID = "chess-arena";
const DEFAULT_RULES_HASH = "chess-arena-v1";
const DEFAULT_TTL_SECONDS = 600;
const MAX_BODY_BYTES = 16 * 1024;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = Number(process.env.PVP_SPONSOR_MAX_REQUESTS_PER_MINUTE ?? 30);
const ACTION_LEASE_MS = Number(process.env.PVP_SPONSOR_ACTION_LEASE_MS ?? 75_000);
const requestCounts = new Map();
const requestIds = new Map();
const actionLeases = new Map();

if (process.argv.includes("--print-env-contract")) {
  console.log(REQUIRED_ENV_NAMES.join("\n"));
  process.exit(0);
}

function boolEnv(name) {
  return process.env[name] === "true";
}

function stringEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requiredEnv(name) {
  const value = stringEnv(name);
  if (!value) throw httpError(503, "missing_env", `Missing ${name}`);
  return value;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

function seed(value) {
  return Buffer.from(value, "utf8");
}

function seedHash(value) {
  return sha256(seed(value));
}

function discriminator(name) {
  return sha256(seed(`global:${name}`)).subarray(0, 8);
}

function u32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value), 0);
  return out;
}

function i64(value) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value), 0);
  return out;
}

function anchorString(value) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32(bytes.length), bytes]);
}

function assertPublicKey(value, label) {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw httpError(400, "invalid_public_key", `Invalid ${label}`);
  }
}

function publicKey(value, label) {
  try {
    return new PublicKey(value);
  } catch {
    throw httpError(503, "invalid_config", `Invalid ${label}`);
  }
}

function parseStake(value) {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value) || BigInt(value) <= 0n) {
    throw httpError(400, "invalid_stake", "stakeRaw must be a positive integer");
  }
  return value;
}

function parseSigner() {
  const raw = requiredEnv("PVP_WAGER_SPONSOR_KEYPAIR_JSON");
  try {
    const bytes = JSON.parse(raw);
    if (!Array.isArray(bytes)) throw new Error("not-array");
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    throw httpError(503, "invalid_signer", "Sponsor signer keypair is invalid");
  }
}

function derivePdas(programId, gameId, contestId) {
  const globalConfig = PublicKey.findProgramAddressSync([seed("global_config")], programId)[0];
  const gameConfig = PublicKey.findProgramAddressSync([seed("game"), seedHash(gameId)], programId)[0];
  const nativeContest = PublicKey.findProgramAddressSync(
    [seed("native_contest"), gameConfig.toBytes(), seedHash(contestId)],
    programId,
  )[0];
  return { globalConfig, gameConfig, nativeContest };
}

function key(pubkey, isSigner, isWritable) {
  return { pubkey, isSigner, isWritable };
}

function buildInstruction(request, state, config) {
  const wallet = publicKey(request.walletAddress, "walletAddress");
  const { globalConfig, gameConfig, nativeContest } = derivePdas(
    config.programId,
    config.gameId,
    state.escrowContestId,
  );

  if (request.action === "white_deposit") {
    const expiresAt = Math.floor(Date.now() / 1000) + config.contestTtlSeconds;
    return new TransactionInstruction({
      programId: config.programId,
      keys: [
        key(globalConfig, false, false),
        key(gameConfig, false, false),
        key(nativeContest, false, true),
        key(wallet, true, true),
        key(config.sponsor.publicKey, true, true),
        key(SystemProgram.programId, false, false),
      ],
      data: Buffer.concat([
        discriminator("create_native_contest"),
        anchorString(state.escrowContestId),
        u64(state.stakeRaw),
        anchorString(config.rulesHash),
        i64(expiresAt),
      ]),
    });
  }

  if (request.action === "black_deposit") {
    return new TransactionInstruction({
      programId: config.programId,
      keys: [
        key(globalConfig, false, false),
        key(gameConfig, false, false),
        key(nativeContest, false, true),
        key(wallet, true, true),
        key(SystemProgram.programId, false, false),
      ],
      data: discriminator("join_native_contest"),
    });
  }

  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      key(nativeContest, false, true),
      key(wallet, true, true),
      key(config.rentRecipient, false, true),
    ],
    data: discriminator("cancel_native_contest"),
  });
}

function validateConfig() {
  const sponsor = parseSigner();
  const sponsorAddress = assertPublicKey(requiredEnv("PVP_WAGER_RENT_SPONSOR_ADDRESS"), "rent sponsor address");
  const rentRecipientAddress = assertPublicKey(requiredEnv("PVP_WAGER_RENT_RECIPIENT_ADDRESS"), "rent recipient address");
  if (sponsor.publicKey.toBase58() !== sponsorAddress) {
    throw httpError(503, "wrong_sponsor", "Sponsor signer does not match PVP_WAGER_RENT_SPONSOR_ADDRESS");
  }
  if (rentRecipientAddress !== sponsorAddress) {
    throw httpError(503, "unsupported_rent_recipient", "Current native escrow program reclaims rent to the sponsor address");
  }
  if (!boolEnv("PVP_SPONSORED_WAGERS_ENABLED") || boolEnv("PVP_REFEREE_KILL_SWITCH") || boolEnv("PVP_WAGER_SPONSOR_UNAVAILABLE")) {
    throw httpError(503, "sponsor_unavailable", "Sponsored wager signing is unavailable");
  }
  if (boolEnv("PVP_SPONSOR_TREASURY_LOW")) {
    throw httpError(503, "treasury_low", "Sponsored wager treasury is below the safety threshold");
  }

  const rpcUrl = stringEnv("PVP_WAGER_SOLANA_RPC_URL", stringEnv("WAGER_SOLANA_RPC_URL", DEFAULT_MAINNET_RPC));
  return {
    sponsor,
    rentRecipient: publicKey(rentRecipientAddress, "rent recipient address"),
    programId: publicKey(requiredEnv("PVP_WAGER_ESCROW_PROGRAM_ID"), "escrow program id"),
    gameId: stringEnv("PVP_WAGER_GAME_ID", stringEnv("WAGER_GAME_ID", DEFAULT_GAME_ID)),
    rulesHash: stringEnv("PVP_WAGER_RULES_HASH", stringEnv("WAGER_RULES_HASH", DEFAULT_RULES_HASH)),
    contestTtlSeconds: Number(stringEnv("PVP_WAGER_CONTEST_TTL_SECONDS", String(DEFAULT_TTL_SECONDS))),
    minTreasuryLamports: BigInt(requiredEnv("PVP_SPONSOR_MIN_TREASURY_LAMPORTS")),
    supabaseUrl: requiredEnv("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    connection: new Connection(rpcUrl, "confirmed"),
  };
}

function validateRequest(body) {
  if (!body || typeof body !== "object") throw httpError(400, "invalid_json", "Invalid JSON body");
  if (!["white_deposit", "black_deposit", "cancel_waiting"].includes(body.action)) {
    throw httpError(400, "invalid_action", "Invalid sponsored action");
  }
  for (const field of ["gameId", "sessionId", "sessionProof", "playerToken", "walletAddress", "requestId"]) {
    if (typeof body[field] !== "string" || !body[field].trim()) throw httpError(400, "missing_field", `Missing ${field}`);
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(body.requestId)) {
    throw httpError(400, "invalid_request_id", "Invalid request id");
  }
  const requestedAtMs = Number(body.requestedAtMs);
  if (!Number.isFinite(requestedAtMs) || Date.now() - requestedAtMs > 5 * 60 * 1000) {
    throw httpError(409, "stale_request_id", "Sponsored transaction request is stale");
  }
  return {
    action: body.action,
    gameId: body.gameId.trim(),
    sessionId: body.sessionId.trim(),
    sessionProof: body.sessionProof,
    playerToken: body.playerToken.trim(),
    walletAddress: assertPublicKey(body.walletAddress, "walletAddress"),
    stakeRaw: parseStake(String(body.stakeRaw ?? "")),
    assetKind: body.assetKind,
    requestId: body.requestId.trim(),
    requestedAtMs,
    expectedEscrowContestId: typeof body.expectedEscrowContestId === "string" ? body.expectedEscrowContestId.trim() : "",
  };
}

function requestRateLimitKey(req) {
  if (boolEnv("PVP_TRUST_PROXY_HEADERS")) {
    const cloudflareIp = String(req.headers["cf-connecting-ip"] ?? "").trim();
    if (cloudflareIp) return cloudflareIp;
    const realIp = String(req.headers["x-real-ip"] ?? "").trim();
    if (realIp) return realIp;
    const forwardedFor = String(req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwardedFor.length) return forwardedFor[forwardedFor.length - 1];
  }
  return String(req.socket.remoteAddress ?? "unknown").trim();
}

function enforceRateLimit(req) {
  const ip = requestRateLimitKey(req);
  const now = Date.now();
  const bucket = requestCounts.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
  if (bucket.resetAt <= now) {
    bucket.count = 0;
    bucket.resetAt = now + WINDOW_MS;
  }
  bucket.count += 1;
  requestCounts.set(ip, bucket);
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    throw httpError(429, "rate_limited", "Too many sponsored transaction requests");
  }
}

function reserveRequestId(request) {
  const now = Date.now();
  for (const [keyName, expiresAt] of requestIds.entries()) {
    if (expiresAt <= now) requestIds.delete(keyName);
  }
  for (const [keyName, expiresAt] of actionLeases.entries()) {
    if (expiresAt <= now) actionLeases.delete(keyName);
  }
  const keyName = `${request.sessionId}:${request.gameId}:${request.requestId}`;
  if (requestIds.has(keyName)) throw httpError(409, "duplicate_request_id", "Duplicate sponsored transaction request");
  const contestKey = request.expectedEscrowContestId || "unknown-contest";
  const actionKey = `${request.sessionId}:${request.gameId}:${request.action}:${request.walletAddress}:${contestKey}`;
  if (actionLeases.has(actionKey)) {
    throw httpError(429, "sponsored_action_in_flight", "A sponsored transaction for this wager is already in progress. Try again shortly.");
  }
  requestIds.set(keyName, now + 5 * 60 * 1000);
  actionLeases.set(actionKey, now + (Number.isFinite(ACTION_LEASE_MS) && ACTION_LEASE_MS > 0 ? ACTION_LEASE_MS : 75_000));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, "body_too_large", "Request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function refereeInvoke(config, body) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/pvp-referee`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw httpError(response.status || 502, payload?.code ?? "referee_error", payload?.error ?? "Referee request failed");
  }
  return payload;
}

async function getSponsoredState(config, request) {
  const response = await refereeInvoke(config, {
    action: "get_sponsored_wager_state",
    gameId: request.gameId,
    sessionId: request.sessionId,
    sessionProof: request.sessionProof,
    playerToken: request.playerToken,
    paymentMode: "native_sol_sponsored",
  });
  const state = response.sponsoredWager;
  if (!state || typeof state !== "object") throw httpError(502, "bad_referee_response", "Referee returned no wager state");
  if (state.gameId !== request.gameId) throw httpError(409, "wrong_game", "Referee returned the wrong game id");
  if (state.paymentMode !== "native_sol_sponsored" || state.assetKind !== "native_sol") {
    throw httpError(409, "wrong_payment_mode", "Game is not a native sponsored wager");
  }
  if (state.stakeRaw !== request.stakeRaw) throw httpError(409, "wrong_stake", "Wager stake mismatch");
  if (request.expectedEscrowContestId && state.escrowContestId !== request.expectedEscrowContestId) {
    throw httpError(409, "wrong_contest", "Wager contest id mismatch");
  }
  if (state.rentSponsorAddress !== config.sponsor.publicKey.toBase58()) throw httpError(409, "wrong_sponsor", "Wager sponsor mismatch");
  if (state.rentRecipientAddress !== config.rentRecipient.toBase58()) throw httpError(409, "wrong_rent_recipient", "Wager rent recipient mismatch");

  if (request.action === "white_deposit") {
    if (state.paymentStatus !== "white_prepared") throw httpError(409, "wrong_payment_state", "White deposit is not prepared");
    if (state.whiteWalletAddress && state.whiteWalletAddress !== request.walletAddress) throw httpError(409, "wrong_wallet", "White wallet mismatch");
  } else if (request.action === "black_deposit") {
    if (state.paymentStatus !== "black_prepared") throw httpError(409, "wrong_payment_state", "Black deposit is not prepared");
    if (state.blackWalletAddress && state.blackWalletAddress !== request.walletAddress) throw httpError(409, "wrong_wallet", "Black wallet mismatch");
  } else {
    if (!["white_prepared", "white_deposited", "black_prepared"].includes(String(state.paymentStatus))) {
      throw httpError(409, "wrong_payment_state", "Sponsored wager is not cancellable");
    }
    if (state.whiteWalletAddress && state.whiteWalletAddress !== request.walletAddress) {
      throw httpError(409, "wrong_wallet", "Only white can cancel");
    }
  }
  return state;
}

async function handleSponsoredTransaction(body, config) {
  const request = validateRequest(body);
  if (request.assetKind !== "native_sol") throw httpError(409, "wrong_asset_kind", "Sponsored wagers only support native SOL");
  reserveRequestId(request);

  const balance = await config.connection.getBalance(config.sponsor.publicKey, "confirmed");
  if (BigInt(balance) < config.minTreasuryLamports) {
    throw httpError(503, "treasury_low", "Sponsored wager treasury is below the safety threshold");
  }

  const state = await getSponsoredState(config, request);
  const instruction = buildInstruction(request, state, config);
  const blockhash = await config.connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction();
  transaction.feePayer = config.sponsor.publicKey;
  transaction.recentBlockhash = blockhash.blockhash;
  transaction.lastValidBlockHeight = blockhash.lastValidBlockHeight;
  transaction.add(instruction);
  transaction.partialSign(config.sponsor);
  const sponsorSignatureCount = transaction.signatures.filter((signature) =>
    signature.publicKey.equals(config.sponsor.publicKey) && signature.signature
  ).length;
  if (sponsorSignatureCount < 1) {
    throw httpError(503, "missing_sponsor_signature", "Sponsor signer returned an unsigned transaction");
  }

  return {
    serializedTransaction: Buffer.from(transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    })).toString("base64"),
    lastValidBlockHeight: blockhash.lastValidBlockHeight,
    sponsorSignatureCount,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requestId: request.requestId,
    gameId: request.gameId,
    contestId: state.escrowContestId,
    stakeRaw: state.stakeRaw,
    escrowProgramId: config.programId.toBase58(),
    rentSponsorAddress: config.sponsor.publicKey.toBase58(),
    rentRecipientAddress: config.rentRecipient.toBase58(),
  };
}

let config;
try {
  config = validateConfig();
} catch (error) {
  console.error("Sponsored wager signer configuration error:", error.code ?? "config_error", error.message);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    if (req.method === "GET" && req.url === "/health") {
      if (!config) throw httpError(503, "signer_unconfigured", "Sponsored signer is not configured");
      return json(res, 200, { ok: true });
    }
    if (req.method !== "POST" || !req.url?.startsWith("/wager/sponsored-transaction")) {
      return json(res, 404, { error: "Not found", code: "not_found" });
    }
    if (!config) throw httpError(503, "signer_unconfigured", "Sponsored signer is not configured");
    enforceRateLimit(req);
    const body = await readJson(req);
    return json(res, 200, await handleSponsoredTransaction(body, config));
  } catch (error) {
    const status = Number(error.status ?? 500);
    const code = String(error.code ?? "sponsor_error");
    const message = status >= 500 ? "Sponsor service unavailable. Try again shortly." : error.message;
    if (status >= 500) console.error("Sponsored signer error:", code, error.message);
    return json(res, status, { error: message, code });
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, "0.0.0.0", () => {
  console.error(`Sponsored wager signer listening on ${port}`);
});
