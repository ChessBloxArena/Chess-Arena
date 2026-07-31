import { describe, expect, it } from "vitest";
import {
  areWagerQueueEntriesCompatible,
  describeWagerCostCopy,
  estimateMinimumWagerEntryBalance,
  getWagerStartBlocker,
  WSOL_ESCROW_SETUP_BUFFER_LAMPORTS,
} from "@/lib/wagerMatchmaking";

describe("wager matchmaking guards", () => {
  const base = {
    assetMint: "So11111111111111111111111111111111111111112",
    stakeLamports: 50_000_000n,
    paymentMode: "wsol_escrow",
    queueStatus: "waiting",
  };

  it("matches only compatible asset, stake, payment mode, and status", () => {
    expect(areWagerQueueEntriesCompatible(base, { ...base })).toBe(true);
    expect(areWagerQueueEntriesCompatible(base, { ...base, stakeLamports: 100_000_000n })).toBe(false);
    expect(areWagerQueueEntriesCompatible(base, { ...base, assetMint: "PumpMint111111111111111111111111111111111" })).toBe(false);
    expect(areWagerQueueEntriesCompatible(base, { ...base, paymentMode: "practice" })).toBe(false);
    expect(areWagerQueueEntriesCompatible(base, { ...base, queueStatus: "cancelled" })).toBe(false);
  });

  it("requires Robinhood Chain ETH for stake plus gas and explains the prize choice", () => {
    const stakeWei = 25_000_000_000_000_000n;
    expect(estimateMinimumWagerEntryBalance({
      paymentMode: "robinhood_eth_escrow",
      stakeLamports: stakeWei,
    })).toBe(25_100_000_000_000_000n);
    expect(describeWagerCostCopy({
      paymentMode: "robinhood_eth_escrow",
      rblxConversionEnabled: true,
      sponsoredModeAvailable: false,
      stakeLabel: "0.025 ETH",
      assetSymbol: "ETH",
    })).toContain("Winner claims ETH, then can convert it to RBLX via Uniswap");
    const ethOnlyCopy = describeWagerCostCopy({
      paymentMode: "robinhood_eth_escrow",
      sponsoredModeAvailable: false,
      stakeLabel: "0.025 ETH",
      assetSymbol: "ETH",
    });
    expect(ethOnlyCopy.join(" ")).not.toContain("RBLX");
    expect(ethOnlyCopy).toContain("Winner claims the full ETH pot. Draws return each player's stake.");
  });

  it("blocks wager start before signing when SOL balance is insufficient", () => {
    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports: 10_000_000n,
      stakeLamports: 50_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
    })).toBe("Wallet needs at least 0.0583 SOL for stake, escrow rent, and network fees.");
  });

  it("includes wSOL escrow account rent in the minimum wallet balance", () => {
    const stakeLamports = 1_000_000n;
    expect(estimateMinimumWagerEntryBalance({
      paymentMode: "wsol_escrow",
      stakeLamports,
      stakeUsesNativeSol: true,
    })).toBe(stakeLamports + WSOL_ESCROW_SETUP_BUFFER_LAMPORTS);
  });

  it("allows a 0.025 SOL wager from a wallet with 0.08 SOL", () => {
    const stakeLamports = 25_000_000n;
    const balanceLamports = 80_000_000n;
    expect(estimateMinimumWagerEntryBalance({
      paymentMode: "wsol_escrow",
      stakeLamports,
      stakeUsesNativeSol: true,
    })).toBe(33_354_560n);

    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports,
      stakeLamports,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
      paymentMode: "wsol_escrow",
      stakeUsesNativeSol: true,
    })).toBeNull();
  });

  it("blocks disconnected and kill-switched wager starts", () => {
    expect(getWagerStartBlocker({
      walletConnected: false,
      balanceLamports: 100_000_000n,
      stakeLamports: 50_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
    })).toBe("Connect a wallet before entering wagered PvP.");

    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports: 100_000_000n,
      stakeLamports: 50_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: false,
      realEscrowEnabled: true,
    })).toBe("Real wager entry is disabled.");
  });

  it("blocks sponsored wagers when the sponsor service is unavailable", () => {
    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports: 100_000_000n,
      stakeLamports: 50_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
      paymentMode: "native_sol_sponsored",
      sponsorSignerConfigured: true,
      sponsorStatus: "unavailable",
    })).toBe("Sponsor service unavailable. Try again shortly.");
  });

  it("requires the configured CA holding before SOL wagers can start", () => {
    const gate = {
      holdGateEnabled: true,
      holdRequiredRaw: 50_000_000_000n,
      holdSymbol: "CHESS",
      holdRequiredLabel: "50,000",
    };
    const holderGateMessage = "Not enough $CHESS (CA). Buy or hold at least 50,000 $CHESS (CA) tokens to wager in SOL.";

    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports: 100_000_000n,
      stakeLamports: 25_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
      paymentMode: "wsol_escrow",
      stakeUsesNativeSol: true,
      holdBalanceLoading: true,
      holdBalanceRaw: null,
      ...gate,
    })).toBe(holderGateMessage);

    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports: 100_000_000n,
      stakeLamports: 25_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
      paymentMode: "wsol_escrow",
      stakeUsesNativeSol: true,
      holdBalanceRaw: 49_999_999_999n,
      ...gate,
    })).toBe(holderGateMessage);

    expect(getWagerStartBlocker({
      walletConnected: true,
      balanceLamports: 100_000_000n,
      stakeLamports: 25_000_000n,
      maxStakeLamports: 250_000_000n,
      newWagersEnabled: true,
      realEscrowEnabled: true,
      paymentMode: "wsol_escrow",
      stakeUsesNativeSol: true,
      holdBalanceRaw: 50_000_000_000n,
      ...gate,
    })).toBeNull();
  });

  it("shows exact sponsored cost without escrow rent language", () => {
    expect(describeWagerCostCopy({
      paymentMode: "native_sol_sponsored",
      sponsoredModeAvailable: true,
      stakeLabel: "0.01 SOL",
      assetSymbol: "SOL",
    })).toEqual([
      "Stake: 0.01 SOL",
      "Network/rent: sponsored by Chess Arena",
      "Winner paid automatically",
    ]);
  });

  it("keeps non-sponsored escrow cost warning on the fallback path", () => {
    expect(describeWagerCostCopy({
      paymentMode: "wsol_escrow",
      sponsoredModeAvailable: false,
      stakeLabel: "0.01 SOL",
      assetSymbol: "SOL",
      estimatedEntryLamports: 8_547_920n,
    })).toContain("Wallet needed before signing: 0.0085 SOL");
  });

  it("shows the CA access requirement in wager cost copy", () => {
    expect(describeWagerCostCopy({
      paymentMode: "wsol_escrow",
      sponsoredModeAvailable: false,
      stakeLabel: "0.025 SOL",
      assetSymbol: "SOL",
      estimatedEntryLamports: 33_354_560n,
      holdGateEnabled: true,
      holdRequiredLabel: "50,000",
      holdSymbol: "CHESS",
    })).toContain("Access: hold 50,000 CHESS");
  });
});
