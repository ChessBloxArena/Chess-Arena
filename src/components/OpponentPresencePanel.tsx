import { translateText, localize, useLanguage } from '@/lib/i18n';
interface OpponentPresencePanelProps {
  name: string;
  label: string;
  mood: string;
  accent?: 'green' | 'gold' | 'red';
  thinking?: boolean;
}

export default function OpponentPresencePanel({
  name,
  label,
  mood,
  accent = 'green',
  thinking = false,
}: OpponentPresencePanelProps) {
  useLanguage();
  return (
    <aside className={`opponent-panel opponent-panel-${accent} ${thinking ? 'is-thinking' : ''}`} aria-label={translateText("Opponent status")}>
      <div className="opponent-panel-badge" aria-hidden="true" />
      <div className="opponent-panel-copy">
        <p className="opponent-panel-label">{localize(label)}</p>
        <p className="opponent-panel-name">{name}</p>
        <p className="opponent-panel-mood">{localize(mood)}</p>
      </div>
      <div className="opponent-panel-meter" aria-hidden="true">
        <span />
      </div>
    </aside>
  );
}
