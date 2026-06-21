import { describe, expect, it } from 'vitest';
import { Chess, type Square } from 'chess.js';
import { getCaptureTargets } from './courtHighlights';

function targets(game: Chess, square: Square) {
  const pieces=game.board().flat().filter(piece=>piece!==null);
  const legal=game.moves({square,verbose:true}).map(move=>move.to);
  return getCaptureTargets(pieces,square,legal);
}

describe('Capture highlight semantics',()=>{
  it('distinguishes a pawn capture from a quiet forward move',()=>{
    const game=new Chess(); game.move('e4'); game.move('d5');
    expect(targets(game,'e4')).toEqual(['d5']);
  });
  it('marks an empty en-passant destination as a capture for either team',()=>{
    const white=new Chess(); for(const move of ['e4','a6','e5','d5']) white.move(move);
    expect(targets(white,'e5')).toContain('d6');
    const black=new Chess(); for(const move of ['a3','e5','a4','e4','d4']) black.move(move);
    expect(targets(black,'e4')).toContain('d3');
  });
  it('does not mark quiet diagonal moves or a cleared selection as captures',()=>{
    const game=new Chess(); game.move('e4');game.move('e5');
    expect(targets(game,'f1')).toEqual([]);
    expect(getCaptureTargets([],null,['e4'])).toEqual([]);
  });
});
