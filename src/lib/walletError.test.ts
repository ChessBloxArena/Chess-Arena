import { describe, expect, it } from 'vitest';
import { walletErrorMessage } from './walletError';

describe('wallet error copy', () => {
  it.each(['HTTP request failed. URL: https://rpc.example Request body: {}', 'Too Many Requests (429)', 'Failed to fetch'])('replaces network diagnostics with recovery guidance: %s', (message) => {
    expect(walletErrorMessage(new Error(message))).toBe('The network is temporarily unavailable. Refresh your balance. If you already sent a transaction, check My funds before trying again.');
  });
  it('preserves actionable application and uncertain-submission messages', () => {
    expect(walletErrorMessage(new Error('Previous submission uncertain; manual reconciliation required'))).toBe('Previous submission uncertain; manual reconciliation required');
    expect(walletErrorMessage('Insufficient balance for stake and gas.')).toBe('Insufficient balance for stake and gas.');
  });
  it('keeps rejection separate from connectivity', () => {
    expect(walletErrorMessage(new Error('User rejected the request.\nRequest Arguments: ...'))).toBe('Wallet request rejected.');
  });
});
