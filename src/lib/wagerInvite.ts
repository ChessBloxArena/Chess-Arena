export function wagerInvitePath(gameId: string, stakeRaw: string): string {
  return `/join/${encodeURIComponent(gameId)}?stake=${encodeURIComponent(stakeRaw)}`;
}

export function parseWagerInviteStake(value: string | null): bigint | null {
  if (!value || !/^[1-9][0-9]{0,38}$/.test(value)) return null;
  return BigInt(value);
}
