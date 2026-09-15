import { translateText, localize, useLanguage } from '@/lib/i18n';
import type { QuickChatStatus } from '@/hooks/useQuickChat';

export type GameConnectionStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

interface ConnectionStatusPanelProps {
  gameStatus: GameConnectionStatus;
  chatStatus?: QuickChatStatus | null;
  message?: string | null;
  onRetry?: () => void | Promise<void>;
}

function gameStatusLabel(status: GameConnectionStatus) {
  if (status === 'connecting') return 'SYNCING';
  if (status === 'reconnecting') return 'RECONNECTING';
  if (status === 'offline') return 'OFFLINE';
  return 'ONLINE';
}

function chatStatusLabel(status: QuickChatStatus) {
  if (status === 'ready') return 'CHAT LIVE';
  if (status === 'connecting') return 'CHAT LINKING';
  return 'CHAT OFFLINE';
}

function defaultMessage(gameStatus: GameConnectionStatus, chatStatus: QuickChatStatus | null) {
  if (gameStatus !== 'online') return 'Restoring match state';
  if (chatStatus === 'connecting') return 'Waiting for chat channel';
  if (chatStatus === 'offline') return 'Chat is offline';
  return 'Restoring match state';
}

export default function ConnectionStatusPanel({
  gameStatus,
  chatStatus = null,
  message,
  onRetry,
}: ConnectionStatusPanelProps) {
  useLanguage();
  const showGameStatus = gameStatus !== 'online';
  const showChatStatus = chatStatus !== null && chatStatus !== 'ready';

  if (!showGameStatus && !showChatStatus) return null;

  const tone = gameStatus === 'offline' || chatStatus === 'offline' ? 'offline' : 'syncing';

  return (
    <aside className={`connection-status-panel connection-status-${tone} retro-panel`} aria-live="polite">
      <span className="connection-status-dot" aria-hidden="true" />
      <span className="connection-status-copy">
        <strong>{localize(showGameStatus ? gameStatusLabel(gameStatus) : chatStatusLabel(chatStatus!))}</strong>
        <small>{localize(message || defaultMessage(gameStatus, chatStatus))}</small>
      </span>
      {localize(showGameStatus && onRetry && (
        <button
          type="button"
          className="connection-status-retry"
          onClick={() => {
            void onRetry();
          }}
        >{translateText("RETRY")}</button>
      ))}
    </aside>
  );
}
