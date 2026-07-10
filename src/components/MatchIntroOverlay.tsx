interface MatchIntroOverlayProps {
  show: boolean;
  title: string;
  matchup: string;
  subtitle?: string;
}

export default function MatchIntroOverlay({ show, title, matchup, subtitle }: MatchIntroOverlayProps) {
  if (!show) return null;

  return (
    <div className="match-intro-overlay" aria-live="polite">
      <div className="match-intro-card">
        <div className="match-intro-rays" aria-hidden="true" />
        <p className="match-intro-kicker">{title}</p>
        <p className="match-intro-matchup">{matchup}</p>
        {subtitle && <p className="match-intro-subtitle">{subtitle}</p>}
      </div>
    </div>
  );
}
