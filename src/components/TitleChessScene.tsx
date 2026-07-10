import { useMemo } from 'react';
import { Chess } from 'chess.js';
import type { Square as ChessSquare } from 'chess.js';
import ChessScene from './ChessScene';

const noop = (_sq: ChessSquare) => {};

export default function TitleChessScene() {
  const board = useMemo(() => {
    const game = new Chess();
    return game.board();
  }, []);

  return (
    <div className="absolute inset-0">
      <ChessScene
        board={board}
        selectedSquare={null}
        legalMoves={[]}
        onSquareClick={noop}
        cpuMode={false}
        cpuThinking={false}
        showcase

      />
    </div>
  );
}
