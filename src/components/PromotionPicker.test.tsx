import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PromotionPicker from './PromotionPicker';

describe('PromotionPicker', () => {
  it('submits the chosen promotion piece', () => {
    const onSelect = vi.fn();

    render(<PromotionPicker color="w" onCancel={vi.fn()} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /knight/i }));

    expect(onSelect).toHaveBeenCalledWith('n');
  });

  it('allows cancelling before a promotion is committed', () => {
    const onCancel = vi.fn();

    render(<PromotionPicker color="b" onCancel={onCancel} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
