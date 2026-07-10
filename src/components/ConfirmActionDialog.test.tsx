import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfirmActionDialog from './ConfirmActionDialog';

describe('ConfirmActionDialog', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <ConfirmActionDialog
        open={false}
        title="SURRENDER MATCH?"
        message="Ends the game."
        confirmLabel="SURRENDER"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('dispatches confirm and cancel actions', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmActionDialog
        open
        title="SURRENDER MATCH?"
        message="Ends the game."
        confirmLabel="SURRENDER"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'SURRENDER MATCH?' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'SURRENDER' }));
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
