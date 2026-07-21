import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuickChat } from './useQuickChat';

const quickChatSupabase = vi.hoisted(() => {
  const state: {
    handler: null | ((event: { payload: unknown }) => void);
    subscribeCallback: null | ((status: string) => void);
    sent: unknown[];
    removed: unknown[];
    sendResult: 'ok' | 'error';
  } = {
    handler: null,
    subscribeCallback: null,
    sent: [],
    removed: [],
    sendResult: 'ok',
  };

  const supabase = {
    channel: vi.fn((name: string, options?: unknown) => {
      const channel = {
        name,
        options,
        on: vi.fn((_type: string, _filter: unknown, callback: (event: { payload: unknown }) => void) => {
          state.handler = callback;
          return channel;
        }),
        subscribe: vi.fn((callback: (status: string) => void) => {
          state.subscribeCallback = callback;
          callback('SUBSCRIBED');
          return channel;
        }),
        send: vi.fn(async (message: unknown) => {
          state.sent.push(message);
          const payload = typeof message === 'object' && message && 'payload' in message
            ? (message as { payload: unknown }).payload
            : null;
          if (payload) state.handler?.({ payload });
          return state.sendResult;
        }),
      };
      return channel;
    }),
    removeChannel: vi.fn(async (channel: unknown) => {
      state.removed.push(channel);
      return 'ok';
    }),
  };

  return { state, supabase };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: quickChatSupabase.supabase,
}));

describe('useQuickChat', () => {
  beforeEach(() => {
    quickChatSupabase.state.handler = null;
    quickChatSupabase.state.subscribeCallback = null;
    quickChatSupabase.state.sent = [];
    quickChatSupabase.state.removed = [];
    quickChatSupabase.state.sendResult = 'ok';
    quickChatSupabase.supabase.channel.mockClear();
    quickChatSupabase.supabase.removeChannel.mockClear();
  });

  it('subscribes to a game channel and sends typed messages', async () => {
    const { result, unmount } = renderHook(() => useQuickChat({ gameId: 'game-1', playerColor: 'w' }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => {
      await result.current.sendQuickChat('  Nice fork!  ');
    });

    expect(quickChatSupabase.supabase.channel).toHaveBeenCalledWith('quick-chat:game-1', {
      config: { broadcast: { self: true } },
    });
    expect(quickChatSupabase.state.sent[0]).toMatchObject({
      type: 'broadcast',
      event: 'quick-chat',
      payload: {
        text: 'Nice fork!',
        color: 'w',
      },
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      text: 'Nice fork!',
      sender: 'me',
    });

    unmount();
    expect(quickChatSupabase.supabase.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('accepts opponent broadcasts only when they contain text', async () => {
    const { result, unmount } = renderHook(() => useQuickChat({ gameId: 'game-1', playerColor: 'w' }));

    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      quickChatSupabase.state.handler?.({
        payload: {
          id: 'opponent-1',
          text: 'Good game',
          color: 'b',
          senderId: 'other-client',
          sentAt: 123,
        },
      });
      quickChatSupabase.state.handler?.({
        payload: {
          id: 'opponent-2',
          text: '   ',
          color: 'b',
          senderId: 'other-client',
          sentAt: 124,
        },
      });
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({
        id: 'opponent-1',
        sender: 'opponent',
        color: 'b',
        text: 'Good game',
      }),
    ]);

    unmount();
  });
});
