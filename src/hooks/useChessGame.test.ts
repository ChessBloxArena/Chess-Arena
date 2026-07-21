import { act, renderHook } from '@testing-library/react';
import { Square } from 'chess.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChessGame } from './useChessGame';

vi.mock('@/lib/sounds', () => ({
  playMoveSound: vi.fn(),
  playCaptureSound: vi.fn(),
  playCheckSound: vi.fn(),
  playGameOverSound: vi.fn(),
  playIllegalMoveSound: vi.fn(),
}));

describe('useChessGame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules and completes a CPU reply after a player move', () => {
    const { result } = renderHook(() => useChessGame('cpu', 'hard'));

    act(() => {
      result.current.handleSquareClick('e2' as Square);
    });

    act(() => {
      result.current.handleSquareClick('e4' as Square);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.highlightedSquares).toEqual(['e2', 'e4']);
    expect(result.current.lastMoveFeedback).toMatchObject({
      from: 'e2',
      to: 'e4',
      san: 'e4',
      tone: 'move',
      isCapture: false,
    });
    expect(result.current.currentTurn).toBe('b');
    expect(result.current.cpuThinking).toBe(true);

    act(() => { vi.advanceTimersByTime(880); });
    expect(result.current.history).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(301); });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.gameInstance.get('c5')).toEqual({ color: 'b', type: 'p' });
    expect(result.current.gameInstance.get('c7')).toBeUndefined();
    expect(result.current.highlightedSquares).toEqual(['c7', 'c5']);
    expect(result.current.lastMoveFeedback).toMatchObject({
      from: 'c7',
      to: 'c5',
      san: 'c5',
      tone: 'move',
    });
    expect(result.current.currentTurn).toBe('w');
    expect(result.current.cpuThinking).toBe(false);
  });

  it('undoes the player move and CPU reply after a completed two-ply turn', () => {
    const { result } = renderHook(() => useChessGame('cpu', 'hard'));

    act(() => {
      result.current.handleSquareClick('e2' as Square);
    });

    act(() => {
      result.current.handleSquareClick('e4' as Square);
    });

    act(() => {
      vi.advanceTimersByTime(1851);
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.currentTurn).toBe('w');

    act(() => {
      result.current.undo();
    });

    expect(result.current.history).toHaveLength(0);
    expect(result.current.gameInstance.get('e2')).toEqual({ color: 'w', type: 'p' });
    expect(result.current.gameInstance.get('e4')).toBeUndefined();
    expect(result.current.gameInstance.get('c7')).toEqual({ color: 'b', type: 'p' });
    expect(result.current.gameInstance.get('c5')).toBeUndefined();
    expect(result.current.highlightedSquares).toEqual([]);
    expect(result.current.currentTurn).toBe('w');
    expect(result.current.cpuThinking).toBe(false);
  });

  it('keeps the selected piece active and reports illegal target clicks', () => {
    const { result } = renderHook(() => useChessGame('pvp', 'medium'));

    act(() => {
      result.current.handleSquareClick('e2' as Square);
    });

    expect(result.current.selectedSquare).toBe('e2');
    expect(result.current.legalMoves).toEqual(expect.arrayContaining(['e3', 'e4']));

    act(() => {
      result.current.handleSquareClick('e5' as Square);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.selectedSquare).toBe('e2');
    expect(result.current.legalMoves).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(result.current.invalidMoveFeedback).toMatchObject({
      square: 'e5',
      message: 'THAT PIECE CANNOT MOVE THERE',
    });
    expect(result.current.flavorText).toBe('THAT PIECE CANNOT MOVE THERE');

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(result.current.invalidMoveFeedback).toBeNull();
    expect(result.current.selectedSquare).toBe('e2');
  });

  it('moves a dragged piece when dropped on a legal square', () => {
    const { result } = renderHook(() => useChessGame('pvp', 'medium'));

    act(() => {
      result.current.handlePieceDrop('e2' as Square, 'e4' as Square);
    });

    expect(result.current.history).toEqual(['e4']);
    expect(result.current.gameInstance.get('e4')).toEqual({ color: 'w', type: 'p' });
    expect(result.current.gameInstance.get('e2')).toBeUndefined();
    expect(result.current.highlightedSquares).toEqual(['e2', 'e4']);
    expect(result.current.selectedSquare).toBeNull();
    expect(result.current.legalMoves).toEqual([]);
  });

  it('snaps a dragged piece back and keeps legal targets visible after an illegal drop', () => {
    const { result } = renderHook(() => useChessGame('pvp', 'medium'));

    act(() => {
      result.current.handlePieceDrop('e2' as Square, 'e5' as Square);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.gameInstance.get('e2')).toEqual({ color: 'w', type: 'p' });
    expect(result.current.gameInstance.get('e5')).toBeUndefined();
    expect(result.current.selectedSquare).toBe('e2');
    expect(result.current.legalMoves).toEqual(expect.arrayContaining(['e3', 'e4']));
    expect(result.current.invalidMoveFeedback).toMatchObject({
      square: 'e5',
      message: 'THAT PIECE CANNOT MOVE THERE',
    });

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(result.current.invalidMoveFeedback).toBeNull();
    expect(result.current.selectedSquare).toBe('e2');
  });

  it('cancels a pending CPU reply when undoing during CPU thinking', () => {
    const { result } = renderHook(() => useChessGame('cpu', 'easy'));

    act(() => {
      result.current.handleSquareClick('g1' as Square);
    });

    act(() => {
      result.current.handleSquareClick('f3' as Square);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.cpuThinking).toBe(true);

    act(() => {
      result.current.undo();
    });

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(result.current.history).toHaveLength(0);
    expect(result.current.highlightedSquares).toEqual([]);
    expect(result.current.currentTurn).toBe('w');
    expect(result.current.cpuThinking).toBe(false);
  });

  it('cancels a pending CPU reply when resetting during CPU thinking', () => {
    const { result } = renderHook(() => useChessGame('cpu', 'hard'));

    act(() => {
      result.current.handleSquareClick('e2' as Square);
    });

    act(() => {
      result.current.handleSquareClick('e4' as Square);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.currentTurn).toBe('b');
    expect(result.current.cpuThinking).toBe(true);

    act(() => {
      result.current.reset();
    });

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(result.current.history).toHaveLength(0);
    expect(result.current.gameInstance.get('e2')).toEqual({ color: 'w', type: 'p' });
    expect(result.current.gameInstance.get('e4')).toBeUndefined();
    expect(result.current.gameInstance.get('c7')).toEqual({ color: 'b', type: 'p' });
    expect(result.current.gameInstance.get('c5')).toBeUndefined();
    expect(result.current.highlightedSquares).toEqual([]);
    expect(result.current.currentTurn).toBe('w');
    expect(result.current.cpuThinking).toBe(false);
    expect(result.current.statusMessage).toBe('The battle begins...');
    expect(result.current.flavorText).toBe('A new game dawns...');
  });

  it('waits for a selected piece before completing pawn promotion', () => {
    const { result } = renderHook(() => useChessGame('pvp', 'hard'));

    act(() => {
      result.current.gameInstance.load('8/P7/8/8/8/8/8/k6K w - - 0 1');
      result.current.handleSquareClick('a7' as Square);
    });

    expect(result.current.selectedSquare).toBe('a7');
    expect(result.current.legalMoves).toContain('a8');

    act(() => {
      result.current.handleSquareClick('a8' as Square);
    });

    expect(result.current.pendingPromotion).toEqual({
      from: 'a7',
      to: 'a8',
      color: 'w',
    });
    expect(result.current.history).toEqual([]);
    expect(result.current.selectedSquare).toBeNull();

    act(() => {
      result.current.choosePromotion('n');
    });

    expect(result.current.pendingPromotion).toBeNull();
    expect(result.current.gameInstance.get('a8')).toEqual({ color: 'w', type: 'n' });
    expect(result.current.gameInstance.get('a7')).toBeUndefined();
    expect(result.current.history).toEqual(['a8=N']);
    expect(result.current.lastMoveFeedback).toMatchObject({
      from: 'a7',
      to: 'a8',
      san: 'a8=N',
      promotion: 'n',
      isPromotion: true,
    });
    expect(result.current.currentTurn).toBe('b');
  });
});
