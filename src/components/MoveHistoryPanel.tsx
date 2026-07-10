import type { PieceSymbol, Square } from 'chess.js';
import { useState } from 'react';
import { ChevronDown, List } from 'lucide-react';
import { describeMove } from '@/lib/moveHistoryDescription';

export interface MoveHistoryEntry {
  san: string;
  from?: Square;
  to?: Square;
  piece?: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  isCapture?: boolean;
  isCheck?: boolean;
  isCheckmate?: boolean;
  isKingsideCastle?: boolean;
  isQueensideCastle?: boolean;
}

interface MoveHistoryPanelProps {
  history: string[];
  moves?: MoveHistoryEntry[];
  title?: string;
  pulseKey?: string | null;
}

function entryFromSan(san: string): MoveHistoryEntry {
  return { san };
}

function getMoveRows(history: string[], moves?: MoveHistoryEntry[]) {
  const entries = moves?.length ? moves : history.map(entryFromSan);
  const rows: Array<{ number: number; white: MoveHistoryEntry; black: MoveHistoryEntry | null }> = [];

  for (let index = 0; index < entries.length; index += 2) {
    rows.push({
      number: Math.floor(index / 2) + 1,
      white: entries[index],
      black: entries[index + 1] ?? null,
    });
  }

  return rows;
}

function MoveCell({ move }: { move: MoveHistoryEntry | null }) {
  if (!move) {
    return <span className="move-history-pending">WAITING...</span>;
  }

  return (
    <span className="move-history-card">
      <span className="move-history-san">{move.san}</span>
      <span className="move-history-detail">{describeMove(move)}</span>
    </span>
  );
}

export default function MoveHistoryPanel({ history, moves, title = 'MOVE LOG', pulseKey }: MoveHistoryPanelProps) {
  const rows = getMoveRows(history, moves);
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      className={`move-history-panel retro-panel ${expanded ? 'is-expanded' : 'is-collapsed'} ${pulseKey ? 'is-pulsing' : ''}`}
      aria-label={title}
    >
      <button className="move-history-header" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <List size={14}/><span>{title}</span>
        <span>{history.length}</span>
        <ChevronDown size={14}/>
      </button>
      <div className="move-history-list" hidden={!expanded}>
        {rows.length === 0 ? (
          <p className="move-history-empty">MAKE THE FIRST MOVE</p>
        ) : (
          rows.map((row) => (
            <div key={row.number} className="move-history-row">
              <span className="move-history-number">{row.number}.</span>
              <MoveCell move={row.white} />
              <MoveCell move={row.black} />
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
