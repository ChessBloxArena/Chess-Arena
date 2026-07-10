export interface PlayerTurnSeat {
  color: 'w' | 'b';
  name: string;
  label: string;
  active: boolean;
  tone?: 'local' | 'opponent' | 'cpu' | 'waiting';
  clock?: string;
}

interface PlayerTurnPanelProps {
  seats: [PlayerTurnSeat, PlayerTurnSeat];
  status: string;
  activeLabel?: string;
}

function colorName(color: 'w' | 'b') {
  return color === 'w' ? 'WHITE' : 'BLACK';
}

export default function PlayerTurnPanel({ seats, status, activeLabel }: PlayerTurnPanelProps) {
  const activeSeat = seats.find((seat) => seat.active) ?? seats[0];

  return (
    <aside className="player-turn-panel retro-panel" aria-label="Player turn status">
      <div className="player-turn-header">
        <span>TURN</span>
        <strong>{status}</strong>
      </div>
      <div className="player-turn-seats">
        {seats.map((seat) => (
          <div
            key={seat.color}
            className={`player-turn-seat player-turn-seat-${seat.color} ${seat.active ? 'is-active' : ''} ${seat.tone ? `player-turn-seat-${seat.tone}` : ''}`}
          >
            <span className="player-turn-color" aria-hidden="true" />
            <span className="player-turn-copy">
              <small>{seat.label || colorName(seat.color)}</small>
              <strong>{seat.name}</strong>
            </span>
            {seat.clock && <time className="player-turn-clock" aria-label={`${colorName(seat.color)} clock`}>{seat.clock}</time>}
          </div>
        ))}
      </div>
      <p className="player-turn-active">{activeLabel ?? `${colorName(activeSeat.color)} TO MOVE`}</p>
    </aside>
  );
}
