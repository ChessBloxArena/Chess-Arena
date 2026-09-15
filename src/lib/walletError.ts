/** User-facing copy only; this never changes transaction or retry behavior. */
export function walletErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/too many requests|\b429\b|HTTP request failed|failed to fetch|network request failed/i.test(message)) {
    return 'The network is temporarily unavailable. Refresh your balance. If you already sent a transaction, check My funds before trying again.';
  }
  if (/rejected|denied|4001/i.test(message)) return 'Wallet request rejected.';
  if (/No EVM wallet found|window\.ethereum.*undefined/i.test(message)) return 'Install an EVM wallet such as MetaMask or Rabby.';
  return message.split(/\n(?:Request Arguments:|Contract Call:|URL:|Docs:)/)[0].trim() || 'Unable to complete the request. Please try again.';
}
