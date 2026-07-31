// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { settleRobinhoodRow } from '../../scripts/robinhood-settlement-core.mjs';

const hash = `0x${'1'.repeat(64)}`;
const resultHash = `0x${'2'.repeat(64)}`;
const address = `0x${'3'.repeat(40)}`;
const row = { id: 'game', winner: 'w', white_wallet_address: address, escrow_contest_key: `0x${'4'.repeat(64)}`, referee_result_hash: resultHash };
function fixture() {
  const calls: string[] = [];
  const save = vi.fn(async () => { calls.push('save'); return { error: null }; });
  const deps = {
    publicClient: { readContract: vi.fn().mockResolvedValue({ state: 2 }), getBlockNumber: vi.fn().mockResolvedValue(4500n), getLogs: vi.fn().mockResolvedValue([]), waitForTransactionReceipt: vi.fn(async () => { calls.push('receipt'); return { status: 'success' }; }) },
    wallet: { writeContract: vi.fn(async () => { calls.push('send'); return hash; }) },
    supabase: { from: () => ({ update: () => ({ eq: () => ({ in: save }) }) }) },
    reportSettlement: vi.fn(async () => { calls.push('report'); }),
    account: {}, chain: {}, escrow: address, abi: [], deployBlock: 0n,
  };
  return { deps, calls, save };
}
describe('Robinhood worker crash recovery', () => {
  it('persists the broadcast before waiting and reporting', async () => {
    const { deps, calls } = fixture();
    await settleRobinhoodRow(row, deps);
    expect(calls).toEqual(['send', 'save', 'receipt', 'report']);
    expect(deps.publicClient.getLogs).not.toHaveBeenCalled();
  });
  it('recovers a mined settlement whose checkpoint was lost', async () => {
    const { deps, calls } = fixture();
    deps.publicClient.readContract.mockResolvedValue({ state: 3, winner: address, resultHash });
    deps.publicClient.getLogs.mockResolvedValue([{ args: { winner: address, resultHash }, transactionHash: hash }]);
    await settleRobinhoodRow(row, deps);
    expect(deps.wallet.writeContract).not.toHaveBeenCalled();
    expect(calls).toEqual(['save', 'receipt', 'report']);
  });
  it('paginates backwards without gaps when recovering an older settlement', async () => {
    const { deps } = fixture();
    deps.publicClient.readContract.mockResolvedValue({ state: 3, winner: address, resultHash });
    deps.publicClient.getLogs.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ args: { winner: address, resultHash }, transactionHash: hash }]);
    await settleRobinhoodRow(row, deps);
    expect(deps.publicClient.getLogs.mock.calls.map(([query]) => [query.fromBlock, query.toBlock])).toEqual([[2501n, 4500n], [501n, 2500n], [0n, 500n]]);
    expect(deps.wallet.writeContract).not.toHaveBeenCalled();
  });
  it('does not rebroadcast a settled contest when its receipt cannot be recovered', async () => {
    const { deps } = fixture();
    deps.publicClient.readContract.mockResolvedValue({ state: 3, winner: address, resultHash });
    await expect(settleRobinhoodRow(row, deps)).rejects.toThrow('no recoverable receipt');
    expect(deps.wallet.writeContract).not.toHaveBeenCalled();
  });
  it('refuses a cancelled contest and a conflicting settled result', async () => {
    const { deps } = fixture();
    deps.publicClient.readContract.mockResolvedValue({ state: 5 });
    await expect(settleRobinhoodRow(row, deps)).rejects.toThrow('not active');
    deps.publicClient.readContract.mockResolvedValue({ state: 3, winner: address, resultHash: hash });
    await expect(settleRobinhoodRow(row, deps)).rejects.toThrow('differs');
    expect(deps.wallet.writeContract).not.toHaveBeenCalled();
  });
  it('resumes a known checkpoint without broadcasting again', async () => {
    const { deps, calls } = fixture();
    await settleRobinhoodRow({ ...row, settlement_submitted_signature: hash }, deps);
    expect(calls).toEqual(['receipt', 'report']);
  });
  it('does not report a failed transaction as settled', async () => {
    const { deps } = fixture();
    deps.publicClient.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted' });
    await expect(settleRobinhoodRow(row, deps)).rejects.toThrow('reverted');
    expect(deps.reportSettlement).not.toHaveBeenCalled();
  });
  it('refuses an absent game result instead of silently settling a draw', async () => {
    const { deps } = fixture();
    await expect(settleRobinhoodRow({ ...row, winner: null }, deps)).rejects.toThrow('authoritative');
    expect(deps.wallet.writeContract).not.toHaveBeenCalled();
  });
});
