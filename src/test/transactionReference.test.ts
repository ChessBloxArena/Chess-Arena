import { describe, it, expect } from "vitest";
import { validTransactionReference } from "../../supabase/functions/pvp-referee/transactionReference";
describe("payment transaction reference validation", () => {
  it("accepts a 32-byte Ethereum hash including zeroes", () => {
    expect(validTransactionReference("0x" + "0123456789abcdef".repeat(4), "robinhood_eth_escrow")).toBe(true);
  });
  it("rejects malformed Ethereum hashes", () => {
    for (const value of ["0x1234", "a".repeat(64), "0x" + "g".repeat(64), "0x" + "a".repeat(65)]) {
      expect(validTransactionReference(value, "robinhood_eth_escrow")).toBe(false);
    }
  });
  it("keeps Solana validation separate", () => {
    expect(validTransactionReference("5".repeat(88), "wsol_escrow")).toBe(true);
    expect(validTransactionReference("0x" + "a".repeat(64), "wsol_escrow")).toBe(false);
  });
});
