import { describe, expect, it } from "vitest";
import {
  BROWSER_SAFE_MAINNET_RPC_URL,
  parsePublicPaymentConfig,
  SPL_TOKEN_PROGRAM_ID,
  WSOL_MINT,
} from "./paymentConfig";

const VALID_PROGRAM_ID = "11111111111111111111111111111111";

describe("parsePublicPaymentConfig", () => {
  it("fails closed when config is missing", () => {
    const config = parsePublicPaymentConfig({});

    expect(config.solana.cluster).toBe("devnet");
    expect(config.wager.creationEnabled).toBe(false);
    expect(config.wager.escrowStatus).toBe("missing");
    expect(config.wager.statusLabel).toBe("WAGERS DISABLED: CONFIG");
    expect(config.wager.assetMint).toBe(WSOL_MINT);
    expect(config.wager.displaySymbol).toBe("SOL");
    expect(config.wager.presetStakesSol).toEqual([0.025, 0.03, 0.035, 0.04, 0.14, 0.24, 0.34]);
    expect(config.wager.maxStakeSol).toBe(0.34);
  });

  it("keeps wagers disabled unless both kill switches and mainnet escrow are enabled", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "false",
    });

    expect(config.wager.creationEnabled).toBe(false);
    expect(config.wager.escrowStatus).toBe("configured");
    expect(config.wager.newWagersSwitchOn).toBe(true);
    expect(config.wager.realEscrowSwitchOn).toBe(false);
  });

  it("allows mainnet wSOL config only when all gates are explicit and valid", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
      VITE_WAGER_ASSET_MINT: WSOL_MINT,
      VITE_WAGER_ASSET_SYMBOL: "SOL",
      VITE_WAGER_ASSET_DECIMALS: "9",
      VITE_WAGER_TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID,
      VITE_WAGER_PRESET_STAKES_SOL: "0.025,0.03,0.035,0.04,0.14,0.24,0.34",
      VITE_WAGER_MAX_STAKE_SOL: "0.34",
    });

    expect(config.wager.creationEnabled).toBe(true);
    expect(config.wager.paymentMode).toBe("wsol_escrow");
    expect(config.wager.paymentModeLabel).toBe("wSOL ESCROW");
    expect(config.wager.displaySymbol).toBe("SOL");
    expect(config.wager.decimals).toBe(9);
    expect(config.wager.presetStakesSol).toEqual([0.025, 0.03, 0.035, 0.04, 0.14, 0.24, 0.34]);
    expect(config.wager.issues).toEqual([]);
  });

  it("ignores stale tiny SOL wager env values below the supported ladder", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
      VITE_WAGER_ASSET_MINT: WSOL_MINT,
      VITE_WAGER_ASSET_SYMBOL: "SOL",
      VITE_WAGER_ASSET_DECIMALS: "9",
      VITE_WAGER_TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID,
      VITE_WAGER_PRESET_STAKES: "0.0001,0.0005,0.001",
      VITE_WAGER_MAX_STAKE_UNITS: "0.001",
    });

    expect(config.wager.creationEnabled).toBe(true);
    expect(config.wager.presetStakesSol).toEqual([0.025, 0.03, 0.035, 0.04, 0.14, 0.24, 0.34]);
    expect(config.wager.maxStakeSol).toBe(0.34);
    expect(config.wager.issues).toEqual([]);
  });

  it("parses sponsored native SOL config when signer service is configured", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_PAYMENT_MODE: "native_sol_sponsored",
      VITE_WAGER_SPONSOR_SIGNER_URL: "https://sponsor.example.com",
      VITE_WAGER_SPONSOR_STATUS: "available",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
      VITE_WAGER_ASSET_MINT: WSOL_MINT,
      VITE_WAGER_ASSET_SYMBOL: "SOL",
      VITE_WAGER_ASSET_DECIMALS: "9",
    });

    expect(config.wager.paymentMode).toBe("native_sol_sponsored");
    expect(config.wager.paymentModeLabel).toBe("SPONSORED SOL");
    expect(config.wager.sponsoredModeAvailable).toBe(true);
    expect(config.wager.creationEnabled).toBe(true);
    expect(config.wager.sponsorSignerUrl).toBe("https://sponsor.example.com/");
    expect(config.wager.issues).toEqual([]);
  });

  it("disables sponsored mode when signer endpoint is missing", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_PAYMENT_MODE: "native_sol_sponsored",
      VITE_WAGER_SPONSOR_STATUS: "available",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
    });

    expect(config.wager.paymentMode).toBe("native_sol_sponsored");
    expect(config.wager.sponsoredModeAvailable).toBe(false);
    expect(config.wager.creationEnabled).toBe(false);
    expect(config.wager.issues).toContain("Missing sponsor signer URL");
  });

  it("uses a browser-safe mainnet RPC fallback when no endpoint is configured", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
    });

    expect(config.solana.endpoint).toBe(BROWSER_SAFE_MAINNET_RPC_URL);
  });

  it("supports a future token by changing public asset fields", () => {
    const tokenMint = "So11111111111111111111111111111111111111112";
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet-beta",
      VITE_WAGER_ESCROW_PROGRAM_ID: VALID_PROGRAM_ID,
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
      VITE_WAGER_ASSET_MINT: tokenMint,
      VITE_WAGER_ASSET_SYMBOL: "PUMP",
      VITE_WAGER_ASSET_DECIMALS: "6",
      VITE_WAGER_TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM_ID,
    });

    expect(config.wager.creationEnabled).toBe(true);
    expect(config.wager.assetSymbol).toBe("PUMP");
    expect(config.wager.displaySymbol).toBe("PUMP");
    expect(config.wager.decimals).toBe(6);
  });

  it("marks invalid values and disables creation", () => {
    const config = parsePublicPaymentConfig({
      VITE_SOLANA_CLUSTER: "mainnet",
      VITE_SOLANA_RPC_URL: "ftp://rpc.invalid",
      VITE_WAGER_ESCROW_PROGRAM_ID: "nope",
      VITE_WAGER_ASSET_DECIMALS: "12",
      VITE_WAGER_MAX_STAKE_SOL: "50",
      VITE_WAGER_PRESET_STAKES_SOL: "banana",
      VITE_WAGER_NEW_WAGERS_ENABLED: "true",
      VITE_WAGER_REAL_ESCROW_ENABLED: "true",
    });

    expect(config.wager.creationEnabled).toBe(false);
    expect(config.wager.issues.length).toBeGreaterThanOrEqual(5);
    expect(config.wager.statusLabel).toBe("WAGERS DISABLED: CONFIG");
  });
});
