export type PromotionPiece = 'q' | 'r' | 'b' | 'n';

interface PromotionPickerProps {
  color: 'w' | 'b';
  disabled?: boolean;
  onCancel: () => void;
  onSelect: (piece: PromotionPiece) => void;
}

const PROMOTION_OPTIONS: Array<{ piece: PromotionPiece; label: string; whiteSymbol: string; blackSymbol: string }> = [
  { piece: 'q', label: 'QUEEN', whiteSymbol: '♕', blackSymbol: '♛' },
  { piece: 'r', label: 'ROOK', whiteSymbol: '♖', blackSymbol: '♜' },
  { piece: 'b', label: 'BISHOP', whiteSymbol: '♗', blackSymbol: '♝' },
  { piece: 'n', label: 'KNIGHT', whiteSymbol: '♘', blackSymbol: '♞' },
];

export default function PromotionPicker({ color, disabled = false, onCancel, onSelect }: PromotionPickerProps) {
  return (
    <div className="promotion-overlay" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
      <div className="promotion-panel retro-panel">
        <div className="promotion-burst" aria-hidden="true" />
        <p className="promotion-title">PROMOTE PAWN</p>
        <p className="promotion-subtitle">FINAL RANK REACHED</p>
        <div className="promotion-options">
          {PROMOTION_OPTIONS.map((option) => (
            <button
              key={option.piece}
              type="button"
              className="promotion-option"
              disabled={disabled}
              onClick={() => onSelect(option.piece)}
            >
              <span className="promotion-symbol">
                {color === 'w' ? option.whiteSymbol : option.blackSymbol}
              </span>
              <span className="promotion-label">{option.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="retro-btn retro-btn-small" disabled={disabled} onClick={onCancel}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
