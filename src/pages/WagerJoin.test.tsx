import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WagerJoin from './WagerJoin';
import { wagerInvitePath } from '@/lib/wagerInvite';

const mocks = vi.hoisted(() => ({ wallet: vi.fn(), join: vi.fn() }));
vi.mock('@/hooks/useRobinhoodWallet', () => ({ useRobinhoodWallet: mocks.wallet }));
vi.mock('@/hooks/useOnlinePvp', () => ({ joinRobinhoodWagerPvpLobby: mocks.join }));
const gameId = 'a5c03123-c890-4818-940a-248cc57a9e6c';
const stake = '25000000000000000';
function open(value = stake) {
  render(<MemoryRouter initialEntries={[wagerInvitePath(gameId, value)]}><Routes><Route path="/join/:gameId" element={<WagerJoin />} /><Route path="/game/:gameId" element={<p>Match opened</p>} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_WAGER_NEW_WAGERS_ENABLED', 'true');
  vi.stubEnv('VITE_WAGER_REAL_ESCROW_ENABLED', 'true');
  vi.stubEnv('VITE_WAGER_MAX_STAKE_UNITS', '0.34');
  vi.stubEnv('VITE_ROBINHOOD_ESCROW_ADDRESS', '0xfbba217fb9a493f12f0170a7f6b258ef1f7d2724');
  mocks.wallet.mockReturnValue({ address: '0x1111111111111111111111111111111111111111', shortAddress: '0x1111…1111', balanceWei: 1_000_000_000_000_000_000n, connecting: false, error: null, connect: vi.fn(), signMessage: vi.fn(), writeContract: vi.fn() });
});
afterEach(() => vi.unstubAllEnvs());

describe('wager invitation screen', () => {
  it('reviews the exact ETH amount and never joins automatically', () => {
    open();
    expect(screen.getByText('0.025 ETH')).toBeInTheDocument();
    expect(screen.getByText('0.05 ETH')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Deposit 0.025 ETH & join/i })).toBeEnabled();
    expect(mocks.join).not.toHaveBeenCalled();
  });
  it('uses the selected match and amount only after the player chooses to deposit', async () => {
    mocks.join.mockResolvedValue(gameId);
    open();
    fireEvent.click(screen.getByRole('button', { name: /Deposit 0.025 ETH & join/i }));
    await waitFor(() => expect(mocks.join).toHaveBeenCalledWith(gameId, expect.objectContaining({ stakeWei: BigInt(stake) })));
    expect(await screen.findByText('Match opened')).toBeInTheDocument();
  });
  it('offers a read-only balance refresh after a network failure', () => {
    const refreshBalance = vi.fn();
    mocks.wallet.mockReturnValue({ ...mocks.wallet(), balanceWei: null, error: 'HTTP request failed. URL: https://rpc.example Request body: {}', refreshing: false, refreshBalance });
    open();
    expect(screen.getByRole('alert')).toHaveTextContent('The network is temporarily unavailable.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Request body');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh ETH balance' }));
    expect(refreshBalance).toHaveBeenCalledOnce();
    expect(mocks.join).not.toHaveBeenCalled();
  });
  it.each(['-1', '340000000000000001'])('blocks invalid or over-limit invite stakes: %s', (value) => {
    open(value);
    expect(screen.getByRole('button', { name: value === '-1' ? 'Invite unavailable' : /Deposit .* ETH & join/i })).toBeDisabled();
    expect(mocks.join).not.toHaveBeenCalled();
  });
});
