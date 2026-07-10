import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConnectionStatusPanel from './ConnectionStatusPanel';

describe('ConnectionStatusPanel', () => {
  it('stays hidden while game sync and chat are healthy', () => {
    const { container } = render(<ConnectionStatusPanel gameStatus="online" chatStatus="ready" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows reconnecting game state', () => {
    const onRetry = vi.fn();
    render(
      <ConnectionStatusPanel
        gameStatus="reconnecting"
        chatStatus="ready"
        message="Could not reach referee. Retrying..."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('RECONNECTING')).toBeInTheDocument();
    expect(screen.getByText('Could not reach referee. Retrying...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows quick chat link issues independently', () => {
    render(<ConnectionStatusPanel gameStatus="online" chatStatus="connecting" />);

    expect(screen.getByText('CHAT LINKING')).toBeInTheDocument();
  });
});
