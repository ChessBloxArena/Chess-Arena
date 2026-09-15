import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LaunchContractAddress from './LaunchContractAddress';

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Launch contract address', () => {
  it('shows a non-copyable pending state with no default token address', () => {
    vi.stubEnv('VITE_LAUNCH_CONTRACT_ADDRESS', '');
    render(<LaunchContractAddress />);
    expect(screen.getByText('Address coming soon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy launch contract address' })).toBeDisabled();
  });

  it('copies the complete configured address without changing its case', async () => {
    const address = '0x1234567890abcdef1234567890ABCDEF12345678';
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubEnv('VITE_LAUNCH_CONTRACT_ADDRESS', ` ${address} `);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<LaunchContractAddress />);
    expect(screen.getByText(address)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy launch contract address' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('CA copied to clipboard'));
    expect(writeText).toHaveBeenCalledWith(address);
  });

  it('keeps the address available for manual copying when clipboard access fails', async () => {
    const address = '0x1234567890abcdef1234567890ABCDEF12345678';
    vi.stubEnv('VITE_LAUNCH_CONTRACT_ADDRESS', address);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    render(<LaunchContractAddress />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy launch contract address' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Select the address to copy it manually'));
    expect(screen.getByText(address)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy launch contract address' })).toBeEnabled();
  });
});
