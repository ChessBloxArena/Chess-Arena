import { translateText, localize, useLanguage } from '@/lib/i18n';
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
  useLanguage();
  const { themesEnabled } = useArenaTheme();

  if (!open) return null;

  return (
    <div className="pause-overlay" role="dialog" aria-modal="true" aria-label={translateText("Game options")}>
      <div className="pause-panel retro-panel">
        <p className="pause-eyebrow">{translateText("PAUSED")}</p>
        <h2 className="pause-title">{localize(title)}</h2>
        <p className="pause-subtitle">{localize(subtitle)}</p>

        <div className="pause-state-grid" aria-label={translateText("Match state")}>
          <div>
            <span>{translateText("STATE")}</span>
            <strong>{localize(status)}</strong>
          </div>
          <div>
            <span>{translateText("MOVES")}</span>
            <strong>{localize(moves)}</strong>
          </div>
        </div>

        {localize(themesEnabled && (
          <div className="pause-theme-block">
            <p>{translateText("THEME")}</p>
            <ThemeSelector compact />
          </div>
        ))}

        <div className="pause-actions">
          <button type="button" className="retro-btn retro-btn-gold" onClick={onClose}>{translateText("RESUME")}</button>
          {localize(onNewGame && (
            <button type="button" className="retro-btn" onClick={onNewGame}>{translateText("NEW GAME")}</button>
          ))}
          <button type="button" className="retro-btn" onClick={onToggleMusic}>{translateText("MUSIC ")}{localize(musicOn ? 'ON' : 'OFF')}
          </button>
          <button type="button" className="retro-btn" onClick={onToggleSfx}>{translateText("SFX ")}{localize(sfxOn ? 'ON' : 'OFF')}
          </button>
          <button type="button" className="retro-btn retro-btn-small" onClick={onMenu}>{translateText("MENU")}</button>
        </div>
      </div>
    </div>
  );
}
