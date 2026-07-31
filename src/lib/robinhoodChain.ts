import { resolveGameEscrow } from "../../supabase/functions/_shared/automaticRblx.mjs";
import { defineChain, getAddress, isAddress, keccak256, stringToHex, type Address } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const ROBINHOOD_EXPLORER_URL = "https://robinhoodchain.blockscout.com";
export const NATIVE_ETH_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const ROBINHOOD_WETH_ADDRESS = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;
export const ROBINHOOD_RBLX_ADDRESS = "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8" as const;
export const ROBINHOOD_UNIVERSAL_ROUTER_ADDRESS = "0x8876789976decbfcbbbe364623c63652db8c0904" as const;
export const ROBINHOOD_RBLX_LOGO_URL = "https://cdn.robinhood.com/ncw_assets/logos/0xf0c4bf4c582cb3836e98394b1d4e7b7281101be8.png";

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [import.meta.env.VITE_ROBINHOOD_RPC_URL || ROBINHOOD_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: ROBINHOOD_EXPLORER_URL },
  },
});

export function robinhoodEscrowAddress(): Address | null {
  const value = import.meta.env.VITE_ROBINHOOD_ESCROW_ADDRESS?.trim();
  return value && isAddress(value) ? getAddress(value) : null;
}

export function robinhoodContestKey(contestId: string): `0x${string}` {
  return keccak256(stringToHex(contestId));
}

export function robinhoodTransactionUrl(hash: string): string {
  return `${ROBINHOOD_EXPLORER_URL}/tx/${encodeURIComponent(hash)}`;
}

export const robinhoodChessEscrowAbi = [
  { type: "function", name: "createContest", stateMutability: "payable", inputs: [{ name: "contestId", type: "bytes32" }, { name: "expiresAt", type: "uint64" }], outputs: [] },
  { type: "function", name: "joinContest", stateMutability: "payable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "cancelUnmatched", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "refundExpired", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "claimEth", stateMutability: "nonpayable", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [] },
  { type: "function", name: "claimableAmount", stateMutability: "view", inputs: [{ name: "contestId", type: "bytes32" }, { name: "account", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "getContest", stateMutability: "view", inputs: [{ name: "contestId", type: "bytes32" }], outputs: [{ name: "contest", type: "tuple", components: [{ name: "creator", type: "address" }, { name: "joiner", type: "address" }, { name: "winner", type: "address" }, { name: "stake", type: "uint128" }, { name: "expiresAt", type: "uint64" }, { name: "resultHash", type: "bytes32" }, { name: "state", type: "uint8" }, { name: "drawClaims", type: "uint8" }] }] },
] as const;

export function rblxConversionEnabled(): boolean {
  return import.meta.env.VITE_RBLX_CONVERSION_ENABLED === "true";
}

export function automaticRblxPayoutEnabled(): boolean {
  return import.meta.env.VITE_AUTOMATIC_RBLX_PAYOUT_ENABLED === "true";
}
export function automaticRobinhoodEscrowAddress(): Address | null {
  const value = import.meta.env.VITE_ROBINHOOD_AUTO_ESCROW_ADDRESS?.trim();
  return value && isAddress(value) ? getAddress(value) : null;
}
export function robinhoodEntryEscrowAddress(): Address | null {
  return automaticRblxPayoutEnabled() ? automaticRobinhoodEscrowAddress() : robinhoodEscrowAddress();
}
export function gameEscrowAddress(address?: string | null, payoutMode?: string | null): Address {
  const result = resolveGameEscrow(address, robinhoodEscrowAddress(), automaticRobinhoodEscrowAddress());
  if (payoutMode === "automatic_rblx" && result.toLowerCase() !== automaticRobinhoodEscrowAddress()?.toLowerCase()) throw new Error("Automatic payout escrow mismatch");
  return result;
}
