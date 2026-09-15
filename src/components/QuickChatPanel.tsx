import { translateText, localize, useLanguage } from '@/lib/i18n';
import { MessageSquare, SendHorizontal } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { playMenuClick } from '@/lib/sounds';
import { MAX_QUICK_CHAT_MESSAGE_LENGTH, normalizeQuickChatText } from '@/lib/quickChat';
import type { QuickChatMessage, QuickChatStatus } from '@/hooks/useQuickChat';

interface QuickChatPanelProps {
  messages: QuickChatMessage[];
  status: QuickChatStatus;
  onSend: (message: string) => Promise<boolean> | boolean;
}

function statusLabel(status: QuickChatStatus) {
  if (status === 'ready') return 'LIVE';
  if (status === 'connecting') return 'LINKING';
  return 'OFFLINE';
}

export default function QuickChatPanel({ messages, status, onSend }: QuickChatPanelProps) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const latestMessage = messages[messages.length - 1] ?? null;
  const visibleMessages = useMemo(() => messages.slice(-4), [messages]);
  const canSend = status === 'ready' && normalizeQuickChatText(draft) !== null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const text = normalizeQuickChatText(draft);
    if (!text || status !== 'ready') return;

    playMenuClick();
    const sent = await onSend(text);
    if (sent) setDraft('');
  };

  return (
    <div className={`quick-chat-panel ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="quick-chat-toggle retro-panel"
        onClick={() => {
          setOpen((isOpen) => !isOpen);
          playMenuClick();
        }}
        aria-expanded={open}
      >
        <MessageSquare aria-hidden="true" size={15} strokeWidth={2.4} />
        <span>{translateText("CHAT")}</span>
        <strong>{localize(statusLabel(status))}</strong>
      </button>

      {localize(open && (
        <div className="quick-chat-menu retro-panel">
          <div className="quick-chat-feed" aria-live="polite">
            {localize(visibleMessages.length === 0 ? (
              <p className="quick-chat-empty">{translateText("NO MESSAGES YET")}</p>
            ) : visibleMessages.map((message) => (
              <div
                key={message.id}
                className={`quick-chat-message ${message.sender === 'me' ? 'is-me' : 'is-opponent'}`}
              >
                <span className="quick-chat-message-copy">
                  <small>{localize(message.sender === 'me' ? 'YOU' : message.color === 'w' ? 'WHITE' : 'BLACK')}</small>
                  <strong>{localize(message.text)}</strong>
                </span>
              </div>
            )))}
          </div>

          <form className="quick-chat-compose" onSubmit={handleSubmit}>
            <input
              type="text"
              className="quick-chat-input"
              value={draft}
              maxLength={MAX_QUICK_CHAT_MESSAGE_LENGTH}
              placeholder={localize(status === 'ready' ? 'TYPE MESSAGE' : 'CHAT OFFLINE')}
              disabled={status !== 'ready'}
              aria-label={translateText("Chat message")}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button
              type="submit"
              className="quick-chat-send"
              disabled={!canSend}
              aria-label={translateText("Send chat message")}
            >
              <SendHorizontal aria-hidden="true" size={15} strokeWidth={2.4} />
            </button>
          </form>
        </div>
      ))}

      {localize(latestMessage && !open && (
        <div key={latestMessage.id} className={`quick-chat-toast ${latestMessage.sender === 'me' ? 'is-me' : 'is-opponent'}`} aria-live="polite">
          <strong>{localize(latestMessage.sender === 'me' ? 'YOU' : latestMessage.color === 'w' ? 'WHITE' : 'BLACK')}</strong>
          <em>{localize(latestMessage.text)}</em>
        </div>
      ))}
    </div>
  );
}
