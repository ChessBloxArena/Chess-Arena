import { describe, expect, it } from 'vitest';
import { BOARD_SQUARE_SIZE, BOARD_HALF_SIZE, pointToBoardSquare, squareToBoardPosition } from './boardCoordinates';

const scaledPoint = ({ x, z }: { x: number; z: number }) => pointToBoardSquare({ x: x * BOARD_SQUARE_SIZE, z: z * BOARD_SQUARE_SIZE });

describe('board coordinate mapping', () => {
  it('maps square centers to board positions', () => {
    expect(squareToBoardPosition('a1')).toEqual([-3.5 * BOARD_SQUARE_SIZE, 0, 3.5 * BOARD_SQUARE_SIZE]);
    expect(squareToBoardPosition('h8')).toEqual([3.5 * BOARD_SQUARE_SIZE, 0, -3.5 * BOARD_SQUARE_SIZE]);
    expect(squareToBoardPosition('e4')).toEqual([.5 * BOARD_SQUARE_SIZE, 0, .5 * BOARD_SQUARE_SIZE]);
  });

  it('maps board hit points to the hovered chess square', () => {
    expect(scaledPoint({ x: -3.5, z: 3.5 })).toBe('a1');
    expect(scaledPoint({ x: 3.49, z: -3.49 })).toBe('h8');
    expect(scaledPoint({ x: 0.5, z: 0.5 })).toBe('e4');
    expect(scaledPoint({ x: -0.5, z: 0.5 })).toBe('d4');
    expect(scaledPoint({ x: 0, z: 0 })).toBe('e5');
  });

  it('round trips all 64 squares on the expanded board', () => {
    for (let file = 0; file < 8; file++) for (let rank = 1; rank <= 8; rank++) {
      const square = `${String.fromCharCode(97 + file)}${rank}`;
      const [x, , z] = squareToBoardPosition(square);
      expect(pointToBoardSquare({ x, z })).toBe(square);
    }
    expect(pointToBoardSquare({ x: BOARD_HALF_SIZE, z: 0 })).toBeNull();
  });

  it('rejects points outside the playable board', () => {
    expect(scaledPoint({ x: -4.01, z: 0 })).toBeNull();
    expect(scaledPoint({ x: 4, z: 0 })).toBeNull();
    expect(scaledPoint({ x: 0, z: -4.01 })).toBeNull();
    expect(scaledPoint({ x: 0, z: 4.01 })).toBeNull();
  });
});
