import ThemeSelector from '@/components/ThemeSelector';
import { useArenaTheme } from '@/hooks/useArenaTheme';

interface GamePausePanelProps {
  open: boolean;
  title: string;
  subtitle: string;
  status: string;
  moves: number;
  musicOn: boolean;
  sfxOn: boolean;
  onClose: () => void;
  onMenu: () => void;
  onToggleMusic: () => void;
  onToggleSfx: () => void;
  onNewGame?: () => void;
}

export default function GamePausePanel({
  open,
  title,
  subtitle,
  status,
  moves,
  musicOn,
  sfxOn,
  onClose,
  onMenu,
  onToggleMusic,
  onToggleSfx,
  onNewGame,
}: GamePausePanelProps) {
  const { themesEnabled } = useArenaTheme();

  if (!open) return null;

  return (
    <div className="pause-overlay" role="dialog" aria-modal="true" aria-label="Game options">
      <div className="pause-panel retro-panel">
        <p className="pause-eyebrow">PAUSED</p>
        <h2 className="pause-title">{title}</h2>
        <p className="pause-subtitle">{subtitle}</p>

        <div className="pause-state-grid" aria-label="Match state">
          <div>
            <span>STATE</span>
            <strong>{status}</strong>
          </div>
          <div>
            <span>MOVES</span>
            <strong>{moves}</strong>
          </div>
        </div>

        {themesEnabled && (
          <div className="pause-theme-block">
            <p>THEME</p>
            <ThemeSelector compact />
          </div>
        )}

        <div className="pause-actions">
          <button type="button" className="retro-btn retro-btn-gold" onClick={onClose}>
            RESUME
          </button>
          {onNewGame && (
            <button type="button" className="retro-btn" onClick={onNewGame}>
              NEW GAME
            </button>
          )}
          <button type="button" className="retro-btn" onClick={onToggleMusic}>
            MUSIC {musicOn ? 'ON' : 'OFF'}
          </button>
          <button type="button" className="retro-btn" onClick={onToggleSfx}>
            SFX {sfxOn ? 'ON' : 'OFF'}
          </button>
          <button type="button" className="retro-btn retro-btn-small" onClick={onMenu}>
            MENU
          </button>
        </div>
      </div>
    </div>
  );
}
