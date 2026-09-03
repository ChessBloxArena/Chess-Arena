export function validTransactionReference(value: string, paymentMode: string): boolean {
  return paymentMode === "robinhood_eth_escrow"
    ? /^0x[0-9a-fA-F]{64}$/.test(value)
    : /^[1-9A-HJ-NP-Za-km-z-]{16,128}$/.test(value);
}
