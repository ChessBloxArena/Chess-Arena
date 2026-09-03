export function wagerPilotAllowsWallet(enabled: string | undefined, wallets: string | undefined, wallet: string, expiresAt?: string): boolean {
  if (enabled !== "true") return true;
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return false;
  const allowed = (wallets || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length || allowed.some(value => !/^0x[0-9a-f]{40}$/.test(value))) return false;
  return allowed.includes(wallet.toLowerCase());
}
