import { PublicKey } from "@solana/web3.js";
import { PaymentSdkError } from "./errors.js";

export type SolanaCluster = "mainnet-beta" | "devnet" | "testnet" | "localnet";
export type TokenProgramKind = "spl-token" | "token-2022";

export type SupportedPaymentAsset = {
  mint: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
  tokenProgram: TokenProgramKind;
  maxStakeAmount?: bigint;
};

export type PaymentConfig = {
  gameId: string;
  cluster: SolanaCluster;
  rpcUrl?: string;
  escrowProgramId?: string;
  platformFeeBps: number;
  maxStakeAmount?: bigint;
  feeAuthority?: string;
  resultAuthority?: string;
  enableRealEscrow: boolean;
  enableNewContests: boolean;
  assets: SupportedPaymentAsset[];
};

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,15}$/i;

export function normalizePaymentConfig(config: PaymentConfig): PaymentConfig {
  if (!GAME_ID_PATTERN.test(config.gameId)) {
    throw new PaymentSdkError(
      "INVALID_CONFIG",
      "Payment config gameId must be generic, non-empty, and URL-safe."
    );
  }

  if (config.platformFeeBps < 0 || config.platformFeeBps > 10_000) {
    throw new PaymentSdkError(
      "INVALID_CONFIG",
      "Platform fee basis points must be between 0 and 10000."
    );
  }

  const seenMints = new Set<string>();
  const assets = config.assets.map((asset) => {
    const normalized = normalizeAsset(asset);
    const mintKey = normalized.mint;
    if (seenMints.has(mintKey)) {
      throw new PaymentSdkError(
        "INVALID_CONFIG",
        `Duplicate supported asset mint: ${mintKey}`
      );
    }
    seenMints.add(mintKey);
    return normalized;
  });

  if (config.escrowProgramId) {
    assertPublicKey(config.escrowProgramId, "escrowProgramId");
  }

  if (config.resultAuthority) {
    assertPublicKey(config.resultAuthority, "resultAuthority");
  }

  if (config.feeAuthority) {
    assertPublicKey(config.feeAuthority, "feeAuthority");
  }

  return {
    ...config,
    assets
  };
}

export function normalizeAsset(asset: SupportedPaymentAsset): SupportedPaymentAsset {
  assertPublicKey(asset.mint, "asset mint");

  if (!SYMBOL_PATTERN.test(asset.symbol)) {
    throw new PaymentSdkError(
      "INVALID_CONFIG",
      "Asset symbol must be 1-16 visible alpha-numeric characters."
    );
  }

  if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 18) {
    throw new PaymentSdkError(
      "INVALID_CONFIG",
      "Asset decimals must be an integer between 0 and 18."
    );
  }

  if (asset.maxStakeAmount !== undefined && asset.maxStakeAmount < 0n) {
    throw new PaymentSdkError(
      "INVALID_CONFIG",
      "Asset maxStakeAmount cannot be negative."
    );
  }

  return {
    ...asset,
    mint: new PublicKey(asset.mint).toBase58(),
    tokenProgram: asset.tokenProgram ?? "spl-token"
  };
}

export function assertPublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new PaymentSdkError("INVALID_CONFIG", `Invalid ${label} public key.`);
  }
}
