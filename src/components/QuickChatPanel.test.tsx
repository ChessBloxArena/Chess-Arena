import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import QuickChatPanel from './QuickChatPanel';

vi.mock('@/lib/sounds', () => ({
  playMenuClick: vi.fn(),
}));

describe('QuickChatPanel', () => {
  it('opens chat and sends typed messages', async () => {
    const onSend = vi.fn().mockResolvedValue(true);

    render(<QuickChatPanel messages={[]} status="ready" onSend={onSend} />);

    fireEvent.click(screen.getByRole('button', { name: /CHAT/i }));
    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'Good luck!' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Send chat message/i }));

    expect(screen.getByText('NO MESSAGES YET')).toBeInTheDocument();
    expect(onSend).toHaveBeenCalledWith('Good luck!');
    await waitFor(() => expect(screen.getByLabelText('Chat message')).toHaveValue(''));
  });
});
