// Local deterministic interaction fixture; no wallet, referee or external game server.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { Chess, type Square, type PieceSymbol } from 'chess.js';
import { buildMoveFeedback, type MoveFeedback } from '../../src/lib/moveFeedback';
import { ArenaThemeProvider } from '../../src/components/ArenaThemeProvider';
import ChessScene from '../../src/components/ChessScene';
import { useChessGame } from '../../src/hooks/useChessGame';
import '../../src/index.css';
import '../../src/blox.css';
import '../../src/sky-club.css';
const scenarios = [
  ['Pawn', 'p', 'd2', 'e3'], ['Rook', 'r', 'd2', 'd6'], ['Knight', 'n', 'd2', 'f3'],
  ['Bishop', 'b', 'c2', 'f5'], ['Queen', 'q', 'd2', 'd6'], ['King', 'k', 'd2', 'e3'],
] as const;
function Fixture() {
  const g = useChessGame('pvp', 'medium'), [flipped, setFlipped] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [choreography, setChoreography] = useState<{ game: Chess; from: Square; to: Square; feedback: MoveFeedback | null } | null>(null);
  function loadRole(role: PieceSymbol, from: Square, to: Square) {
    setSceneKey(v => v + 1);
    const game = new Chess('7k/8/8/8/8/8/8/K7 w - - 0 1');
    if (role === 'k') game.remove('a1');
    game.put({ type: role, color: 'w' }, from);
    game.put({ type: 'p', color: 'b' }, to);
    if (role === 'n') { game.put({ type: 'p', color: 'w' }, 'e2'); game.put({ type: 'p', color: 'w' }, 'e3'); }
    setChoreography({ game, from, to, feedback: null });
  }
  function performMove() {
    if (!choreography) return;
    const move = choreography.game.move({ from: choreography.from, to: choreography.to });
    setChoreography({ ...choreography, feedback: buildMoveFeedback(choreography.game, move) });
  }
  function loadDefeat(role: PieceSymbol) {
    setSceneKey(v => v + 1);
    const game = new Chess(role === 'k' ? '7k/8/5KQ1/8/8/8/8/8 w - - 0 1' : '7k/8/8/8/8/8/8/K7 w - - 0 1');
    if (role !== 'k') {
      game.put({type: 'r', color:'w'}, 'd2');
      game.put({type: role, color:'b'}, 'd5');
    }
    setChoreography({game, from: role === 'k' ? 'g6' : 'd2', to: role === 'k' ? 'g7' : 'd5', feedback:null});
  }
  return <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
    <header style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 12, background: '#fcfaf3' }}>
      <button className="retro-btn-small" onClick={() => {setChoreography(null);setSceneKey(v => v + 1);g.reset();}}>Reset board</button>
      <button className="retro-btn-small" disabled={g.history.length !== 0} onClick={() => g.handlePieceDrop('e2', 'e4')}>Play e4</button>
      <button className="retro-btn-small" disabled={g.history.length !== 1} onClick={() => g.handlePieceDrop('d7', 'd5')}>Reply d5</button>
      <button className="retro-btn-small" disabled={g.history.length !== 2} onClick={() => g.handlePieceDrop('e4', 'd5')}>Capture exd5</button>
      <button className="retro-btn-small" disabled={g.history.length !== 0} onClick={() => g.handlePieceDrop('g1', 'f3')}>Knight f3</button>
      <button className="retro-btn-small" onClick={() => setFlipped(v => !v)}>Flip board</button>
      {scenarios.map(([name, role, from, to]) => <button key={role} className="retro-btn-small" onClick={() => loadRole(role, from, to)}>{name} scene</button>)}
      {scenarios.map(([name, role]) => <button key={`defeat-${role}`} className="retro-btn-small" onClick={() => loadDefeat(role)}>{name} defeat</button>)}
      <button className="retro-btn-small" disabled={!choreography || !!choreography.feedback} onClick={performMove}>Animate capture</button>
      <output aria-label="Choreography">{choreography?.feedback?.san ?? (choreography ? 'Ready' : 'Full game')}</output>
      <output aria-label="Move record">{g.history.join(' ') || 'Starting position'}</output>
      <output aria-label="Captured pieces">Captured: {g.capturedPieces.w.length + g.capturedPieces.b.length}</output>
    </header>
    <div style={{ flex: 1, minHeight: 0 }}><ChessScene key={sceneKey} board={choreography?.game.board() ?? g.board} selectedSquare={choreography ? null : g.selectedSquare} legalMoves={choreography ? [] : g.legalMoves} highlightedSquares={choreography?.feedback ? [choreography.from, choreography.to] : g.highlightedSquares} onSquareClick={g.handleSquareClick} onPieceDrop={g.handlePieceDrop} moveFeedback={choreography?.feedback ?? (choreography ? null : g.lastMoveFeedback)} flipped={flipped}/></div>
  </div>;
}
if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!);
  root.render(<ArenaThemeProvider><Fixture/></ArenaThemeProvider>);
  import.meta.hot?.dispose(() => root.unmount());
}
