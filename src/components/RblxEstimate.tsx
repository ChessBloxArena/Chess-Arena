import { translateText, localize, useLanguage } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import { hasAutomaticQuoteSession, requestAutomaticPayoutQuote, type AutomaticPayoutQuote, type PayoutReviewRequest } from '@/lib/automaticRblx';

export default function RblxEstimate({ request }: { request: PayoutReviewRequest }) {
  useLanguage();
  const { walletAddress, stakeWei, gameId, signMessage } = request;
  const [quote, setQuote] = useState<AutomaticPayoutQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let nextRefresh = 0;
    setQuote(null); setError(null);
    const refresh = async () => {
      setNow(Date.now());
      if (loading || Date.now() < nextRefresh || !hasAutomaticQuoteSession(walletAddress) || document.visibilityState === 'hidden') return;
      loading = true;
      try {
        const result = await requestAutomaticPayoutQuote({ walletAddress, stakeWei, gameId, signMessage }, false);
        if (cancelled) return;
        setQuote(result); setError(null);
        nextRefresh = result ? Math.max(Date.now() + 15_000, Date.parse(result.expiresAt) - 5000) : Infinity;
      } catch (e) {
        if (!cancelled) { setQuote(null); setError(e instanceof Error ? e.message : 'Estimate unavailable.'); }
        nextRefresh = Date.now() + 30_000;
      } finally { loading = false; }
    };
    const debounce = setTimeout(() => void refresh(), 350);
    const timer = setInterval(() => void refresh(), 1000);
    return () => { cancelled = true; clearTimeout(debounce); clearInterval(timer); };
  }, [walletAddress, stakeWei, gameId, signMessage]);
  if (!quote || Date.parse(quote.expiresAt) <= now) return <div className="sky-inline-quote"><small>{localize(error || 'Your RBLX quote appears after the first payout setup.')}</small></div>;
  return <RblxEstimateValue quote={quote}/>;
}

export function RblxEstimateValue({ quote }: { quote: AutomaticPayoutQuote }) {
  useLanguage();
  return <div className="sky-inline-quote" aria-label={translateText("Estimated RBLX prize")}><div><span>{translateText("Estimated prize")}</span><strong>{localize(Number(formatUnits(BigInt(quote.quotedRblxOut), 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }))}{translateText(" RBLX")}</strong></div><small>{translateText("Minimum ")}{localize(formatUnits(BigInt(quote.minimumRblxOut), 18))}{translateText(" RBLX")}</small><small>{translateText("Stock Tokens · Powered by Uniswap Labs")}</small></div>;
}
