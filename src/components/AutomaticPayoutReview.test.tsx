import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomaticPayoutReview } from './AutomaticPayoutReview';
const mocks = vi.hoisted(() => ({ getQuote: vi.fn(), hasSession: vi.fn(), consent: vi.fn() }));
vi.mock('@/lib/automaticRblx', () => ({ requestAutomaticPayoutQuote: mocks.getQuote, hasAutomaticQuoteSession: mocks.hasSession }));
vi.mock('@/lib/playConsent', () => ({ readPlayConsent: mocks.consent }));
const quote = { version:1, chainId:4663, escrowAddress:`0x${'1'.repeat(40)}`, walletAddress:`0x${'2'.repeat(40)}`, stakeWei:'25000000000000000', minimumRblxOut:'2900000000000000000', quotedRblxOut:'3000000000000000000', expiresAt:'2030-01-01T00:00:00Z', fallbackSeconds:900, token:'signed', payoutMode:'automatic_rblx' };
const props = () => ({ request:{ walletAddress:quote.walletAddress, stakeWei:25000000000000000n, signMessage:vi.fn() }, onComplete:vi.fn(), onCancel:vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.getQuote.mockResolvedValue(quote); mocks.hasSession.mockReturnValue(false); mocks.consent.mockReturnValue(null); });
afterEach(() => vi.useRealTimers());
describe('automatic prize review', () => {
  it('accepts one terms sheet, loads the quote, and still requires the specific match authorization', async () => {
    const input = props(); render(<AutomaticPayoutReview {...input}/>);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(mocks.getQuote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name:'Accept & continue'}));
    await screen.findByText('2.9 RBLX'); expect(screen.getByText(/within 15 minutes after settlement/)).toBeVisible();
    expect(input.onComplete).not.toHaveBeenCalled(); expect(mocks.getQuote).toHaveBeenCalledWith(input.request, true);
    fireEvent.click(screen.getByRole('button', {name:'Confirm 0.025 ETH & continue'}));
    expect(input.onComplete).toHaveBeenCalledWith({token:'signed', accepted:true, quote});
  });
  it('loads returning-wallet quotes without another terms sheet or wallet prompt', async () => {
    mocks.consent.mockReturnValue({version:'current'}); mocks.hasSession.mockReturnValue(true);
    const input = props(); render(<AutomaticPayoutReview {...input}/>);
    await screen.findByText('2.9 RBLX');
    expect(screen.queryByRole('button', {name:'Accept & continue'})).not.toBeInTheDocument();
    expect(mocks.getQuote).toHaveBeenCalledWith(input.request, false); expect(input.onComplete).not.toHaveBeenCalled();
  });
  it('does not automatically open a wallet when a returning quote session has expired', () => {
    mocks.consent.mockReturnValue({version:'current'}); const input = props(); render(<AutomaticPayoutReview {...input}/>);
    expect(mocks.getQuote).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name:'Connect quote session'})).toBeEnabled();
  });
  it('refreshes an expired quote without prompting and requires review of its changed minimum', async () => {
    vi.useFakeTimers(); mocks.consent.mockReturnValue({version:'current'}); mocks.hasSession.mockReturnValue(true);
    mocks.getQuote.mockResolvedValueOnce({...quote,expiresAt:new Date(Date.now()+1500).toISOString()}).mockResolvedValue({...quote,minimumRblxOut:'2800000000000000000'});
    const input = props(); render(<AutomaticPayoutReview {...input}/>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('2.8 RBLX')).toBeVisible(); expect(mocks.getQuote).toHaveBeenLastCalledWith(input.request, false);
    expect(input.onComplete).not.toHaveBeenCalled();
  });
  it('blocks an expired quote and cancels without a deposit', async () => {
    mocks.getQuote.mockResolvedValue({...quote,expiresAt:'2020-01-01'}); const input = props(); render(<AutomaticPayoutReview {...input}/>);
    fireEvent.click(screen.getByRole('button', {name:'Accept & continue'})); await screen.findByText(/Quote expired/);
    expect(screen.getByRole('button', {name:'Confirm 0.025 ETH & continue'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name:'Cancel'})); expect(input.onCancel).toHaveBeenCalledOnce(); expect(input.onComplete).not.toHaveBeenCalled();
  });
  it('keeps unavailable quotes recoverable without authorizing a match', async () => {
    mocks.getQuote.mockRejectedValue(new Error('No route available')); const input = props(); render(<AutomaticPayoutReview {...input}/>);
    fireEvent.click(screen.getByRole('button', {name:'Accept & continue'})); await screen.findByRole('alert');
    expect(screen.getByRole('button', {name:'Try quote again'})).toBeEnabled(); expect(input.onComplete).not.toHaveBeenCalled();
  });
  it('does not silently switch an automatic prize to an ETH deposit', async () => {
    mocks.getQuote.mockResolvedValue(null); const input = props(); render(<AutomaticPayoutReview {...input}/>);
    fireEvent.click(screen.getByRole('button', {name:'Accept & continue'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Automatic payouts are unavailable');
    expect(input.onComplete).not.toHaveBeenCalled();
  });

});
