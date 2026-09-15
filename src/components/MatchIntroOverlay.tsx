import { localize, useLanguage } from '@/lib/i18n';
interface MatchIntroOverlayProps {
  show: boolean;
  title: string;
  matchup: string;
  subtitle?: string;
}

export default function MatchIntroOverlay({ show, title, matchup, subtitle }: MatchIntroOverlayProps) {
  useLanguage();
  if (!show) return null;

  return (
    <div className="match-intro-overlay" aria-live="polite">
      <div className="match-intro-card">
        <div className="match-intro-rays" aria-hidden="true" />
        <p className="match-intro-kicker">{localize(title)}</p>
        <p className="match-intro-matchup">{localize(matchup)}</p>
        {localize(subtitle && <p className="match-intro-subtitle">{localize(subtitle)}</p>)}
      </div>
    </div>
  );
}
