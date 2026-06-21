import type { PieceSymbol, Square } from 'chess.js';

export interface DescribableMove {
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

const PIECE_NAMES: Record<PieceSymbol, string> = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

function squareLabel(square: Square | undefined): string {
  return square ? square.toUpperCase() : '';
}

export function describeMove(move: DescribableMove): string {
  if (move.isKingsideCastle) return 'King castles short';
  if (move.isQueensideCastle) return 'King castles long';
  if (!move.from || !move.to || !move.piece) return 'Chess notation';

  const pieceName = PIECE_NAMES[move.piece];
  const action = move.isCapture || move.captured ? 'takes' : 'to';
  const promotion = move.promotion ? `, promotes to ${PIECE_NAMES[move.promotion]}` : '';
  const ending = move.isCheckmate ? ', checkmate' : move.isCheck ? ', check' : '';

  return `${pieceName} ${squareLabel(move.from)} ${action} ${squareLabel(move.to)}${promotion}${ending}`;
}
