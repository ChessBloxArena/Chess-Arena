import type { PaymentConfig, SupportedPaymentAsset } from "./config.js";
import { PaymentSdkError } from "./errors.js";

export function getSupportedAssets(config: PaymentConfig): SupportedPaymentAsset[] {
  return config.assets.filter((asset) => asset.enabled);
}

export function findAssetByMint(
  config: PaymentConfig,
  mint: string
): SupportedPaymentAsset | undefined {
  return config.assets.find((asset) => asset.mint === mint);
}

export function assertKnownAsset(
  config: PaymentConfig,
  mint: string
): SupportedPaymentAsset {
  const asset = findAssetByMint(config, mint);
  if (!asset) {
    throw new PaymentSdkError("MINT_UNKNOWN", `Unknown wager mint: ${mint}`);
  }

  return asset;
}

export function assertSupportedAsset(
  config: PaymentConfig,
  mint: string
): SupportedPaymentAsset {
  const asset = assertKnownAsset(config, mint);
  if (!asset.enabled) {
    throw new PaymentSdkError("MINT_DISABLED", `Disabled wager mint: ${mint}`);
  }

  return asset;
}

export function assertStakeWithinLimits(
  config: PaymentConfig,
  asset: SupportedPaymentAsset,
  stakeAmount: bigint
): void {
  if (stakeAmount <= 0n) {
    throw new PaymentSdkError("INVALID_AMOUNT", "Stake amount must be positive.");
  }

  const limit = asset.maxStakeAmount ?? config.maxStakeAmount;
  if (limit !== undefined && stakeAmount > limit) {
    throw new PaymentSdkError(
      "STAKE_TOO_LARGE",
      `Stake amount exceeds the configured limit for ${asset.mint}.`
    );
  }
}
