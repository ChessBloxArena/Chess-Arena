import type { Square as ChessSquare } from 'chess.js';

// More room for the court's hats, arms and streetwear without shrinking the models.
export const BOARD_SQUARE_SIZE = 1.28;
export const BOARD_HALF_SIZE = 4 * BOARD_SQUARE_SIZE;

export function squareToBoardPosition(square: string): [number, number, number] {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]) - 1;
  return [(file - 3.5) * BOARD_SQUARE_SIZE, 0, (3.5 - rank) * BOARD_SQUARE_SIZE];
}

export function pointToBoardSquare(point: { x: number; z: number }): ChessSquare | null {
  const file = Math.floor(point.x / BOARD_SQUARE_SIZE + 4);
  const rank = Math.floor(4 - point.z / BOARD_SQUARE_SIZE);

  if (file < 0 || file > 7 || rank < 0 || rank > 7) {
    return null;
  }

  return `${String.fromCharCode(97 + file)}${rank + 1}` as ChessSquare;
}
