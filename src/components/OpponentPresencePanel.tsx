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
  return (
    <aside className={`opponent-panel opponent-panel-${accent} ${thinking ? 'is-thinking' : ''}`} aria-label="Opponent status">
      <div className="opponent-panel-badge" aria-hidden="true" />
      <div className="opponent-panel-copy">
        <p className="opponent-panel-label">{label}</p>
        <p className="opponent-panel-name">{name}</p>
        <p className="opponent-panel-mood">{mood}</p>
      </div>
      <div className="opponent-panel-meter" aria-hidden="true">
        <span />
      </div>
    </aside>
  );
}
