import { robinhoodReadTransport } from '../supabase/functions/_shared/robinhoodReadTransport.mjs';
import { payAutomaticRblx } from "./automatic-rblx-payout-core.mjs";
import { automaticRblxAbi, resolveGameEscrow } from "../supabase/functions/_shared/automaticRblx.mjs";
import { settleRobinhoodRow } from "./robinhood-settlement-core.mjs";
import { createClient } from "@supabase/supabase-js";
import { createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbiItem, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const SUPABASE_URL = required("SUPABASE_URL");
const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
const SERVICE_TOKEN = required("PVP_REFEREE_SERVICE_TOKEN");
const ESCROW = getAddress(required("ROBINHOOD_ESCROW_ADDRESS"));
const AUTO_ESCROW = process.env.ROBINHOOD_AUTO_ESCROW_ADDRESS?.trim() ? getAddress(process.env.ROBINHOOD_AUTO_ESCROW_ADDRESS.trim()) : null;
const AUTO_ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904";
const AUTO_TOKEN = "0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8";
const RPC_URL = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const checkOnly = process.argv.includes("--check-only");
const privateKey = required("ROBINHOOD_RESULT_SIGNER_PRIVATE_KEY");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("ROBINHOOD_RESULT_SIGNER_PRIVATE_KEY must be a 32-byte hex key");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const abi = [
  { type: "function", name: "getContest", stateMutability: "view", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [{ type: "tuple", components: [{ name: "creator", type: "address" }, { name: "joiner", type: "address" }, { name: "winner", type: "address" }, { name: "stake", type: "uint128" }, { name: "expiresAt", type: "uint64" }, { name: "resultHash", type: "bytes32" }, { name: "state", type: "uint8" }, { name: "drawClaims", type: "uint8" }] }] },
  { type: "function", name: "settleContest", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }, { name: "winner", type: "address" }, { name: "resultHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "resultAuthority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const account = privateKeyToAccount(privateKey);
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });
const publicClient = createPublicClient({ chain, transport: robinhoodReadTransport(RPC_URL) });
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function bytes32(value, label) {
  const normalized = value?.startsWith("0x") ? value : `0x${value || ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

async function reportSettlement(row, hash, winner) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/pvp-referee`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action: "settle_finished_wager",
      serviceToken: SERVICE_TOKEN,
      gameId: row.id,
      paymentMode: "robinhood_eth_escrow",
      walletAddress: winner === ZERO_ADDRESS ? row.white_wallet_address : winner,
      assetMint: row.wager_asset_mint,
      stakeRaw: row.wager_stake_raw,
      escrowContestId: row.escrow_contest_id,
      transactionSignature: hash,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Referee returned ${response.status}`);
}

async function settleRow(row) {
  const escrow = resolveGameEscrow(row.robinhood_escrow_address, ESCROW, AUTO_ESCROW);
  const blockVariable = row.payout_mode === "automatic_rblx" ? "ROBINHOOD_AUTO_ESCROW_DEPLOY_BLOCK" : "ROBINHOOD_ESCROW_DEPLOY_BLOCK";
  const hash = await settleRobinhoodRow(row, { publicClient, wallet, supabase, reportSettlement, account, chain, escrow, abi, deployBlock: BigInt(required(blockVariable)) });
  console.log(`Settled ${row.id}: https://robinhoodchain.blockscout.com/tx/${hash}`);
}

async function processBatch() {
  const { data, error } = await supabase
    .from("pvp_games")
    .select("id,winner,white_wallet_address,black_wallet_address,wager_asset_mint,wager_stake_raw,escrow_contest_id,referee_result_hash,settlement_submitted_signature,robinhood_escrow_address,payout_mode")
    .eq("payment_mode", "robinhood_eth_escrow")
    .eq("wager_asset_kind", "native_eth")
    .eq("status", "finished")
    .eq("payment_status", "both_deposited")
    .in("settlement_status", ["pending", "failed"])
    .order("finished_at", { ascending: true })
    .limit(Number(process.env.ROBINHOOD_SETTLEMENT_BATCH_SIZE || 10));
  if (error) throw error;
  if (checkOnly) return data?.length || 0;
  for (const row of data || []) {
    try {
      row.escrow_contest_key = keccak256(stringToHex(row.escrow_contest_id));
      await settleRow(row);
    } catch (error) {
      console.error(`Failed to settle ${row.id}`, error);
    }
  }
  return data?.length || 0;
}

async function processAutomaticPayouts() {
  if (!AUTO_ESCROW) return 0;
  if (checkOnly) {
    const { count, error } = await supabase.from("pvp_games").select("id", { head: true, count: "exact" }).eq("payout_mode", "automatic_rblx").in("auto_payout_status", ["pending", "retrying"]);
    if (error) throw error;
    return count || 0;
  }
  let count = 0;
  for (let index = 0; index < 10; index++) {
    const { data, error } = await supabase.rpc("claim_automatic_rblx_payouts", { batch_size: 1 });
    if (error) throw error;
    const row = data?.[0];
    if (!row) break;
    count++;
    const update = async (patch) => {
      const { error } = await supabase.from("pvp_games").update(patch).eq("id", row.id).eq("payout_mode", "automatic_rblx");
      if (error) throw error;
    };
    try {
      const hash = await payAutomaticRblx(row, {
        publicClient, wallet, account, chain, escrow: AUTO_ESCROW, escrowAbi: abi, router: AUTO_ROUTER,
        quotePrize: async () => {
          const response = await fetch(`${SUPABASE_URL}/functions/v1/pvp-referee`, { method: "POST", headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ action: "get_automatic_rblx_quote", serviceToken: SERVICE_TOKEN, gameId: row.id }), signal: AbortSignal.timeout(65_000) });
          const quote = await response.json();
          if (!response.ok) throw new Error(quote.error || "Automatic payout quote unavailable");
          return quote;
        },
        saveCheckpoint: (hash) => update({ auto_payout_submitted_signature: hash }),
        recordPaid: ({ hash, asset, amount }) => update({ auto_payout_signature: hash, auto_payout_amount: amount, auto_payout_status: asset, auto_payout_error: null, auto_payout_retry_at: null, auto_payout_lease_until: null, updated_at: new Date().toISOString() }),
      });
      console.log(JSON.stringify({ event: "automatic_prize_paid", gameId: row.id, hash }));
    } catch (error) {
      await update({ auto_payout_status: "retrying", auto_payout_error: String(error.message || error).slice(0, 500), auto_payout_retry_at: new Date(Date.now() + 60_000).toISOString(), auto_payout_lease_until: null });
      console.error(JSON.stringify({ event: "automatic_prize_retry", gameId: row.id, message: String(error.message || error).slice(0, 300) }));
    }
  }
  return count;
}

if (AUTO_ESCROW) {
  BigInt(required("ROBINHOOD_AUTO_ESCROW_DEPLOY_BLOCK"));
  const [authority, router, token, delay] = await Promise.all([
    publicClient.readContract({ address: AUTO_ESCROW, abi, functionName: "resultAuthority" }),
    publicClient.readContract({ address: AUTO_ESCROW, abi: automaticRblxAbi, functionName: "swapRouter" }),
    publicClient.readContract({ address: AUTO_ESCROW, abi: automaticRblxAbi, functionName: "rblxToken" }),
    publicClient.readContract({ address: AUTO_ESCROW, abi: automaticRblxAbi, functionName: "FALLBACK_DELAY" }),
  ]);
  if (authority.toLowerCase() !== account.address.toLowerCase() || router.toLowerCase() !== AUTO_ROUTER || token.toLowerCase() !== AUTO_TOKEN || delay !== 900n) throw new Error("Automatic escrow configuration mismatch");
}
if (await publicClient.getChainId() !== chain.id) throw new Error("Unexpected settlement RPC chain");
BigInt(required("ROBINHOOD_ESCROW_DEPLOY_BLOCK"));
const authority = await publicClient.readContract({ address: ESCROW, abi, functionName: "resultAuthority" });
if (authority.toLowerCase() !== account.address.toLowerCase()) throw new Error("Worker key is not the escrow result authority");
if (await publicClient.getBalance({ address: account.address }) === 0n) throw new Error("Settlement authority has no ETH for gas");
console.log(JSON.stringify({ event: "worker_ready", chainId: chain.id, escrow: ESCROW, authority: account.address, checkOnly }));

const once = checkOnly || process.argv.includes("--once");
let lastHeartbeat = 0;
do {
  try {
    const pending = await processBatch();
    const automaticPayouts = await processAutomaticPayouts();
    if (once || pending || automaticPayouts || Date.now() - lastHeartbeat >= 300_000) {
      console.log(JSON.stringify({ event: "settlement_queue_checked", pending, automaticPayouts, checkOnly, checkedAt: new Date().toISOString() }));
      lastHeartbeat = Date.now();
    }
  } catch (error) {
    console.error("Settlement batch failed", error);
    if (once) throw error;
  }
  if (!once) await new Promise((resolve) => setTimeout(resolve, Number(process.env.ROBINHOOD_SETTLEMENT_POLL_MS || 15_000)));
} while (!once);
