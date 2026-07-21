import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Index from './Index';

const mocks = vi.hoisted(() => ({
  listCpuLeaderboard: vi.fn(),
  listPvpLobbyDirectory: vi.fn(),
  navigate: vi.fn(),
  useArenaTheme: vi.fn(),
  useSolanaWallet: vi.fn(),
  useTokenBalance: vi.fn(),
  useRobinhoodWallet: vi.fn(),
  joinRobinhoodWagerPvpQueue: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock('@/components/TitleChessScene', () => ({
  default: () => <div data-testid="title-scene" />,
}));

vi.mock('@/components/WalletStatusPanel', () => ({
  default: () => <div data-testid="wallet-status" />,
}));

vi.mock('@/hooks/useArenaTheme', () => ({
  useArenaTheme: mocks.useArenaTheme,
}));

vi.mock('@/hooks/useSolanaWallet', () => ({
  useSolanaWallet: mocks.useSolanaWallet,
}));

vi.mock('@/hooks/useTokenBalance', () => ({
  useTokenBalance: mocks.useTokenBalance,
}));

vi.mock('@/hooks/useRobinhoodWallet', () => ({
  useRobinhoodWallet: mocks.useRobinhoodWallet,
}));

vi.mock('@/hooks/useOnlinePvp', () => ({
  createPvpLobby: vi.fn(),
  hostWagerPvpLobby: vi.fn(),
  joinPvpLobby: vi.fn(),
  joinPvpQueue: vi.fn(),
  joinWagerPvpLobby: vi.fn(),
  joinWagerPvpQueue: vi.fn(),
  joinRobinhoodWagerPvpQueue: mocks.joinRobinhoodWagerPvpQueue,
  listPvpLobbyDirectory: mocks.listPvpLobbyDirectory,
}));

vi.mock('@/lib/cpuLeaderboard', () => ({
  cpuDifficultyPoints: (difficulty: 'easy' | 'medium' | 'hard') => ({
    easy: 5_000,
    medium: 10_000,
    hard: 15_000,
  })[difficulty],
  formatCpuChessReward: (points: number) => new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  }).format(points),
  listCpuLeaderboard: mocks.listCpuLeaderboard,
}));

vi.mock('@/lib/sounds', () => ({
  playMenuClick: vi.fn(),
  playMenuSelect: vi.fn(),
  playStartSound: vi.fn(),
  setSoundEnabled: vi.fn(),
}));

vi.mock('@/lib/supabaseConfig', () => ({
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/wagerRefereeClient', () => ({
  resolveBrowserEscrowFactory: vi.fn(() => null),
}));

function installLocalStorageStub() {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => [...store.keys()][index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
  } satisfies Storage;

  vi.stubGlobal('localStorage', storage);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

describe('Index game entry and leaderboard', () => {
  beforeEach(() => {
    installLocalStorageStub();
    mocks.listCpuLeaderboard.mockReset();
    mocks.listPvpLobbyDirectory.mockReset();
    mocks.navigate.mockReset();
    mocks.joinRobinhoodWagerPvpQueue.mockReset();
    vi.stubEnv('VITE_WAGER_NEW_WAGERS_ENABLED', 'false');
    vi.stubEnv('VITE_WAGER_REAL_ESCROW_ENABLED', 'false');
    vi.stubEnv('VITE_RBLX_CONVERSION_ENABLED', 'false');
    vi.stubEnv('VITE_ROBINHOOD_ESCROW_ADDRESS', '0xfbba217fb9a493f12f0170a7f6b258ef1f7d2724');
    mocks.useRobinhoodWallet.mockReturnValue({
      address: null, balanceWei: null, balanceEth: null, shortAddress: '',
      connecting: false, refreshing: false, error: null,
      connect: vi.fn(), disconnect: vi.fn(), refreshBalance: vi.fn(),
      signMessage: vi.fn(), writeContract: vi.fn(),
    });
    mocks.useArenaTheme.mockReturnValue({ themesEnabled: false });
    mocks.useSolanaWallet.mockReturnValue({
      address: null,
      balanceLamports: null,
      balanceSol: null,
      connect: vi.fn(),
      connecting: false,
      disconnect: vi.fn(),
      error: null,
      publicKey: null,
      refreshBalance: vi.fn(),
      refreshing: false,
      shortAddress: null,
      signAndSendTransaction: vi.fn(),
      signMessage: undefined,
    });
    mocks.useTokenBalance.mockReturnValue({
      rawAmount: null,
      loading: false,
      refreshing: false,
      error: null,
      refresh: vi.fn(),
    });
    mocks.listPvpLobbyDirectory.mockResolvedValue({ lobbies: [], queueCounts: [] });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not repeatedly auto-retry after a failed leaderboard load', async () => {
    mocks.listCpuLeaderboard.mockRejectedValue(new Error('referee unavailable'));

    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Leaderboard' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('LEADERBOARD SYNC FAILED');
    await waitFor(() => expect(mocks.listCpuLeaderboard).toHaveBeenCalledTimes(1));

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    });

    expect(mocks.listCpuLeaderboard).toHaveBeenCalledTimes(1);
  });

  it('opens live wager setup from the homepage and requires a wallet before payment', async () => {
    vi.stubEnv('VITE_WAGER_NEW_WAGERS_ENABLED', 'true');
    vi.stubEnv('VITE_WAGER_REAL_ESCROW_ENABLED', 'true');
    render(<MemoryRouter><Index /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Wager' }));
    const connect = screen.getByRole('button', { name: 'Connect wallet to play' });
    expect(connect).toBeEnabled();
    fireEvent.click(connect);
    expect(mocks.useRobinhoodWallet().connect).toHaveBeenCalledOnce();
    expect(screen.queryByText(/convert it to RBLX/)).not.toBeInTheDocument();
    expect(mocks.joinRobinhoodWagerPvpQueue).not.toHaveBeenCalled();
  });

  it('sends the chosen ETH stake and wallet actions to the proven wager client, then opens the match', async () => {
    vi.stubEnv('VITE_WAGER_NEW_WAGERS_ENABLED', 'true');
    vi.stubEnv('VITE_WAGER_REAL_ESCROW_ENABLED', 'true');
    const wallet = {
      ...mocks.useRobinhoodWallet(),
      address: '0x1111111111111111111111111111111111111111',
      shortAddress: '0x1111…1111', balanceWei: 1_000_000_000_000_000_000n, balanceEth: 1,
    };
    mocks.useRobinhoodWallet.mockReturnValue(wallet);
    mocks.joinRobinhoodWagerPvpQueue.mockResolvedValue('verified-wager-game');
    render(<MemoryRouter><Index /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Wager' }));
    fireEvent.click(await screen.findByRole('button', { name: '0.03' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 0.03 ETH & play' }));
    await waitFor(() => expect(mocks.joinRobinhoodWagerPvpQueue).toHaveBeenCalledWith({
      address: wallet.address,
      stakeWei: 30_000_000_000_000_000n,
      timeControl: '5+0',
      signMessage: wallet.signMessage,
      writeContract: expect.any(Function),
      reviewPayout: expect.any(Function),
    }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/game/verified-wager-game'));
  });
  it('restores practice preferences and launches without an intermediate setup screen', async () => {
    localStorage.setItem('chessblox_quick_play_v1', JSON.stringify({ mode:'cpu', entry:'practice', difficulty:'hard', character:'vinnie', format:'rapid_10_0' }));
    render(<MemoryRouter><Index /></MemoryRouter>);
    expect(screen.getByRole('combobox', {name:'Opponent'})).toHaveValue('cpu');
    expect(screen.getByRole('combobox', {name:'Difficulty'})).toHaveValue('hard');
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'Play computer'}));
    expect(mocks.navigate).toHaveBeenCalledWith('/game', {state: expect.objectContaining({mode:'cpu', difficulty:'hard', cpuCharacter:'vinnie'})});
  });

});
