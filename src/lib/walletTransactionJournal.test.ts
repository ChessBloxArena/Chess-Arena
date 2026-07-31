import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTransactionRecord, runRecoverableTransaction } from "./walletTransactionJournal";
import type { Hash } from "viem";

const hash = `0x${"a".repeat(64)}` as Hash;
let storage: Storage;
beforeEach(() => {
  const values = new Map<string, string>();
  storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); }, clear: () => values.clear(), key: () => null, length: 0 };
});

describe("wallet payment recovery", () => {
  it("persists at broadcast and reuses the same transaction after a receipt timeout", async () => {
    const broadcast = vi.fn().mockResolvedValue(hash);
    await expect(runRecoverableTransaction({ identity: "timeout", storage, broadcast, confirm: async () => { throw new Error("offline"); } })).rejects.toThrow("same transaction");
    expect(readTransactionRecord("timeout", storage)).toMatchObject({ hash, status: "submitted" });
    const confirm = vi.fn().mockResolvedValue("success");
    expect(await runRecoverableTransaction({ identity: "timeout", storage, broadcast, confirm })).toBe(hash);
    expect(broadcast).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(hash);
  });
  it("coalesces double clicks and returns the stored successful receipt on later retries", async () => {
    let finish!: (hash: Hash) => void;
    const broadcast = vi.fn(() => new Promise<Hash>((resolve) => { finish = resolve; }));
    const input = { identity: "double", storage, broadcast, confirm: vi.fn().mockResolvedValue("success") };
    const first = runRecoverableTransaction(input);
    const second = runRecoverableTransaction(input);
    finish(hash);
    expect(await first).toBe(hash); expect(await second).toBe(hash);
    expect(await runRecoverableTransaction(input)).toBe(hash);
    expect(broadcast).toHaveBeenCalledOnce();
  });
  it("never opens the wallet if recovery storage fails", async () => {
    const broadcast = vi.fn();
    storage.setItem = () => { throw new Error("Storage full"); };
    await expect(runRecoverableTransaction({ identity: "storage", storage, broadcast, confirm: vi.fn() })).rejects.toThrow("Storage full");
    expect(broadcast).not.toHaveBeenCalled();
  });
  it("does not resend an unknown outcome, but permits retry after explicit rejection", async () => {
    const broadcast = vi.fn().mockRejectedValue({ code: -32603 });
    const input = { identity: "unknown", storage, broadcast, confirm: vi.fn() };
    await expect(runRecoverableTransaction(input)).rejects.toEqual({ code: -32603 });
    await expect(runRecoverableTransaction(input)).rejects.toThrow("interrupted");
    expect(broadcast).toHaveBeenCalledOnce();
    const rejected = vi.fn().mockRejectedValue({ cause: { code: 4001 } });
    await expect(runRecoverableTransaction({ ...input, identity: "rejected", broadcast: rejected })).rejects.toBeTruthy();
    expect(readTransactionRecord("rejected", storage)).toBeNull();
  });
  it("never calls a reverted transaction confirmed and permits a fresh user retry", async () => {
    const broadcast = vi.fn().mockResolvedValue(hash);
    await expect(runRecoverableTransaction({ identity: "revert", storage, broadcast, confirm: async () => "reverted" })).rejects.toThrow("reverted");
    expect(readTransactionRecord("revert", storage)?.status).toBe("reverted");
    await runRecoverableTransaction({ identity: "revert", storage, broadcast, confirm: async () => "success" });
    expect(broadcast).toHaveBeenCalledTimes(2);
  });
});
