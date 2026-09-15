import { translateText, localize, useLanguage } from '@/lib/i18n';
interface GameLoadingPanelProps {
  title: string;
  subtitle?: string;
}

export default function GameLoadingPanel({ title, subtitle }: GameLoadingPanelProps) {
  useLanguage();
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
      <div className="game-loading-panel retro-panel" role="status" aria-live="polite">
        <span className="game-loading-eyebrow">{translateText("CHESSBLOX")}</span>
        <span className="game-loading-title retro-blink">{localize(title)}</span>
        {localize(subtitle && <span className="game-loading-subtitle">{localize(subtitle)}</span>)}
        <span className="game-loading-track" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}
