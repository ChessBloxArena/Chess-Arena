import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaThemeProvider } from './ArenaThemeProvider';
import ThemeSelector from './ThemeSelector';

vi.mock('@/lib/sounds', () => ({
  playMenuClick: vi.fn(),
}));

const testLocalStorage = (() => {
  let store: Record<string, string> = {};

  return {
    clear: () => {
      store = {};
    },
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
})();

describe('ThemeSelector', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: testLocalStorage,
    });
    localStorage.clear();
    document.documentElement.removeAttribute('data-arena-theme');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-arena-theme');
  });

  it('shows selectable themes by default', async () => {
    render(
      <ArenaThemeProvider>
        <ThemeSelector />
      </ArenaThemeProvider>,
    );

    expect(screen.getByRole('button', { name: /INFERNO/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.dataset.arenaTheme).toBe('arcade');
    });
  });

  it('updates the active arena theme', async () => {
    render(
      <ArenaThemeProvider>
        <ThemeSelector />
      </ArenaThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /INFERNO/i }));

    await waitFor(() => {
      expect(document.documentElement.dataset.arenaTheme).toBe('inferno');
    });
    expect(screen.getByRole('button', { name: /INFERNO/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
