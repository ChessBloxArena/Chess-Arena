import { Chess } from 'chess.js';

type Difficulty = 'easy' | 'medium' | 'hard';

const MATE_SCORE = 100_000;

const PIECE_VALUES: Record<string, number> = {
  p: 10, n: 30, b: 30, r: 50, q: 90, k: 900,
};

const FALLBACK_BLACK_OPENING_REPLIES = ['d5', 'Nf6', 'e5', 'c5', 'e6', 'c6', 'g6', 'Nc6'];

const BLACK_OPENING_BOOK: Record<string, string[]> = {
  e4: ['c5', 'e5', 'e6', 'c6', 'Nf6', 'd5'],
  d4: ['Nf6', 'd5', 'e6', 'c5', 'g6'],
  c4: ['Nf6', 'e5', 'c5', 'e6', 'g6'],
  Nf3: ['d5', 'Nf6', 'c5', 'g6'],
  g3: ['d5', 'Nf6', 'e5', 'g6'],
  b3: ['d5', 'Nf6', 'e5'],
  f4: ['d5', 'Nf6', 'e6', 'g6'],
  b4: ['e5', 'Nf6', 'd5'],
};

function randomIndex(length: number, random: () => number): number {
  return Math.min(Math.floor(random() * length), length - 1);
}

function getOpeningReply(chess: Chess, difficulty: Difficulty, moves: string[], random: () => number): string | null {
  if (difficulty === 'easy' || chess.turn() !== 'b' || chess.history().length !== 1) {
    return null;
  }

  const [firstMove] = chess.history();
  const candidates = BLACK_OPENING_BOOK[firstMove] ?? FALLBACK_BLACK_OPENING_REPLIES;
  const legalCandidates = candidates.filter((move) => moves.includes(move));

  if (legalCandidates.length === 0) return null;

  return legalCandidates[randomIndex(legalCandidates.length, random)];
}

function evaluate(chess: Chess, depth: number): number {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -MATE_SCORE - depth : MATE_SCORE + depth;
  }

  if (chess.isDraw()) {
    return 0;
  }

  const board = chess.board();
  let score = 0;
  for (const row of board) {
    for (const piece of row) {
      if (piece) {
        const val = PIECE_VALUES[piece.type] || 0;
        score += piece.color === 'w' ? val : -val;
      }
    }
  }
  return score;
}

function minimax(chess: Chess, depth: number, alpha: number, beta: number, isMax: boolean): number {
  if (depth === 0 || chess.isGameOver()) return evaluate(chess, depth);

  const moves = chess.moves();

  if (isMax) {
    let best = -Infinity;
    for (const move of moves) {
      chess.move(move);
      best = Math.max(best, minimax(chess, depth - 1, alpha, beta, false));
      chess.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const move of moves) {
      chess.move(move);
      best = Math.min(best, minimax(chess, depth - 1, alpha, beta, true));
      chess.undo();
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

export function getBestMove(chess: Chess, difficulty: Difficulty, random = Math.random): string | null {
  const moves = chess.moves();
  if (moves.length === 0) return null;

  const openingReply = getOpeningReply(chess, difficulty, moves, random);
  if (openingReply) return openingReply;

  if (difficulty === 'easy') {
    return moves[randomIndex(moves.length, random)];
  }

  const depth = difficulty === 'medium' ? 2 : 3;
  const isBlack = chess.turn() === 'b';

  let bestMove = moves[0];
  let bestScore = isBlack ? Infinity : -Infinity;

  // Shuffle to add randomness at same eval
  const shuffled = [...moves].sort(() => random() - 0.5);

  for (const move of shuffled) {
    chess.move(move);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, isBlack);
    chess.undo();

    if (isBlack ? score < bestScore : score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}
