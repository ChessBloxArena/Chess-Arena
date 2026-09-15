import { translateText, localize, useLanguage } from '@/lib/i18n';
import PlayTermsText from './PlayTermsText';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { readPlayConsent } from '@/lib/playConsent';
import { formatEther, formatUnits } from 'viem';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { hasAutomaticQuoteSession, requestAutomaticPayoutQuote, type AutomaticPayoutQuote, type PayoutAuthorization, type PayoutReviewRequest } from '@/lib/automaticRblx';

type Review = (request: PayoutReviewRequest) => Promise<PayoutAuthorization | undefined>;
const ReviewContext = createContext<Review | null>(null);
export function useAutomaticPayoutReview(): Review {
  const review = useContext(ReviewContext);
  return useCallback(request => {
    if (!review) return Promise.reject(new Error('Payout review is not available. Reload the website.'));
    return review(request);
  }, [review]);
}

export function AutomaticPayoutReviewProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const [request, setRequest] = useState<PayoutReviewRequest | null>(null);
  const pending = useRef<{ resolve: (value: PayoutAuthorization | undefined) => void; reject: (error: Error) => void } | null>(null);
  const review = useCallback<Review>(request => new Promise((resolve, reject) => {
    if (pending.current) { reject(new Error('Finish the current payout review first.')); return; }
    pending.current = { resolve, reject }; setRequest(request);
  }), []);
  const finish = (authorization?: PayoutAuthorization, cancelled = false) => {
    if (cancelled) pending.current?.reject(new Error('Payout review cancelled. No deposit was requested.'));
    else pending.current?.resolve(authorization);
    pending.current = null; setRequest(null);
  };
  useEffect(() => () => { pending.current?.reject(new Error('Payout review closed.')); pending.current = null; }, []);
  return <ReviewContext.Provider value={review}>{localize(children)}{localize(request && <AutomaticPayoutReview request={request} onComplete={finish} onCancel={() => finish(undefined, true)} />)}</ReviewContext.Provider>;
}

export function AutomaticPayoutReview({ request, onComplete, onCancel, loadQuote = requestAutomaticPayoutQuote }: {
  request: PayoutReviewRequest; onComplete: (authorization?: PayoutAuthorization) => void; onCancel: () => void;
  loadQuote?: typeof requestAutomaticPayoutQuote;
}) {
  useLanguage();
  const [accepted, setAccepted] = useState(() => !!readPlayConsent(request.walletAddress));
  const [showTerms, setShowTerms] = useState(() => !readPlayConsent(request.walletAddress));
  const [quote, setQuote] = useState<AutomaticPayoutQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const active = useRef(true);
  const loading = useRef(false);
  const refreshRef = useRef<(prompt: boolean) => Promise<void>>();
  const expired = !quote || Date.parse(quote.expiresAt) <= now;
  const fetchQuote = async (allowWalletPrompt = false) => {
    if (loading.current) return;
    loading.current = true; setBusy(true); setError(null);
    try {
      const result = await loadQuote(request, allowWalletPrompt);
      if (!active.current) return;
      if (!result) throw new Error('Automatic payouts are unavailable for this match. Return to setup to review its payout terms.');
      setQuote(result);
    } catch (error) {
      if (active.current) {
        setError(error instanceof Error ? error.message : 'Quote unavailable.');
        if (error && typeof error === 'object' && 'code' in error && error.code === 'play_terms_required') { setAccepted(false); setShowTerms(true); }
      }
    }
    finally { loading.current = false; if (active.current) setBusy(false); }
  };
  refreshRef.current = fetchQuote;
  useEffect(() => {
    active.current = true;
    if (readPlayConsent(request.walletAddress) && hasAutomaticQuoteSession(request.walletAddress)) void refreshRef.current?.(false);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active.current = false; clearInterval(timer); };
  }, [request.walletAddress]);
  useEffect(() => {
    if (quote && expired && !busy && !error && hasAutomaticQuoteSession(request.walletAddress)) void refreshRef.current?.(false);
  }, [quote, expired, busy, error, request.walletAddress]);
  const accept = () => { setAccepted(true); setShowTerms(false); void fetchQuote(true); };
  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="play-review max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <div className="play-review-icon"><ShieldCheck size={27}/></div>
      <DialogTitle>{localize(showTerms ? 'One sheet. Then your next move.' : 'Your match. Your prize.')}</DialogTitle>
      <DialogDescription>{localize(showTerms ? 'Read this once for your wallet. We will ask again when these terms change.' : 'Review this match before approving the deposit in your wallet.')}</DialogDescription>
      {localize(showTerms ? <div className="play-review-body">
        <PlayTermsText/>
        <button className="sky-play" onClick={accept}>{translateText("Accept & continue ")}<Check size={18}/></button>
      </div> : <div className="play-review-body">
        <div className="play-review-amounts"><div><span>{translateText("Your stake")}</span><strong>{localize(formatEther(request.stakeWei))}{translateText(" ETH")}</strong></div><div><span>{translateText("Winner’s pot")}</span><strong>{localize(formatEther(request.stakeWei * 2n))}{translateText(" ETH")}</strong></div></div>
        {localize(quote && <section aria-label={translateText("Automatic payout quote")} className="play-review-quote">
          <span>{translateText("Estimated prize now")}</span><strong>{localize(formatUnits(BigInt(quote.quotedRblxOut), 18))}{translateText(" RBLX")}</strong>
          <span>{translateText("Minimum RBLX you authorize")}</span><strong>{localize(formatUnits(BigInt(quote.minimumRblxOut), 18))}{translateText(" RBLX")}</strong>
          <p>{translateText("This minimum stays fixed for this match. The exchange rate when you win determines the final amount.")}</p>
          <p>{translateText("If conversion cannot meet this minimum within 15 minutes after settlement, your full ")}<b>{localize(formatEther(request.stakeWei * 2n))}{translateText(" ETH")}</b>{translateText(" prize is paid instead. You can also claim that ETH yourself after the wait.")}</p>
          <p className="break-all">{translateText("Receiving wallet: ")}{localize(quote.walletAddress)}</p>
          <p role="status">{localize(expired ? 'Quote expired. Updating before you authorize.' : `Fresh quote · valid for ${Math.max(0, Math.ceil((Date.parse(quote.expiresAt) - now) / 1000))}s. Review the amounts above.`)}</p>
        </section>)}
        {localize(busy && <p role="status">{translateText("Getting your prize quote…")}</p>)}
        {localize(error && <p role="alert" className="sky-error">{localize(error)}</p>)}
        {localize((!quote || error) && !busy && <button className="sky-play" onClick={() => void fetchQuote(true)}>{localize(error ? 'Try quote again' : 'Connect quote session')}</button>)}
        {localize(quote && <button className="sky-play" disabled={busy || expired || !accepted || !!error} onClick={() => { if (Date.parse(quote.expiresAt) <= Date.now()) { setNow(Date.now()); return; } onComplete({ token: quote.token, accepted: true, quote }); }}>{translateText("Confirm ")}{localize(formatEther(request.stakeWei))}{translateText(" ETH & continue")}</button>)}
        <button className="sky-text-button" onClick={() => setShowTerms(true)}>{translateText("Review accepted terms")}</button>
      </div>)}
      <p className="play-review-attribution">{translateText("Powered by Uniswap Labs · Robinhood Stock Tokens")}</p>
      <button className="sky-text-button" onClick={onCancel}>{translateText("Cancel")}</button>
    </DialogContent>
  </Dialog>;
}
