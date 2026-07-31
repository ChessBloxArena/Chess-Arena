import type { RblxEntryAuthorization } from '../../supabase/functions/pvp-referee/rblxAuthorization';
import { invokeWagerReferee, signWalletProof } from './wagerRefereeClient';
import { gameEscrowAddress } from './robinhoodChain';
import { PLAY_TERMS_VERSION, rememberPlayConsent } from './playConsent';

export interface AutomaticPayoutQuote extends RblxEntryAuthorization { token: string; payoutMode: 'automatic_rblx' }
export interface PayoutAuthorization { token: string; accepted: true; quote: AutomaticPayoutQuote }
export interface PayoutReviewRequest {
  walletAddress: string;
  stakeWei: bigint;
  gameId?: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}
const sessions = new Map<string, { token: string; expiresAt: string }>();
const SESSION_KEY = 'chessblox_quote_session_v1:';
export function hasAutomaticQuoteSession(walletAddress: string) {
  const walletKey = walletAddress.toLowerCase();
  if (!sessions.has(walletKey)) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY + walletKey) || 'null');
      if (saved?.version === PLAY_TERMS_VERSION && typeof saved.token === 'string') sessions.set(walletKey, saved);
    } catch { /* Continue without a cached read-only session. */ }
  }
  const session = sessions.get(walletKey);
  return !!session && Date.parse(session.expiresAt) > Date.now();
}
export async function requestAutomaticPayoutQuote(request: PayoutReviewRequest, allowWalletPrompt = true): Promise<AutomaticPayoutQuote | null> {
  const walletKey = request.walletAddress.toLowerCase();
  const session = hasAutomaticQuoteSession(walletKey) ? sessions.get(walletKey) : undefined;
  if (!session && !allowWalletPrompt) throw new Error('Connect a quote session to see your RBLX estimate.');
  const proof = session ? {} : await signWalletProof({ action: 'get_rblx_entry_quote', walletAddress: request.walletAddress, gameId: request.gameId, signMessage: request.signMessage });
  type Response = AutomaticPayoutQuote & { quoteSessionToken?: string; quoteSessionExpiresAt?: string; termsVersion?: string; termsAcceptedAt?: string };
  let quote: Response | { payoutMode: 'eth_claim' };
  try {
    quote = await invokeWagerReferee<Response | { payoutMode: 'eth_claim' }>({ action: 'get_rblx_entry_quote', walletAddress: request.walletAddress, gameId: request.gameId, stakeRaw: request.stakeWei.toString(), uniswapTermsAccepted: true, playTermsVersion: PLAY_TERMS_VERSION, stockTokenEligibilityAttested: true, quoteSessionToken: session?.token, ...proof });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['quote_session_expired', 'play_terms_required'].includes(String(error.code))) {
      sessions.delete(walletKey);
      try { sessionStorage.removeItem(SESSION_KEY + walletKey); } catch { /* Optional storage. */ }
    }
    throw error;
  }
  if (quote.payoutMode === 'eth_claim') return null;
  if (quote.version !== 1 || quote.chainId !== 4663 || quote.fallbackSeconds !== 900
    || quote.walletAddress?.toLowerCase() !== request.walletAddress.toLowerCase()
    || quote.stakeWei !== request.stakeWei.toString() || !quote.token
    || !/^[1-9][0-9]*$/.test(quote.minimumRblxOut) || !/^[1-9][0-9]*$/.test(quote.quotedRblxOut)
    || BigInt(quote.minimumRblxOut) > BigInt(quote.quotedRblxOut)
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) throw new Error('Invalid payout quote. No deposit was requested.');
  gameEscrowAddress(quote.escrowAddress, 'automatic_rblx');
  if (quote.quoteSessionToken && quote.quoteSessionExpiresAt) {
    const session = { token: quote.quoteSessionToken, expiresAt: quote.quoteSessionExpiresAt, version: PLAY_TERMS_VERSION };
    sessions.set(walletKey, session);
    try { sessionStorage.setItem(SESSION_KEY + walletKey, JSON.stringify(session)); } catch { /* Keep the in-memory session. */ }
  }
  if (quote.termsVersion && quote.termsAcceptedAt) rememberPlayConsent(walletKey, quote.termsVersion, quote.termsAcceptedAt);
  return quote;
}
