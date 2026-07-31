import { describe, expect, it } from "vitest";
import { wagerPilotAllowsWallet } from "../../supabase/functions/pvp-referee/wagerPilot";
describe("private wager pilot", () => {
  const a = "0x" + "a".repeat(40), b = "0x" + "b".repeat(40);
  const future = new Date(Date.now() + 3600000).toISOString();
  it("allows only configured wallets during the pilot", () => {
    expect(wagerPilotAllowsWallet("true", a, a.toUpperCase(), future)).toBe(true);
    expect(wagerPilotAllowsWallet("true", a, b, future)).toBe(false);
  });
  it("fails closed for an empty or malformed list", () => {
    expect(wagerPilotAllowsWallet("true", "", a, future)).toBe(false);
    expect(wagerPilotAllowsWallet("true", a + ",bad", a, future)).toBe(false);
  });
  it("refuses expired or missing test expiry", () => {
    expect(wagerPilotAllowsWallet("true", a, a)).toBe(false);
    expect(wagerPilotAllowsWallet("true", a, a, "2000-01-01T00:00:00Z")).toBe(false);
  });
  it("does not impose a wallet cap when the pilot is disabled", () => {
    expect(wagerPilotAllowsWallet("false", "", b)).toBe(true);
  });
});
