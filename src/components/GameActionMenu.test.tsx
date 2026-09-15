import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameActionMenu from './GameActionMenu';

afterEach(cleanup);
const props = { musicOn: true, sfxOn: true, onMusic: vi.fn(), onSfx: vi.fn(), onSurrender: vi.fn(), surrenderDisabled: false };

describe('match options menu', () => {
  it('opens after a completed click and stays open through game updates', () => {
    const { rerender } = render(<GameActionMenu {...props} />);
    const trigger = screen.getByRole('button', { name: 'Match options' });
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.pointerUp(trigger, { button: 0, pointerType: 'mouse' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeVisible();
    rerender(<GameActionMenu {...props} musicOn={false} />);
    expect(screen.getByRole('menu')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes after choosing an action and retains keyboard opening', () => {
    render(<GameActionMenu {...props} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Match options' }), { key: 'Enter' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Music on' }));
    expect(props.onMusic).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
