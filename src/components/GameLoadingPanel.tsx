interface GameLoadingPanelProps {
  title: string;
  subtitle?: string;
}

export default function GameLoadingPanel({ title, subtitle }: GameLoadingPanelProps) {
  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background p-4">
      <div className="game-loading-panel retro-panel" role="status" aria-live="polite">
        <span className="game-loading-eyebrow">CHESSBLOX</span>
        <span className="game-loading-title retro-blink">{title}</span>
        {subtitle && <span className="game-loading-subtitle">{subtitle}</span>}
        <span className="game-loading-track" aria-hidden="true">
          <span />
        </span>
      </div>
    </div>
  );
}
