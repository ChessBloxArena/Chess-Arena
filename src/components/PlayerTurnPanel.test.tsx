import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlayerTurnPanel, { type PlayerTurnSeat } from './PlayerTurnPanel';

describe('PlayerTurnPanel', () => {
  it('shows the active turn and both players', () => {
    const seats: [PlayerTurnSeat, PlayerTurnSeat] = [
      {
        color: 'w',
        name: 'Ada',
        label: 'YOU',
        active: true,
        tone: 'local',
      },
      {
        color: 'b',
        name: 'IVAN',
        label: 'CPU HARD',
        active: false,
        tone: 'cpu',
      },
    ];

    render(<PlayerTurnPanel seats={seats} status="ADA TO MOVE" />);

    expect(screen.getByLabelText('Player turn status')).toBeInTheDocument();
    expect(screen.getByText('ADA TO MOVE')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('IVAN')).toBeInTheDocument();
    expect(screen.getByText('WHITE TO MOVE')).toBeInTheDocument();
  });
});
