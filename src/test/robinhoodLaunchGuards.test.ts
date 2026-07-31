import { describe, expect, it } from "vitest";
import { assertEscrowLifetime, requiredEscrowLifetimeSeconds } from "../../supabase/functions/pvp-referee/escrowLifetime";
import { robinhoodRecoveryColor } from "../../supabase/functions/pvp-referee/walletRecoveryRules";
import { rateLimitKeys } from "../../supabase/functions/pvp-referee/sessionSecurity";

describe("public wager launch guards", () => {
  it("keeps attacker and victim action budgets separate even behind the same IP and browser", () => {
    const common = { action: "move" as const, ipHash: "same-nat", userAgentHash: "same-browser", gameId: "victim-game", walletAddress: "victim-wallet" };
    const buckets = new Map<string, number>();
    const consume = (sessionId: string) => rateLimitKeys({ ...common, sessionId }).every((key) => {
      const count = (buckets.get(key) ?? 0) + 1; buckets.set(key, count); return count <= 20;
    });
    for (let i = 0; i < 20; i++) expect(consume("attacker")).toBe(true);
    expect(consume("attacker")).toBe(false);
    expect(consume("victim")).toBe(true);
  });
  it("reserves both clocks, every increment, and ten minutes for settlement", () => {
    const required = requiredEscrowLifetimeSeconds(900_000, 10_000, 300);
    expect(required).toBe(5400);
    expect(() => assertEscrowLifetime(1120n, 1000, required)).toThrow("expires too soon");
    expect(() => assertEscrowLifetime(6400n, 1000, required)).not.toThrow();
    expect(() => assertEscrowLifetime(6400n, 1001, required)).toThrow();
    expect(() => requiredEscrowLifetimeSeconds(NaN, 0, 300)).toThrow();
  });
  it("allows recovery only by a wallet actually bound to that ETH game", () => {
    const white = `0x${"a".repeat(40)}`, black = `0x${"b".repeat(40)}`;
    const row = { payment_mode: "robinhood_eth_escrow", wager_asset_kind: "native_eth", white_wallet_address: white, black_wallet_address: black };
    expect(robinhoodRecoveryColor(row, white.toUpperCase().replace("0X", "0x"))).toBe("w");
    expect(robinhoodRecoveryColor(row, black)).toBe("b");
    expect(robinhoodRecoveryColor(row, `0x${"c".repeat(40)}`)).toBeNull();
    expect(robinhoodRecoveryColor({ ...row, payment_mode: "wsol_escrow" }, white)).toBeNull();
  });
});
