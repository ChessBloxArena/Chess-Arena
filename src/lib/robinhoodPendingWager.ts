import type { PrepareWagerQueueResponse } from "./wagerRefereeClient";

export interface PendingRobinhoodWager {
  version: 1;
  sessionId: string;
  walletAddress: string;
  prepared: PrepareWagerQueueResponse;
  expiresAt: string;
}

function key(escrow: string, wallet: string) {
  return `chessblox:pending-wager:v1:4663:${escrow.toLowerCase()}:${wallet.toLowerCase()}`;
}
export function readPendingRobinhoodWager(escrow: string, wallet: string): PendingRobinhoodWager | null {
  const raw = window.localStorage.getItem(key(escrow, wallet));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingRobinhoodWager;
  if (value.version !== 1 || !value.prepared?.gameId || !value.prepared.playerToken || !/^\d+$/.test(value.expiresAt)) {
    throw new Error("Saved match needs recovery. Open My funds before starting another wager.");
  }
  return value;
}
export function savePendingRobinhoodWager(escrow: string, value: PendingRobinhoodWager): void {
  window.localStorage.setItem(key(escrow, value.walletAddress), JSON.stringify(value));
}
export function clearPendingRobinhoodWager(escrow: string, wallet: string, gameId: string): void {
  const value = readPendingRobinhoodWager(escrow, wallet);
  if (value?.prepared.gameId === gameId) window.localStorage.removeItem(key(escrow, wallet));
}
