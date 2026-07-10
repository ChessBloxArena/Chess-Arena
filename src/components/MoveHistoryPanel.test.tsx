import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MoveHistoryPanel from './MoveHistoryPanel';

describe('MoveHistoryPanel', () => {
  it('groups moves by turn number', () => {
    render(<MoveHistoryPanel history={['e4', 'e5', 'Nf3']} />);

    expect(screen.getByText('e4')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', {name:'MOVE LOG 3'}));
    expect(screen.getByText('e4')).toBeVisible();
    expect(screen.getByText('MOVE LOG')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('e4')).toBeInTheDocument();
    expect(screen.getByText('e5')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('Nf3')).toBeInTheDocument();
    expect(screen.getByText('WAITING...')).toBeInTheDocument();
  });

  it('explains structured moves in plain language', () => {
    render(
      <MoveHistoryPanel
        history={['e4', 'Nf6']}
        moves={[
          { san: 'e4', from: 'e2', to: 'e4', piece: 'p' },
          { san: 'Nf6', from: 'g8', to: 'f6', piece: 'n' },
        ]}
      />,
    );

    expect(screen.getByText('Pawn E2 to E4')).toBeInTheDocument();
    expect(screen.getByText('Knight G8 to F6')).toBeInTheDocument();
  });

  it('shows an empty state before any moves are played', () => {
    render(<MoveHistoryPanel history={[]} />);

    expect(screen.getByText('MAKE THE FIRST MOVE')).toBeInTheDocument();
  });
});
