import type { Square } from 'chess.js';

export interface InvalidMoveFeedback {
  id: string;
  square: Square;
  message: string;
}

export function buildInvalidMoveFeedback(
  square: Square,
  message: string,
  sequence: number,
): InvalidMoveFeedback {
  return {
    id: `invalid-${sequence}-${square}`,
    square,
    message,
  };
}
