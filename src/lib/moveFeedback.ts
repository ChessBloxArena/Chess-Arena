import type { Chess, Move, PieceSymbol, Square } from 'chess.js';

export type MoveFeedbackTone = 'move' | 'capture' | 'check' | 'checkmate' | 'draw' | 'promotion';

export interface MoveFeedback {
  id: string;
  from: Square;
  to: Square;
  san: string;
  color: 'w' | 'b';
  piece: PieceSymbol;
  captured?: PieceSymbol;
  capturedSquare?: Square;
  promotion?: PieceSymbol;
  tone: MoveFeedbackTone;
  isCapture: boolean;
  isPromotion: boolean;
  isCheck: boolean;
  isCheckmate: boolean;
  isDraw: boolean;
  targetKingSquare?: Square;
}

function findKingSquare(game: Chess, color: 'w' | 'b'): Square | undefined {
  const board = game.board();

  for (let rowIndex = 0; rowIndex < board.length; rowIndex += 1) {
    for (let colIndex = 0; colIndex < board[rowIndex].length; colIndex += 1) {
      const piece = board[rowIndex][colIndex];
      if (piece?.type === 'k' && piece.color === color) {
        return `${String.fromCharCode(97 + colIndex)}${8 - rowIndex}` as Square;
      }
    }
  }

  return undefined;
}

function getCapturedSquare(move: Move): Square | undefined {
  if (!move.captured) return undefined;
  if (move.flags.includes('e')) {
    return `${move.to[0]}${move.from[1]}` as Square;
  }
  return move.to;
}

export function buildMoveFeedback(game: Chess, move: Move): MoveFeedback {
  const isCheckmate = game.isCheckmate();
  const isDraw = game.isDraw();
  const isCheck = game.isCheck();
  const isCapture = Boolean(move.captured);
  const isPromotion = Boolean(move.promotion);
  const targetKingSquare = isCheck || isCheckmate ? findKingSquare(game, game.turn()) : undefined;
  const capturedSquare = getCapturedSquare(move);

  let tone: MoveFeedbackTone = 'move';
  if (isCheckmate) {
    tone = 'checkmate';
  } else if (isDraw) {
    tone = 'draw';
  } else if (isCheck) {
    tone = 'check';
  } else if (isPromotion) {
    tone = 'promotion';
  } else if (isCapture) {
    tone = 'capture';
  }

  return {
    id: `${move.color}-${move.piece}-${move.from}-${move.to}-${move.san}-${game.history().length}`,
    from: move.from,
    to: move.to,
    san: move.san,
    color: move.color,
    piece: move.piece,
    captured: move.captured,
    capturedSquare,
    promotion: move.promotion,
    tone,
    isCapture,
    isPromotion,
    isCheck,
    isCheckmate,
    isDraw,
    targetKingSquare,
  };
}
