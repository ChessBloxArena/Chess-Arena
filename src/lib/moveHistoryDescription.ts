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

export function describeMove(move: DescribableMove, language: 'en' | 'zh-CN' = 'en'): string {
  if (language === 'zh-CN') {
    const names: Record<PieceSymbol, string> = { p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' };
    if (move.isKingsideCastle) return '王翼易位';
    if (move.isQueensideCastle) return '后翼易位';
    if (!move.from || !move.to || !move.piece) return '棋谱记法';
    const action = move.isCapture || move.captured ? '吃至' : '走至';
    const promotion = move.promotion ? `，升变为${names[move.promotion]}` : '';
    const ending = move.isCheckmate ? '，将死' : move.isCheck ? '，将军' : '';
    return `${names[move.piece]} ${squareLabel(move.from)} ${action} ${squareLabel(move.to)}${promotion}${ending}`;
  }
  if (move.isKingsideCastle) return 'King castles short';
  if (move.isQueensideCastle) return 'King castles long';
  if (!move.from || !move.to || !move.piece) return 'Chess notation';

  const pieceName = PIECE_NAMES[move.piece];
  const action = move.isCapture || move.captured ? 'takes' : 'to';
  const promotion = move.promotion ? `, promotes to ${PIECE_NAMES[move.promotion]}` : '';
  const ending = move.isCheckmate ? ', checkmate' : move.isCheck ? ', check' : '';

  return `${pieceName} ${squareLabel(move.from)} ${action} ${squareLabel(move.to)}${promotion}${ending}`;
}
