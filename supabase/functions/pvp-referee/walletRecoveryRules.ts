export function robinhoodRecoveryColor(row: {
  payment_mode?: string | null;
  wager_asset_kind?: string | null;
  white_wallet_address?: string | null;
  black_wallet_address?: string | null;
}, wallet: string): "w" | "b" | null {
  if (row.payment_mode !== "robinhood_eth_escrow" || row.wager_asset_kind !== "native_eth" || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  const normalized = wallet.toLowerCase();
  if (row.white_wallet_address?.toLowerCase() === normalized) return "w";
  if (row.black_wallet_address?.toLowerCase() === normalized) return "b";
  return null;
}
