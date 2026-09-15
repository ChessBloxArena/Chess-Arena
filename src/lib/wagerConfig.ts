import { formatEther, parseEther } from "viem";
import {
  NATIVE_ETH_ADDRESS,
  ROBINHOOD_EXPLORER_URL,
  ROBINHOOD_RBLX_ADDRESS,
  ROBINHOOD_RPC_URL,
} from "@/lib/robinhoodChain";

// Retained exports keep legacy Solana utilities/tests source-compatible while new wagers use Robinhood Chain.
export const WSOL_MINT_ADDRESS = "So11111111111111111111111111111111111111112";
export const SPL_TOKEN_PROGRAM_ADDRESS = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const BROWSER_SAFE_MAINNET_RPC_URL = "https://solana-rpc.publicnode.com";
export const DEFAULT_WAGER_HOLD_MINT = "Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump";
export const DEFAULT_WAGER_HOLD_SYMBOL = "CHESS";
export const DEFAULT_WAGER_HOLD_DECIMALS = 6;
export const DEFAULT_WAGER_HOLD_MIN_UNITS = 50_000;

export interface WagerAssetConfig {
  mint: string;
  symbol: string;
  decimals: number;
  tokenProgramId: string;
}

export interface WagerHoldGateConfig {
  enabled: boolean;
  mint: string;
  symbol: string;
  decimals: number;
  tokenProgramId: string;
  requiredRawAmount: bigint;
}

export interface WagerConfig {
  cluster: string;
  rpcUrl: string;
  explorerBaseUrl: string;
  paymentMode: "robinhood_eth_escrow";
  sponsorSignerUrl: null;
  sponsorStatus: "unavailable";
  sponsoredModeAvailable: false;
  newWagersEnabled: boolean;
  realEscrowEnabled: boolean;
  maxStakeLamports: bigint;
  presetStakeLamports: bigint[];
  asset: WagerAssetConfig;
  prizeAsset: WagerAssetConfig;
  holdGate: WagerHoldGateConfig;
}

// 0.002 ETH is approximately US$5 at release; stakes are denominated in ETH.
const DEFAULT_PRESET_STAKES = [0.002, 0.004, 0.01, 0.025, 0.03, 0.035, 0.04, 0.14, 0.24, 0.34];
const DEFAULT_MAX_STAKE = 0.34;

const boolEnv = (value: string | undefined): boolean => value === "true" || value === "1";

function parseStake(value: string): bigint | null {
  try {
    const amount = parseEther(value.trim());
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

function parsePresetStakes(value: string | undefined, maxStake: bigint): bigint[] {
  const values = value ? value.split(",") : DEFAULT_PRESET_STAKES.map(String);
  const parsed = values.map(parseStake).filter((stake): stake is bigint => stake !== null && stake <= maxStake);
  const minimum = parseEther(String(DEFAULT_PRESET_STAKES[0]));
  return parsed.length ? Array.from(new Set(parsed)).sort((a, b) => a < b ? -1 : 1) : [minimum < maxStake ? minimum : maxStake];
}

export function getWagerConfig(): WagerConfig {
  const maxStake = parseStake(
    import.meta.env.VITE_WAGER_MAX_STAKE_UNITS || import.meta.env.VITE_WAGER_MAX_ETH || String(DEFAULT_MAX_STAKE),
  ) ?? parseEther(String(DEFAULT_MAX_STAKE));

  return {
    cluster: "robinhood-mainnet",
    rpcUrl: import.meta.env.VITE_ROBINHOOD_RPC_URL || ROBINHOOD_RPC_URL,
    explorerBaseUrl: ROBINHOOD_EXPLORER_URL,
    paymentMode: "robinhood_eth_escrow",
    sponsorSignerUrl: null,
    sponsorStatus: "unavailable",
    sponsoredModeAvailable: false,
    newWagersEnabled: boolEnv(import.meta.env.VITE_WAGER_NEW_WAGERS_ENABLED),
    realEscrowEnabled: boolEnv(import.meta.env.VITE_WAGER_REAL_ESCROW_ENABLED),
    maxStakeLamports: maxStake,
    presetStakeLamports: parsePresetStakes(import.meta.env.VITE_WAGER_PRESET_STAKES, maxStake),
    asset: { mint: NATIVE_ETH_ADDRESS, symbol: "ETH", decimals: 18, tokenProgramId: "" },
    prizeAsset: { mint: ROBINHOOD_RBLX_ADDRESS, symbol: "RBLX", decimals: 18, tokenProgramId: "" },
    holdGate: { enabled: false, mint: "", symbol: "", decimals: 0, tokenProgramId: "", requiredRawAmount: 0n },
  };
}

export function formatLamports(amount: bigint | number | null | undefined, decimals = 4): string {
  if (amount == null) return "0";
  const raw = typeof amount === "bigint" ? amount : BigInt(amount);
  return Number(formatEther(raw)).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

export function formatRawAmount(
  amount: bigint | number | null | undefined,
  assetDecimals: number,
  maximumFractionDigits = 4,
): string {
  if (amount == null) return "0";
  const value = typeof amount === "bigint" ? amount : BigInt(amount);
  const scale = 10n ** BigInt(Math.max(assetDecimals, 0));
  const whole = value / scale;
  const remainder = value % scale;
  if (remainder === 0n) return whole.toString();
  const digits = remainder.toString().padStart(assetDecimals, "0").replace(/0+$/, "");
  const trimmed = digits.slice(0, Math.max(0, maximumFractionDigits));
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

export function explorerBaseUrl(_cluster: string): string {
  return ROBINHOOD_EXPLORER_URL;
}

export function explorerTxUrl(hash: string, _cluster: string): string {
  return hash ? `${ROBINHOOD_EXPLORER_URL}/tx/${encodeURIComponent(hash)}` : "";
}

export function isWsolAsset(asset: WagerAssetConfig): boolean {
  return asset.mint.toLowerCase() === NATIVE_ETH_ADDRESS;
}
