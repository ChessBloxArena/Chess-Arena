import { clusterApiUrl, PublicKey } from "@solana/web3.js";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const BROWSER_SAFE_MAINNET_RPC_URL = "https://solana-rpc.publicnode.com/";

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";

export interface PublicPaymentEnv {
  VITE_SOLANA_CLUSTER?: string;
  VITE_SOLANA_RPC_URL?: string;
  VITE_WAGER_PAYMENT_MODE?: string;
  VITE_WAGER_NEW_WAGERS_ENABLED?: string;
  VITE_WAGER_REAL_ESCROW_ENABLED?: string;
  VITE_WAGER_SPONSOR_SIGNER_URL?: string;
  VITE_WAGER_SPONSOR_STATUS?: string;
  VITE_WAGER_ESCROW_PROGRAM_ID?: string;
  VITE_WAGER_ASSET_MINT?: string;
  VITE_WAGER_ASSET_SYMBOL?: string;
  VITE_WAGER_ASSET_DECIMALS?: string;
  VITE_WAGER_TOKEN_PROGRAM_ID?: string;
  VITE_WAGER_PRESET_STAKES?: string;
  VITE_WAGER_PRESET_STAKES_SOL?: string;
  VITE_WAGER_MAX_STAKE_UNITS?: string;
  VITE_WAGER_MAX_STAKE_SOL?: string;
  VITE_WAGER_GAME_ID?: string;
  VITE_WAGER_RULES_HASH?: string;
  VITE_WAGER_CONTEST_TTL_SECONDS?: string;
  VITE_WAGER_FEE_AUTHORITY?: string;
}

export interface PublicPaymentConfig {
  solana: {
    cluster: SolanaCluster;
    clusterLabel: string;
    endpoint: string;
  };
  wager: {
    paymentMode: "wsol_escrow" | "native_sol_sponsored";
    paymentModeLabel: string;
    sponsoredModeAvailable: boolean;
    sponsorSignerUrl: string | null;
    sponsorStatus: "available" | "unavailable" | "treasury_low" | "paused";
    displaySymbol: string;
    assetSymbol: string;
    assetMint: string;
    decimals: number;
    tokenProgramId: string;
    presetStakesSol: number[];
    maxStakeSol: number;
    newWagersSwitchOn: boolean;
    realEscrowSwitchOn: boolean;
    escrowProgramId: string | null;
    escrowStatus: "missing" | "configured";
    creationEnabled: boolean;
    statusLabel: string;
    issues: string[];
  };
}

const DEFAULT_CLUSTER: SolanaCluster = "devnet";
const DEFAULT_PRESET_STAKES_SOL = [0.025, 0.03, 0.035, 0.04, 0.14, 0.24, 0.34];
const DEFAULT_MAX_STAKE_SOL = 0.34;
const DEFAULT_MIN_STAKE_SOL = DEFAULT_PRESET_STAKES_SOL[0];
const MAX_ALLOWED_STAKE_SOL = 1;

function boolEnv(value: string | undefined): boolean {
  return value === "true";
}

function parseCluster(value: string | undefined, issues: string[]): SolanaCluster {
  if (!value) return DEFAULT_CLUSTER;
  if (value === "mainnet-beta" || value === "devnet" || value === "testnet" || value === "localnet") {
    return value;
  }
  issues.push("Invalid Solana cluster");
  return DEFAULT_CLUSTER;
}

function clusterLabel(cluster: SolanaCluster): string {
  if (cluster === "mainnet-beta") return "MAINNET";
  return cluster.toUpperCase();
}

function endpointFor(cluster: SolanaCluster, configuredEndpoint: string | undefined, issues: string[]): string {
  if (configuredEndpoint) {
    try {
      const url = new URL(configuredEndpoint);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.toString();
      }
    } catch {
      // Report below.
    }
    issues.push("Invalid Solana RPC URL");
  }

  if (cluster === "localnet") return "http://127.0.0.1:8899/";
  if (cluster === "mainnet-beta") return BROWSER_SAFE_MAINNET_RPC_URL;
  return clusterApiUrl(cluster);
}

function parsePaymentMode(value: string | undefined, issues: string[]): PublicPaymentConfig["wager"]["paymentMode"] {
  if (!value) return "wsol_escrow";
  const normalized = value.trim().toLowerCase();
  if (normalized === "native_sol_sponsored" || normalized === "sponsored_sol") return "native_sol_sponsored";
  if (normalized === "wsol_escrow" || normalized === "wsol" || normalized === "wsol_escrow_fallback") return "wsol_escrow";
  issues.push("Invalid wager payment mode");
  return "wsol_escrow";
}

function paymentModeLabel(paymentMode: PublicPaymentConfig["wager"]["paymentMode"]): string {
  return paymentMode === "native_sol_sponsored" ? "SPONSORED SOL" : "wSOL ESCROW";
}

function validHttpUrl(value: string | undefined, label: string, issues: string[], required: boolean): string | null {
  if (!value) {
    if (required) issues.push(`Missing ${label}`);
    return null;
  }
  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
    if (url.protocol === "https:" || localHttp) return url.toString();
  } catch {
    // Report below.
  }
  issues.push(`Invalid ${label}`);
  return null;
}

function parseSponsorStatus(value: string | undefined, issues: string[]): PublicPaymentConfig["wager"]["sponsorStatus"] {
  if (!value) return "available";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "available" ||
    normalized === "unavailable" ||
    normalized === "treasury_low" ||
    normalized === "paused"
  ) {
    return normalized;
  }
  issues.push("Invalid sponsor status");
  return "unavailable";
}

function validPublicKey(value: string | undefined, label: string, issues: string[]): string | null {
  if (!value) {
    issues.push(`Missing ${label}`);
    return null;
  }

  try {
    return new PublicKey(value).toBase58();
  } catch {
    issues.push(`Invalid ${label}`);
    return null;
  }
}

function parseDecimals(value: string | undefined, issues: string[]): number {
  if (!value) return 9;
  const decimals = Number(value);
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 9) return decimals;
  issues.push("Invalid asset decimals");
  return 9;
}

function parseStakeList(value: string | undefined, maxStakeSol: number, issues: string[]): number[] {
  if (!value) return DEFAULT_PRESET_STAKES_SOL.filter((stake) => stake <= maxStakeSol);
  const parsedStakes = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((stake) => Number.isFinite(stake) && stake > 0);

  if (parsedStakes.length === 0) {
    issues.push("Invalid preset stakes");
    return DEFAULT_PRESET_STAKES_SOL.filter((stake) => stake <= maxStakeSol);
  }

  const stakes = parsedStakes.filter((stake) => stake >= DEFAULT_MIN_STAKE_SOL && stake <= maxStakeSol);
  if (stakes.length === 0) return DEFAULT_PRESET_STAKES_SOL.filter((stake) => stake <= maxStakeSol);

  return Array.from(new Set(stakes)).sort((a, b) => a - b);
}

function parseMaxStake(value: string | undefined, issues: string[]): number {
  if (!value) return DEFAULT_MAX_STAKE_SOL;
  const maxStake = Number(value);
  if (Number.isFinite(maxStake) && maxStake > 0 && maxStake <= MAX_ALLOWED_STAKE_SOL) {
    return Math.max(maxStake, DEFAULT_MAX_STAKE_SOL);
  }
  issues.push("Invalid max stake cap");
  return DEFAULT_MAX_STAKE_SOL;
}

function statusLabel(creationEnabled: boolean, issues: string[]): string {
  if (creationEnabled) return "REAL WAGERS ENABLED";
  if (issues.length > 0) return "WAGERS DISABLED: CONFIG";
  return "WAGERS DISABLED";
}

export function parsePublicPaymentConfig(env: PublicPaymentEnv): PublicPaymentConfig {
  const issues: string[] = [];
  const cluster = parseCluster(env.VITE_SOLANA_CLUSTER, issues);
  const endpoint = endpointFor(cluster, env.VITE_SOLANA_RPC_URL, issues);
  const paymentMode = parsePaymentMode(env.VITE_WAGER_PAYMENT_MODE, issues);
  const assetMint = validPublicKey(env.VITE_WAGER_ASSET_MINT ?? WSOL_MINT, "asset mint", issues) ?? WSOL_MINT;
  const tokenProgramId =
    validPublicKey(env.VITE_WAGER_TOKEN_PROGRAM_ID ?? SPL_TOKEN_PROGRAM_ID, "token program", issues) ??
    SPL_TOKEN_PROGRAM_ID;
  const escrowProgramId = validPublicKey(env.VITE_WAGER_ESCROW_PROGRAM_ID, "escrow program id", issues);
  const decimals = parseDecimals(env.VITE_WAGER_ASSET_DECIMALS, issues);
  const maxStakeSol = parseMaxStake(env.VITE_WAGER_MAX_STAKE_UNITS ?? env.VITE_WAGER_MAX_STAKE_SOL, issues);
  const presetStakesSol = parseStakeList(env.VITE_WAGER_PRESET_STAKES ?? env.VITE_WAGER_PRESET_STAKES_SOL, maxStakeSol, issues);
  const assetSymbol = (env.VITE_WAGER_ASSET_SYMBOL || "SOL").trim().toUpperCase();
  const newWagersSwitchOn = boolEnv(env.VITE_WAGER_NEW_WAGERS_ENABLED);
  const realEscrowSwitchOn = boolEnv(env.VITE_WAGER_REAL_ESCROW_ENABLED);
  const sponsorStatus = parseSponsorStatus(env.VITE_WAGER_SPONSOR_STATUS, issues);
  const sponsorSignerUrl = validHttpUrl(
    env.VITE_WAGER_SPONSOR_SIGNER_URL,
    "sponsor signer URL",
    issues,
    paymentMode === "native_sol_sponsored",
  );
  const sponsoredModeAvailable =
    paymentMode === "native_sol_sponsored" &&
    Boolean(sponsorSignerUrl) &&
    sponsorStatus === "available";
  const creationEnabled =
    issues.length === 0 &&
    cluster === "mainnet-beta" &&
    newWagersSwitchOn &&
    realEscrowSwitchOn &&
    Boolean(escrowProgramId) &&
    (paymentMode === "wsol_escrow" || sponsoredModeAvailable);

  return {
    solana: {
      cluster,
      clusterLabel: clusterLabel(cluster),
      endpoint,
    },
    wager: {
      paymentMode,
      paymentModeLabel: paymentModeLabel(paymentMode),
      sponsoredModeAvailable,
      sponsorSignerUrl,
      sponsorStatus,
      displaySymbol: assetSymbol === "SOL" && assetMint === WSOL_MINT ? "SOL" : assetSymbol,
      assetSymbol,
      assetMint,
      decimals,
      tokenProgramId,
      presetStakesSol,
      maxStakeSol,
      newWagersSwitchOn,
      realEscrowSwitchOn,
      escrowProgramId,
      escrowStatus: escrowProgramId ? "configured" : "missing",
      creationEnabled,
      statusLabel: statusLabel(creationEnabled, issues),
      issues,
    },
  };
}

export const publicPaymentConfig = parsePublicPaymentConfig(import.meta.env);
