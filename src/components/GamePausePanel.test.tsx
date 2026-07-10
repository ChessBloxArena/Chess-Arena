import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import GamePausePanel from './GamePausePanel';

describe('GamePausePanel', () => {
  it('renders match state and dispatches commands', () => {
    const onClose = vi.fn();
    const onNewGame = vi.fn();
    const onToggleMusic = vi.fn();

    render(
      <GamePausePanel
        open
        title="VS IVAN"
        subtitle="HARD"
        status="WHITE'S TURN"
        moves={12}
        musicOn
        sfxOn={false}
        onClose={onClose}
        onMenu={vi.fn()}
        onToggleMusic={onToggleMusic}
        onToggleSfx={vi.fn()}
        onNewGame={onNewGame}
      />,
    );

    expect(screen.getByText('VS IVAN')).toBeInTheDocument();
    expect(screen.getByText("WHITE'S TURN")).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'RESUME' }));
    fireEvent.click(screen.getByRole('button', { name: 'NEW GAME' }));
    fireEvent.click(screen.getByRole('button', { name: 'MUSIC ON' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNewGame).toHaveBeenCalledTimes(1);
    expect(onToggleMusic).toHaveBeenCalledTimes(1);
  });
});
