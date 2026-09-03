import { automaticRblxAbi, resolveGameEscrow } from "../_shared/automaticRblx.mjs";
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  isAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { assertEscrowLifetime } from "./escrowLifetime.ts";

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_NATIVE_ETH = "0x0000000000000000000000000000000000000000";
export const ROBINHOOD_RBLX = "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8";
export const ROBINHOOD_UNIVERSAL_ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904";

export const robinhoodEscrowAbi = [
  { type: "function", name: "claimEth", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "createContest", stateMutability: "payable", inputs: [{ name: "contestId", type: "bytes32" }, { name: "expiresAt", type: "uint64" }], outputs: [] },
  { type: "function", name: "joinContest", stateMutability: "payable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "cancelUnmatched", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "refundExpired", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "settleContest", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }, { name: "winner", type: "address" }, { name: "resultHash", type: "bytes32" }], outputs: [] },
  { type: "function", name: "getContest", stateMutability: "view", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [{ name: "contest", type: "tuple", components: [{ name: "creator", type: "address" }, { name: "joiner", type: "address" }, { name: "winner", type: "address" }, { name: "stake", type: "uint128" }, { name: "expiresAt", type: "uint64" }, { name: "resultHash", type: "bytes32" }, { name: "state", type: "uint8" }, { name: "drawClaims", type: "uint8" }] }] },
] as const;

export type RobinhoodTransition = "white_deposit" | "black_deposit" | "white_refund" | "settle_finished" | "winner_claim";

export interface RobinhoodContestTerms {
  contestId: string;
  escrowAddress?: string | null;
  payoutMode?: string | null;
  whiteMinimumRblx?: string | null;
  blackMinimumRblx?: string | null;
  stakeRaw: string;
  whiteWallet: string;
  blackWallet?: string | null;
  winnerWallet?: string | null;
  resultHash?: string | null;
  requiredLifetimeSeconds?: number;
}

function envAddress(name: string): Address {
  const value = Deno.env.get(name)?.trim();
  if (!value || !isAddress(value)) throw new Error(`${name} is not configured`);
  return getAddress(value);
}

function rpcUrl(): string {
  return Deno.env.get("ROBINHOOD_RPC_URL")?.trim() || "https://rpc.mainnet.chain.robinhood.com";
}

export function configuredRobinhoodEscrow(): Address {
  return envAddress("ROBINHOOD_ESCROW_ADDRESS");
}

export function configuredAutomaticEscrow(): Address {
  return envAddress("ROBINHOOD_AUTO_ESCROW_ADDRESS");
}
export function escrowForRow(row: { robinhood_escrow_address?: string | null; payout_mode?: string | null }): Address {
  const address = resolveGameEscrow(row.robinhood_escrow_address, configuredRobinhoodEscrow(), Deno.env.get("ROBINHOOD_AUTO_ESCROW_ADDRESS"));
  if (row.payout_mode === "automatic_rblx" && address.toLowerCase() !== configuredAutomaticEscrow().toLowerCase()) throw new Error("Automatic payout escrow mismatch");
  return address;
}
export function robinhoodContestKey(contestId: string): Hex {
  return keccak256(stringToHex(contestId));
}

function normalizeBytes32(value: string): Hex {
  const hex = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Invalid bytes32 value");
  return hex as Hex;
}

export async function verifyRobinhoodTransition(
  kind: RobinhoodTransition,
  txHash: string,
  terms: RobinhoodContestTerms,
): Promise<string> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("Invalid Robinhood Chain transaction hash");
  const escrow = escrowForRow({ robinhood_escrow_address: terms.escrowAddress, payout_mode: terms.payoutMode });
  const automatic = terms.payoutMode === "automatic_rblx";
  const client = createPublicClient({ transport: http(rpcUrl()) });
  if (await client.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error("Unexpected escrow RPC chain");
  const hash = txHash as Hex;
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash }),
    client.getTransaction({ hash }),
  ]);
  if (receipt.status !== "success") throw new Error("Robinhood Chain transaction reverted");
  if (!transaction.to || transaction.to.toLowerCase() !== escrow.toLowerCase()) throw new Error("Transaction did not call the configured escrow");
  // A winner claim only unlocks a wallet-authored quote; it does not mutate game state.
  // One confirmed receipt keeps the two-step claim-and-swap UX responsive.
  const minimumConfirmations = kind === "winner_claim"
    ? 1
    : Math.max(1, Number(Deno.env.get("ROBINHOOD_MIN_CONFIRMATIONS") || 1));
  if (!Number.isSafeInteger(minimumConfirmations)) throw new Error("Invalid confirmation configuration");
  const confirmations = await client.getTransactionConfirmations({ hash });
  if (confirmations < BigInt(minimumConfirmations)) throw new Error("Robinhood Chain transaction is not sufficiently confirmed");

  const decoded = decodeFunctionData({ abi: [...robinhoodEscrowAbi, ...automaticRblxAbi], data: transaction.input });
  const contestKey = robinhoodContestKey(terms.contestId);
  const expectedFunction = kind === "white_deposit"
    ? (automatic ? "createRblxContest" : "createContest")
    : kind === "black_deposit"
      ? (automatic ? "joinRblxContest" : "joinContest")
      : kind === "white_refund"
        ? (decoded.functionName === "cancelUnmatched" ? "cancelUnmatched" : "refundExpired")
        : kind === "winner_claim"
          ? "claimEth"
          : "settleContest";
  if (decoded.functionName !== expectedFunction) throw new Error(`Unexpected escrow call: ${decoded.functionName}`);
  if (String(decoded.args?.[0]).toLowerCase() !== contestKey.toLowerCase()) throw new Error("Escrow contest id mismatch");

  if (automatic && (kind === "white_deposit" || kind === "black_deposit")) {
    const expectedMinimum = kind === "white_deposit" ? terms.whiteMinimumRblx : terms.blackMinimumRblx;
    const actualMinimum = decoded.args?.[kind === "white_deposit" ? 2 : 1];
    if (!expectedMinimum || BigInt(expectedMinimum) <= 0n || BigInt(String(actualMinimum)) !== BigInt(expectedMinimum)) throw new Error("Payout authorization differs from the deposit");
  }
  const actor = transaction.from.toLowerCase();
  if (kind === "white_deposit") {
    if (actor !== terms.whiteWallet.toLowerCase()) throw new Error("Escrow creator mismatch");
    const expiresAt = BigInt(String(decoded.args?.[1] ?? 0));
    const configuredTtl = Number(Deno.env.get("PVP_WAGER_CONTEST_TTL_SECONDS") || 86_400);
    const configuredGrace = Number(Deno.env.get("PVP_WAGER_CONTEST_TTL_GRACE_SECONDS") || 300);
    const ttl = Number.isFinite(configuredTtl) ? Math.max(600, configuredTtl) : 86_400;
    const grace = Number.isFinite(configuredGrace) ? Math.max(60, configuredGrace) : 300;
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt <= now || expiresAt > BigInt(now + ttl + grace)) throw new Error("Escrow expiry is outside the configured window");
  } else if (kind === "white_refund") {
    const isCreator = actor === terms.whiteWallet.toLowerCase();
    const isJoiner = Boolean(terms.blackWallet && actor === terms.blackWallet.toLowerCase());
    if (decoded.functionName === "cancelUnmatched" ? !isCreator : !isCreator && !isJoiner) {
      throw new Error("Escrow refund actor mismatch");
    }
  } else if (kind === "black_deposit") {
    if (!terms.blackWallet || actor !== terms.blackWallet.toLowerCase()) throw new Error("Escrow joiner mismatch");
  } else if (kind === "winner_claim") {
    if (!terms.winnerWallet || actor !== terms.winnerWallet.toLowerCase()) throw new Error("Escrow prize claimant mismatch");
  } else {
    const authority = envAddress("ROBINHOOD_RESULT_AUTHORITY");
    if (actor !== authority.toLowerCase()) throw new Error("Escrow result authority mismatch");
    const winner = String(decoded.args?.[1] ?? "").toLowerCase();
    const expectedWinner = (terms.winnerWallet || ROBINHOOD_NATIVE_ETH).toLowerCase();
    if (winner !== expectedWinner) throw new Error("Escrow winner mismatch");
    if (!terms.resultHash || String(decoded.args?.[2]).toLowerCase() !== normalizeBytes32(terms.resultHash).toLowerCase()) {
      throw new Error("Escrow result hash mismatch");
    }
  }

  if ((kind === "white_deposit" || kind === "black_deposit") && transaction.value !== BigInt(terms.stakeRaw)) {
    throw new Error("Escrow stake mismatch");
  }

  const contest = await client.readContract({
    address: escrow,
    abi: robinhoodEscrowAbi,
    functionName: "getContest",
    args: [contestKey],
  });
  if (contest.creator.toLowerCase() !== terms.whiteWallet.toLowerCase()) throw new Error("On-chain creator mismatch");
  if (contest.stake !== BigInt(terms.stakeRaw)) throw new Error("On-chain stake mismatch");
  if (kind === "white_deposit" || kind === "black_deposit") {
    // Required from the authoritative row; never accept a browser-supplied clock.
    assertEscrowLifetime(contest.expiresAt, Math.floor(Date.now() / 1000), terms.requiredLifetimeSeconds ?? 0);
  }
  if (kind === "white_deposit" && contest.state !== 1) throw new Error("Escrow is not awaiting an opponent");
  if (kind === "black_deposit") {
    if (contest.state !== 2) throw new Error("Escrow is not active");
    if (!terms.blackWallet || contest.joiner.toLowerCase() !== terms.blackWallet.toLowerCase()) throw new Error("On-chain joiner mismatch");
  }
  if (kind === "white_refund" && ![5, 6].includes(contest.state)) throw new Error("Escrow refund is not final");
  if (kind === "settle_finished") {
    const expectedState = terms.winnerWallet ? 3 : 4;
    if (contest.state !== expectedState && contest.state !== 6) throw new Error("Escrow result is not final");
    if (contest.winner.toLowerCase() !== (terms.winnerWallet || ROBINHOOD_NATIVE_ETH).toLowerCase()) throw new Error("On-chain winner mismatch");
    if (terms.resultHash && contest.resultHash.toLowerCase() !== normalizeBytes32(terms.resultHash).toLowerCase()) {
      throw new Error("On-chain result hash mismatch");
    }
  }
  if (kind === "winner_claim") {
    if (!terms.winnerWallet || contest.winner.toLowerCase() !== terms.winnerWallet.toLowerCase()) {
      throw new Error("On-chain winner mismatch");
    }
    if (contest.state !== 6) throw new Error("Escrow prize has not been claimed");
  }
  return hash.toLowerCase();
}
