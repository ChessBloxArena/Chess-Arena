import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { normalizeQuickChatText } from '@/lib/quickChat';

export type QuickChatStatus = 'connecting' | 'ready' | 'offline';
export type QuickChatSender = 'me' | 'opponent';

export interface QuickChatMessage {
  id: string;
  text: string;
  color: 'w' | 'b';
  sender: QuickChatSender;
  sentAt: number;
}

interface UseQuickChatOptions {
  gameId?: string;
  playerColor: 'w' | 'b';
  enabled?: boolean;
}

interface QuickChatBroadcastPayload {
  id?: unknown;
  text?: unknown;
  color?: unknown;
  senderId?: unknown;
  sentAt?: unknown;
}

const QUICK_CHAT_EVENT = 'quick-chat';
const MAX_QUICK_CHAT_MESSAGES = 8;

function createSenderId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `quick-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeColor(value: unknown, fallback: 'w' | 'b'): 'w' | 'b' {
  return value === 'w' || value === 'b' ? value : fallback;
}

export function useQuickChat({ gameId, playerColor, enabled = true }: UseQuickChatOptions) {
  const [messages, setMessages] = useState<QuickChatMessage[]>([]);
  const [status, setStatus] = useState<QuickChatStatus>('offline');
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const senderIdRef = useRef(createSenderId());

  const appendMessage = useCallback((message: QuickChatMessage) => {
    setMessages((currentMessages) => {
      if (currentMessages.some((currentMessage) => currentMessage.id === message.id)) {
        return currentMessages;
      }

      return [...currentMessages, message].slice(-MAX_QUICK_CHAT_MESSAGES);
    });
  }, []);

  const messageFromPayload = useCallback((payload: QuickChatBroadcastPayload): QuickChatMessage | null => {
    const text = normalizeQuickChatText(payload.text);
    if (!text) return null;

    const id = typeof payload.id === 'string' && payload.id.length > 0
      ? payload.id.slice(0, 96)
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sentAt = typeof payload.sentAt === 'number' && Number.isFinite(payload.sentAt)
      ? payload.sentAt
      : Date.now();
    const senderId = typeof payload.senderId === 'string' ? payload.senderId : '';

    return {
      id,
      text,
      color: normalizeColor(payload.color, playerColor),
      sender: senderId === senderIdRef.current ? 'me' : 'opponent',
      sentAt,
    };
  }, [playerColor]);

  useEffect(() => {
    if (!gameId || !enabled) {
      setMessages([]);
      setStatus('offline');
      return;
    }

    setStatus('connecting');
    const channel = supabase.channel(`quick-chat:${gameId}`, {
      config: {
        broadcast: { self: true },
      },
    });

    channelRef.current = channel;
    channel
      .on('broadcast', { event: QUICK_CHAT_EVENT }, ({ payload }: { payload: QuickChatBroadcastPayload }) => {
        const message = messageFromPayload(payload);
        if (message) appendMessage(message);
      })
      .subscribe((nextStatus: string) => {
        if (nextStatus === 'SUBSCRIBED') {
          setStatus('ready');
        } else if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED') {
          setStatus('offline');
        } else {
          setStatus('connecting');
        }
      });

    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [appendMessage, enabled, gameId, messageFromPayload]);

  const sendQuickChat = useCallback(async (messageText: string) => {
    const text = normalizeQuickChatText(messageText);
    if (!text) return false;

    const payload = {
      id: `${senderIdRef.current}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      color: playerColor,
      senderId: senderIdRef.current,
      sentAt: Date.now(),
    };

    const channel = channelRef.current;
    if (!channel || status !== 'ready') return false;

    try {
      const result = await channel.send({
        type: 'broadcast',
        event: QUICK_CHAT_EVENT,
        payload,
      });
      if (result !== 'ok') {
        setStatus('offline');
        return false;
      }

      appendMessage({
        id: payload.id,
        text,
        color: playerColor,
        sender: 'me',
        sentAt: payload.sentAt,
      });
      return true;
    } catch {
      setStatus('offline');
      return false;
    }
  }, [appendMessage, playerColor, status]);

  return {
    messages,
    status,
    sendQuickChat,
  };
}
