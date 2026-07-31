import type { Hash } from "viem";

export interface TransactionRecord {
  version: 1;
  hash?: Hash;
  status: "awaiting_wallet" | "submitted" | "confirmed" | "reverted";
  startedAt: number;
}

const prefix = "chessblox:wallet-tx:v1:";
const inFlight = new Map<string, Promise<Hash>>();

export function readTransactionRecord(identity: string, storage: Storage = window.localStorage): TransactionRecord | null {
  const raw = storage.getItem(prefix + identity);
  if (!raw) return null;
  const record = JSON.parse(raw) as TransactionRecord;
  if (record.version !== 1 || !["awaiting_wallet", "submitted", "confirmed", "reverted"].includes(record.status)
    || (record.hash && !/^0x[0-9a-fA-F]{64}$/.test(record.hash))) {
    throw new Error("Saved payment could not be read. Do not send another payment; recover it from your wallet history.");
  }
  return record;
}

export function transactionWasRejected(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 8; depth++) {
    const value = current as { code?: number; name?: string; cause?: unknown };
    if (value.code === 4001 || value.name === "UserRejectedRequestError") return true;
    current = value.cause;
  }
  return false;
}

/** A retry checks the original receipt, never broadcasts a second payment. */
export function runRecoverableTransaction(input: {
  identity: string;
  broadcast: () => Promise<Hash>;
  confirm: (hash: Hash) => Promise<"success" | "reverted">;
  storage?: Storage;
}): Promise<Hash> {
  const existing = inFlight.get(input.identity);
  if (existing) return existing;
  const run = async () => {
    const storage = input.storage ?? window.localStorage;
    const key = prefix + input.identity;
    let record = readTransactionRecord(input.identity, storage);
    if (record?.status === "confirmed" && record.hash) return record.hash;
    if (record?.status === "reverted") {
      // A new user-initiated call may retry a transaction proven to have reverted.
      storage.removeItem(key);
      record = null;
    }
    if (record && !record.hash) {
      throw new Error("A wallet request was interrupted. Check your wallet activity before continuing; no second payment was requested.");
    }
    if (!record) {
      record = { version: 1, status: "awaiting_wallet", startedAt: Date.now() };
      // Fail before opening the wallet when durable recovery storage is unavailable.
      storage.setItem(key, JSON.stringify(record));
      try {
        record.hash = await input.broadcast();
        record.status = "submitted";
        storage.setItem(key, JSON.stringify(record));
      } catch (error) {
        if (transactionWasRejected(error)) storage.removeItem(key);
        throw error;
      }
    }
    const hash = record.hash!;
    let outcome: "success" | "reverted";
    try {
      outcome = await input.confirm(hash);
    } catch {
      throw new Error(`Payment confirmation is still pending (${hash}). Retry to check the same transaction; no second payment is requested.`);
    }
    record.status = outcome === "success" ? "confirmed" : "reverted";
    storage.setItem(key, JSON.stringify(record));
    if (outcome !== "success") throw new Error("The transaction reverted. Your stake was not transferred. You can retry.");
    return hash;
  };
  // Web Locks also serializes wallet operations across tabs on this origin.
  const promise = (typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(prefix + input.identity, run)
    : run()).finally(() => inFlight.delete(input.identity));
  inFlight.set(input.identity, promise);
  return promise;
}
