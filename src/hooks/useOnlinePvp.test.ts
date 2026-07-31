import { act, renderHook, waitFor } from '@testing-library/react';
import type { Square } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPvpLobby, joinPvpLobby, joinPvpQueue, listPvpLobbies, listPvpLobbyDirectory, useOnlinePvp } from './useOnlinePvp';
import { clearStoredPvpSession } from '@/lib/pvpSession';

type RefereeResponse = { data: unknown; error: null | { message?: string; context?: Response } };

const supabaseTest = vi.hoisted(() => {
  const state: {
    invocations: Array<{ fn: string; body: Record<string, unknown> }>;
    responses: RefereeResponse[];
  } = {
    invocations: [],
    responses: [],
  };

  const supabase = {
    functions: {
      invoke: vi.fn(async (fn: string, options: { body?: Record<string, unknown> }) => {
        state.invocations.push({ fn, body: options.body ?? {} });
        return state.responses.shift() ?? { data: null, error: null };
      }),
    },
  };

  return { state, supabase };
});

const testLocalStorage = vi.hoisted(() => {
  let store: Record<string, string> = {};

  return {
    clear: () => {
      store = {};
    },
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: supabaseTest.supabase,
}));

vi.mock('@/lib/sounds', () => ({
  playMoveSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playCheckSound: vi.fn(),
  playGameOverSound: vi.fn(),
  playIllegalMoveSound: vi.fn(),
}));

const baseRow = {
  id: 'game-1',
  white_player_present: true,
  black_player_present: true,
  moves: [] as string[],
  status: 'active',
  winner: null,
  created_at: '2026-06-18T00:00:00.000Z',
  updated_at: '2026-06-18T00:00:00.000Z',
  payment_status: null,
  result_reason: null,
};

function queueResponses(...responses: RefereeResponse[]) {
  supabaseTest.state.responses.push(...responses);
}

function refereeJoinResponse(game = baseRow) {
  return {
    data: {
      gameId: 'game-1',
      color: 'w',
      playerToken: 'white-token',
      game,
    },
    error: null,
  };
}

function refereeGameResponse(game = baseRow) {
  return {
    data: {
      ok: true,
      game,
    },
    error: null,
  };
}

function refereeLobbyResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lobby-1',
    gameId: 'game-1',
    name: 'OPEN TABLE',
    hostName: 'PLAYER 1',
    matchType: 'free',
    access: 'open',
    color: 'random',
    timeControl: '5+0',
    status: 'waiting',
    gameStatus: 'waiting',
    paymentStatus: null,
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    expiresAt: '2026-06-18T00:02:00.000Z',
    ...overrides,
  };
}

function seedSession() {
  localStorage.setItem('chess_pvp_session_v1', JSON.stringify({
    sessionId: 'white-session',
    sessionProof: 'session-proof',
    expiresAt: '2099-01-01T00:00:00.000Z',
    riskLevel: 'low',
    captchaRequired: false,
    walletProofRequired: false,
  }));
}

function seedCredential() {
  localStorage.setItem('chess_pvp_credentials_v1', JSON.stringify({
    'game-1': {
      gameId: 'game-1',
      color: 'w',
      playerToken: 'white-token',
      updatedAt: Date.now(),
    },
  }));
}

describe('useOnlinePvp', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: testLocalStorage,
    });
    localStorage.clear();
    clearStoredPvpSession();
    seedSession();
    seedCredential();
    supabaseTest.state.invocations = [];
    supabaseTest.state.responses = [];
    supabaseTest.supabase.functions.invoke.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a referee game and derives last-move feedback', async () => {
    queueResponses(refereeJoinResponse({ ...baseRow, moves: ['e4', 'e5'] }));

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.history).toEqual(['e4', 'e5']);
    expect(result.current.highlightedSquares).toEqual(['e7', 'e5']);
    expect(result.current.lastMoveFeedback).toMatchObject({
      from: 'e7',
      to: 'e5',
      san: 'e5',
      tone: 'move',
      color: 'b',
    });
    expect(supabaseTest.state.invocations[0]).toMatchObject({
      fn: 'pvp-referee',
      body: {
        action: 'join_game',
        gameId: 'game-1',
        sessionId: 'white-session',
        sessionProof: 'session-proof',
        playerToken: 'white-token',
      },
    });

    unmount();
  });

  it('reports invalid remote SAN instead of throwing', async () => {
    queueResponses(refereeJoinResponse({ ...baseRow, moves: ['definitely-not-san'] }));

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.syncError).toBe('Game data is out of sync. Waiting for a clean update...');
    expect(result.current.history).toEqual([]);
    expect(result.current.lastMoveFeedback).toBeNull();

    unmount();
  });

  it('submits legal moves through the referee and updates feedback', async () => {
    queueResponses(
      refereeJoinResponse(baseRow),
      refereeGameResponse({ ...baseRow, moves: ['e4'] }),
    );

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSquareClick('e2' as Square);
    });
    await act(async () => {
      await result.current.handleSquareClick('e4' as Square);
    });

    await waitFor(() => expect(result.current.movePending).toBe(false));

    const moveInvocation = supabaseTest.state.invocations.find((invocation) => invocation.body.action === 'move');
    expect(moveInvocation).toMatchObject({
      fn: 'pvp-referee',
      body: {
        action: 'move',
        gameId: 'game-1',
        sessionId: 'white-session',
        sessionProof: 'session-proof',
        playerToken: 'white-token',
        from: 'e2',
        to: 'e4',
        promotion: 'q',
        expectedPly: 0,
      },
    });
    expect(result.current.history).toEqual(['e4']);
    expect(result.current.lastMoveFeedback).toMatchObject({
      from: 'e2',
      to: 'e4',
      san: 'e4',
    });

    unmount();
  });

  it('surfaces referee move rejection without mutating the board', async () => {
    queueResponses(
      refereeJoinResponse(baseRow),
      { data: null, error: { message: 'Move rejected by referee' } },
    );

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSquareClick('e2' as Square);
    });
    await act(async () => {
      await result.current.handleSquareClick('e4' as Square);
    });

    await waitFor(() => expect(result.current.movePending).toBe(false));

    expect(result.current.moveError).toBe('Move rejected by referee');
    expect(result.current.history).toEqual([]);
    expect(result.current.currentTurn).toBe('w');

    unmount();
  });

  it('surfaces referee polling failures as reconnecting and offline states', async () => {
    queueResponses(
      refereeJoinResponse(baseRow),
      { data: null, error: { message: 'Network unavailable' } },
      { data: null, error: { message: 'Network unavailable' } },
      { data: null, error: { message: 'Network unavailable' } },
    );

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    try {
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.connectionStatus).toBe('online');

      await waitFor(() => expect(result.current.connectionStatus).toBe('reconnecting'), { timeout: 2500 });
      expect(result.current.connectionMessage).toBe('Could not reach referee. Retrying...');

      await waitFor(() => expect(result.current.connectionStatus).toBe('offline'), { timeout: 5500 });
    } finally {
      unmount();
    }
  }, 8_000);

  it('rejects illegal targets locally without clearing selection or invoking the referee', async () => {
    queueResponses(refereeJoinResponse(baseRow));

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.handleSquareClick('e2' as Square);
    });
    await act(async () => {
      await result.current.handleSquareClick('e5' as Square);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.selectedSquare).toBe('e2');
    expect(result.current.legalMoves).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(result.current.invalidMoveFeedback).toMatchObject({
      square: 'e5',
      message: 'THAT PIECE CANNOT MOVE THERE',
    });
    expect(supabaseTest.state.invocations.filter((invocation) => invocation.body.action === 'move')).toHaveLength(0);

    unmount();
  });

  it('submits the chosen promotion piece through the referee', async () => {
    queueResponses(
      refereeJoinResponse(baseRow),
      refereeGameResponse(baseRow),
    );

    const { result, unmount } = renderHook(() => useOnlinePvp('game-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.gameInstance.load('8/P7/8/8/8/8/8/k6K w - - 0 1');
    });
    await act(async () => {
      await result.current.handleSquareClick('a7' as Square);
    });
    await act(async () => {
      await result.current.handleSquareClick('a8' as Square);
    });

    expect(result.current.pendingPromotion).toEqual({
      from: 'a7',
      to: 'a8',
      color: 'w',
    });

    await act(async () => {
      await result.current.choosePromotion('n');
    });

    await waitFor(() => expect(result.current.movePending).toBe(false));

    const moveInvocation = supabaseTest.state.invocations.find((invocation) => invocation.body.action === 'move');
    expect(moveInvocation?.body).toMatchObject({
      action: 'move',
      from: 'a7',
      to: 'a8',
      promotion: 'n',
      expectedPly: 0,
    });
    expect(result.current.pendingPromotion).toBeNull();

    unmount();
  });

  it('joins the practice queue through the referee and stores credentials', async () => {
    localStorage.removeItem('chess_pvp_credentials_v1');
    queueResponses(refereeJoinResponse(baseRow));

    await expect(joinPvpQueue('3+2')).resolves.toBe('game-1');

    expect(JSON.parse(localStorage.getItem('chess_pvp_credentials_v1') || '{}')).toMatchObject({
      'game-1': {
        gameId: 'game-1',
        color: 'w',
        playerToken: 'white-token',
      },
    });
    expect(supabaseTest.state.invocations[0]).toMatchObject({
      fn: 'pvp-referee',
      body: {
        action: 'join_queue',
        sessionId: 'white-session',
        sessionProof: 'session-proof',
        timeControl: '3+2',
      },
    });
  });

  it('lists shared PvP lobbies through the referee', async () => {
    queueResponses({
      data: {
        ok: true,
        lobbies: [
          refereeLobbyResponse({ id: 'lobby-1', name: 'FIRST TABLE' }),
          refereeLobbyResponse({ id: 'lobby-2', name: 'SECOND TABLE', gameId: 'game-2' }),
        ],
      },
      error: null,
    });

    await expect(listPvpLobbies()).resolves.toMatchObject([
      { id: 'lobby-1', name: 'FIRST TABLE' },
      { id: 'lobby-2', name: 'SECOND TABLE', gameId: 'game-2' },
    ]);

    expect(supabaseTest.state.invocations[0]).toMatchObject({
      fn: 'pvp-referee',
      body: {
        action: 'list_lobbies',
        sessionId: 'white-session',
        sessionProof: 'session-proof',
      },
    });
  });

  it('lists lobby directory queue counts through the referee', async () => {
    queueResponses({
      data: {
        ok: true,
        lobbies: [
          refereeLobbyResponse({ id: 'lobby-1', name: 'FIRST TABLE', formatLabel: 'Blitz 5+0' }),
        ],
        queueCounts: [
          {
            matchType: 'free',
            formatId: 'blitz_5_0',
            formatFamily: 'blitz',
            formatLabel: 'Blitz 5+0',
            timeControl: '5+0',
            players: 3,
          },
          {
            matchType: 'wager',
            formatId: 'rapid_10_0',
            formatFamily: 'rapid',
            formatLabel: 'Rapid 10+0',
            timeControl: '10+0',
            stakeRaw: '50000000',
            assetSymbol: 'SOL',
            players: 1,
          },
        ],
      },
      error: null,
    });

    await expect(listPvpLobbyDirectory()).resolves.toMatchObject({
      lobbies: [{ id: 'lobby-1', formatLabel: 'Blitz 5+0' }],
      queueCounts: [
        { matchType: 'free', timeControl: '5+0', players: 3 },
        { matchType: 'wager', timeControl: '10+0', stakeRaw: '50000000', players: 1 },
      ],
    });
  });

  it('creates a shared free lobby and stores the host credential', async () => {
    localStorage.removeItem('chess_pvp_credentials_v1');
    queueResponses({
      data: {
        gameId: 'game-1',
        color: 'w',
        playerToken: 'white-token',
        game: { ...baseRow, status: 'waiting', black_player_present: false },
        lobby: refereeLobbyResponse({ name: 'MY LOBBY' }),
      },
      error: null,
    });

    await expect(createPvpLobby({
      name: 'MY LOBBY',
      hostName: 'PLAYER 1',
      matchType: 'free',
      access: 'open',
      color: 'random',
      timeControl: '5+0',
    })).resolves.toMatchObject({
      gameId: 'game-1',
      lobby: { name: 'MY LOBBY' },
    });

    expect(JSON.parse(localStorage.getItem('chess_pvp_credentials_v1') || '{}')).toMatchObject({
      'game-1': {
        gameId: 'game-1',
        color: 'w',
        playerToken: 'white-token',
      },
    });
    expect(supabaseTest.state.invocations[0].body).toMatchObject({
      action: 'create_lobby',
      lobbyName: 'MY LOBBY',
      hostName: 'PLAYER 1',
      matchType: 'free',
    });
  });

  it('joins a shared free lobby and stores the guest credential', async () => {
    localStorage.removeItem('chess_pvp_credentials_v1');
    queueResponses({
      data: {
        gameId: 'game-1',
        color: 'b',
        playerToken: 'black-token',
        game: baseRow,
        lobby: refereeLobbyResponse({ status: 'active' }),
      },
      error: null,
    });

    await expect(joinPvpLobby('lobby-1')).resolves.toMatchObject({
      gameId: 'game-1',
      lobby: { id: 'lobby-1' },
      requiresWager: false,
    });

    expect(JSON.parse(localStorage.getItem('chess_pvp_credentials_v1') || '{}')).toMatchObject({
      'game-1': {
        gameId: 'game-1',
        color: 'b',
        playerToken: 'black-token',
      },
    });
    expect(supabaseTest.state.invocations[0].body).toMatchObject({
      action: 'join_lobby',
      lobbyId: 'lobby-1',
    });
  });
});
