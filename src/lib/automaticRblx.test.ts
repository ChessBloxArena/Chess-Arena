import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke:vi.fn(), proof:vi.fn(), remember:vi.fn() }));
vi.mock('./wagerRefereeClient', () => ({invokeWagerReferee:mocks.invoke,signWalletProof:mocks.proof}));
vi.mock('./robinhoodChain', () => ({gameEscrowAddress:vi.fn()}));
vi.mock('./playConsent', () => ({PLAY_TERMS_VERSION:'2026-09-08.1',rememberPlayConsent:mocks.remember}));
const request = {walletAddress:`0x${'2'.repeat(40)}`,stakeWei:25n,signMessage:vi.fn()};
const quote = {version:1,chainId:4663,escrowAddress:`0x${'1'.repeat(40)}`,walletAddress:request.walletAddress,stakeWei:'25',minimumRblxOut:'290',quotedRblxOut:'300',expiresAt:'2030-01-01T00:00:00Z',fallbackSeconds:900,token:'payout-token',payoutMode:'automatic_rblx',quoteSessionToken:'quote-only-token',quoteSessionExpiresAt:'2030-01-01T00:00:00Z',termsVersion:'2026-09-08.1',termsAcceptedAt:'2026-09-08T00:00:00Z'};
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  const saved = new Map<string,string>();
  vi.stubGlobal('sessionStorage', {getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)});
  mocks.proof.mockResolvedValue({walletSignature:'signed-proof'}); mocks.invoke.mockResolvedValue(quote);
});
describe('automatic quote refresh', () => {
  it('asks for one ownership proof then refreshes without another wallet request', async () => {
    const {requestAutomaticPayoutQuote} = await import('./automaticRblx');
    await requestAutomaticPayoutQuote(request);
    await requestAutomaticPayoutQuote(request,false);
    expect(mocks.proof).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith(expect.objectContaining({quoteSessionToken:'quote-only-token',stakeRaw:'25'}));
    expect(mocks.remember).toHaveBeenCalledWith(request.walletAddress,'2026-09-08.1',quote.termsAcceptedAt);
  });
  it('never opens the wallet from a background request without a session', async () => {
    const {requestAutomaticPayoutQuote} = await import('./automaticRblx');
    await expect(requestAutomaticPayoutQuote(request,false)).rejects.toThrow('Connect a quote session');
    expect(mocks.proof).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('clears a revoked session and leaves reconnecting to an explicit user action', async () => {
    const {requestAutomaticPayoutQuote} = await import('./automaticRblx');
    await requestAutomaticPayoutQuote(request);
    mocks.invoke.mockRejectedValueOnce(Object.assign(new Error('expired'),{code:'quote_session_expired'}));
    await expect(requestAutomaticPayoutQuote(request,false)).rejects.toThrow('expired');
    await expect(requestAutomaticPayoutQuote(request,false)).rejects.toThrow('Connect a quote session');
    expect(mocks.proof).toHaveBeenCalledTimes(1);
  });
  it('does not save consent or a quote session from a mismatched quote', async () => {
    const {requestAutomaticPayoutQuote,hasAutomaticQuoteSession} = await import('./automaticRblx');
    mocks.invoke.mockResolvedValue({...quote,stakeWei:'26'});
    await expect(requestAutomaticPayoutQuote(request)).rejects.toThrow('Invalid payout quote');
    expect(mocks.remember).not.toHaveBeenCalled(); expect(hasAutomaticQuoteSession(request.walletAddress)).toBe(false);
  });
});
