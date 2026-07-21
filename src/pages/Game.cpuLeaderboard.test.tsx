import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Game from './Game';

const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  signWalletProof: vi.fn(() => Promise.resolve({
    walletSignature: 'signature',
    walletProofNonce: 'nonce',
    walletProofExpiresAt: '2026-06-19T12:05:00.000Z',
  })),
  submitCpuResult: vi.fn((_args: { requestId: string }) => Promise.resolve({ ok: true })),
  useSolanaWallet: vi.fn(),
  useChessGame: vi.fn(),
}));

vi.mock('@/lib/cpuLeaderboard', () => ({
  submitCpuResult: mocks.submitCpuResult,
}));

vi.mock('@/lib/supabaseConfig', () => ({
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/wagerRefereeClient', () => ({
  signWalletProof: mocks.signWalletProof,
}));

vi.mock('@/hooks/useSolanaWallet', () => ({
  useSolanaWallet: mocks.useSolanaWallet,
}));

vi.mock('@/hooks/useChessGame', () => ({
  useChessGame: mocks.useChessGame,
}));

vi.mock('@/lib/sounds', () => ({
  playMenuClick: vi.fn(),
  playTurnReadySound: vi.fn(),
  setSoundEnabled: vi.fn(),
}));

vi.mock('@/lib/music', () => ({
  startMusic: vi.fn(),
  stopMusic: vi.fn(),
}));

vi.mock('@/components/ChessScene', () => ({ default: () => <div data-testid="chess-scene" /> }));
vi.mock('@/components/TypewriterText', () => ({ default: ({ text }: { text: string }) => <span>{text}</span> }));
vi.mock('@/components/MoveHistoryPanel', () => ({ default: () => <div data-testid="move-history" /> }));
vi.mock('@/components/PromotionPicker', () => ({ default: () => null }));
vi.mock('@/components/ActionBanner', () => ({ default: () => null }));
vi.mock('@/components/GamePausePanel', () => ({ default: () => null }));
vi.mock('@/components/OpponentPresencePanel', () => ({ default: () => null }));
vi.mock('@/components/MatchIntroOverlay', () => ({ default: () => null }));
vi.mock('@/components/PlayerTurnPanel', () => ({ default: () => null }));
vi.mock('@/components/ConfirmActionDialog', () => ({ default: () => null }));

function gameState() {
  return {
    board: [],
    selectedSquare: null,
    legalMoves: [],
    highlightedSquares: [],
    currentTurn: 'b',
    isCheck: true,
    isCheckmate: true,
    isGameOver: true,
    drawReason: null,
    resignedBy: null,
    capturedPieces: { w: [], b: [] },
    statusMessage: 'CHECKMATE! WHITE WINS!',
    flavorText: 'The king has fallen!',
    cpuThinking: false,
    pendingPromotion: null,
    lastMoveFeedback: null,
    invalidMoveFeedback: null,
    handleSquareClick: vi.fn(),
    handlePieceDrop: vi.fn(),
    choosePromotion: vi.fn(),
    cancelPromotion: vi.fn(),
    undo: vi.fn(),
    surrender: vi.fn(),
    reset: mocks.reset,
    history: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    moveHistory: [],
  };
}

describe('Game CPU leaderboard submission', () => {
  beforeEach(() => {
    mocks.reset.mockClear();
    mocks.signWalletProof.mockClear();
    mocks.submitCpuResult.mockClear();
    mocks.useSolanaWallet.mockReturnValue({
      address: null,
      signMessage: undefined,
    });
    mocks.useChessGame.mockReturnValue(gameState());
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits a qualifying CPU checkmate once and uses a new request id for rematch', async () => {
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/game',
        state: {
          mode: 'cpu',
          difficulty: 'hard',
          cpuCharacter: 'ivan',
          playerName: 'ADA',
        },
      }]}>
        <Game />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.submitCpuResult).toHaveBeenCalledTimes(1));
    expect(mocks.submitCpuResult).toHaveBeenLastCalledWith({
      requestId: 'cpu:00000000-0000-4000-8000-000000000001',
      playerName: 'ADA',
      difficulty: 'hard',
      cpuCharacter: 'ivan',
      moves: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
    });
    expect(mocks.signWalletProof).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'REMATCH' }));

    await waitFor(() => expect(mocks.submitCpuResult).toHaveBeenCalledTimes(2));
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    expect(mocks.submitCpuResult.mock.calls[1][0].requestId)
      .toBe('cpu:00000000-0000-4000-8000-000000000002');
  });

  it('adds wallet proof fields when a payout wallet is connected', async () => {
    mocks.useSolanaWallet.mockReturnValue({
      address: '9xQeWvG816bUx9EPjHmaT23yvVM2ZW1TRk7uFJ8L4p9K',
      signMessage: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={[{
        pathname: '/game',
        state: {
          mode: 'cpu',
          difficulty: 'easy',
          cpuCharacter: 'ivan',
          playerName: 'ADA',
        },
      }]}>
        <Game />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.submitCpuResult).toHaveBeenCalledTimes(1));
    expect(mocks.signWalletProof).toHaveBeenCalledWith({
      action: 'submit_cpu_result',
      walletAddress: '9xQeWvG816bUx9EPjHmaT23yvVM2ZW1TRk7uFJ8L4p9K',
      signMessage: expect.any(Function),
    });
    expect(mocks.submitCpuResult).toHaveBeenLastCalledWith(expect.objectContaining({
      walletAddress: '9xQeWvG816bUx9EPjHmaT23yvVM2ZW1TRk7uFJ8L4p9K',
      walletSignature: 'signature',
      walletProofNonce: 'nonce',
      walletProofExpiresAt: '2026-06-19T12:05:00.000Z',
    }));
  });
});
