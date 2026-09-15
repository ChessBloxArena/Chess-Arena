import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { translateText, useLanguage } from '@/lib/i18n';

/** Public launch-token metadata only; never infer this from a wallet or wager escrow. */
export default function LaunchContractAddress() {
  useLanguage();
  const address = String(import.meta.env.VITE_LAUNCH_CONTRACT_ADDRESS ?? '').trim();
  const symbol = String(import.meta.env.VITE_LAUNCH_TOKEN_SYMBOL ?? '').trim();
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');

  async function copyAddress() {
    if (!address) return;
    setState('copying');
    try {
      await navigator.clipboard.writeText(address);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return <section className="launch-contract" aria-label={translateText('Launch contract address')}>
    <div className="launch-contract-heading">
      <span>{translateText('Token contract · CA')}</span>
      {symbol && <span>{symbol}</span>}
    </div>
    <div className="launch-contract-row">
      {address
        ? <code dir="ltr">{address}</code>
        : <span className="launch-contract-pending">{translateText('Address coming soon')}</span>}
      <button type="button" onClick={() => void copyAddress()} disabled={!address || state === 'copying'} aria-label={translateText('Copy launch contract address')}>
        {state === 'copied' ? <Check size={15} aria-hidden="true"/> : <Copy size={15} aria-hidden="true"/>}
        <span>{translateText(state === 'copied' ? 'Copied' : 'Copy')}</span>
      </button>
    </div>
    <p className="launch-contract-status" role="status">
      {translateText(state === 'failed' ? 'Copy unavailable. Select the address to copy it manually.' : state === 'copied' ? 'CA copied to clipboard' : '')}
    </p>
  </section>;
}
