import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type ChessScene from '@/components/ChessScene';
import Game from './Game';
import { readLocalGameConfig } from '@/lib/localGameConfig';

const state = vi.hoisted(() => ({ scene: null as unknown, submit: vi.fn() }));
vi.mock('@/components/ChessScene', () => ({ default: (props: unknown) => { state.scene = props; return <div data-testid="board"/>; } }));
vi.mock('@/hooks/useSolanaWallet', () => ({ useSolanaWallet: () => ({ address: null }) }));
vi.mock('@/lib/cpuLeaderboard', () => ({ submitCpuResult: state.submit }));
vi.mock('@/lib/music', () => ({ startMusic: vi.fn(), stopMusic: vi.fn() }));
vi.mock('@/lib/sounds', () => ({ playMenuClick: vi.fn(), playTurnReadySound: vi.fn(), setSoundEnabled: vi.fn(), playMoveSound: vi.fn(), playCaptureSound: vi.fn(), playCheckSound: vi.fn(), playGameOverSound: vi.fn(), playInvalidSound: vi.fn(), playSelectSound: vi.fn() }));
vi.mock('@/components/ActionBanner', () => ({ default: () => null }));
vi.mock('@/components/MatchIntroOverlay', () => ({ default: () => null }));
vi.mock('@/components/MoveHistoryPanel', () => ({ default: () => null }));
const scene = () => state.scene as ComponentProps<typeof ChessScene>;
function play(from: string, to: string) {
  act(() => scene().onSquareClick(from as Parameters<ReturnType<typeof scene>['onSquareClick']>[0]));
  act(() => scene().onSquareClick(to as Parameters<ReturnType<typeof scene>['onSquareClick']>[0]));
}
function ready() { fireEvent.click(screen.getByRole('button', { name: 'Ready to play' })); }
function start(autoRotate = true) {
  render(<MemoryRouter initialEntries={[{ pathname: '/game', state: { mode: 'pvp', difficulty: 'medium', passAndPlay: true, autoRotate, playerName: '小白', secondPlayerName: 'Alex' } }]}><Game/></MemoryRouter>);
}
afterEach(() => { cleanup(); sessionStorage.clear(); state.submit.mockClear(); });

describe('Pass & Play local match', () => {
  it('gates turns, rotates the board, ends on mate, and swaps names on rematch', () => {
    start();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('小白');
    play('f2', 'f3');
    expect(scene().selectedSquare).toBeNull();
    ready(); play('f2', 'f3');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Alex');
    expect(scene().flipped).toBe(true);
    ready(); play('e7', 'e5');
    expect(scene().flipped).toBe(false);
    ready(); play('g2', 'g4');
    ready(); play('d8', 'h4');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Alex — WINS!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rematch · swap colors' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Alex');
    expect(scene().flipped).toBe(false);
    expect(readLocalGameConfig()).toMatchObject({ playerName: 'Alex', secondPlayerName: '小白', passAndPlay: true });
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('keeps a fixed view when rotation is off and hands back after undo', () => {
    start(false); ready(); play('e2', 'e4');
    expect(scene().flipped).toBe(false);
    ready(); fireEvent.click(screen.getByRole('button', { name: 'UNDO' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('小白');
    ready(); play('d2', 'd4');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Alex');
  });
});
