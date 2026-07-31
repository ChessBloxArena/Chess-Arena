// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PLAY_TERMS_VERSION, QUOTE_SESSION_TTL_MS, signQuoteSession, verifyQuoteSession, type QuoteSession } from '../../supabase/functions/pvp-referee/playConsent';
import { verifyRblxAuthorization } from '../../supabase/functions/pvp-referee/rblxAuthorization';
const now = Date.parse('2026-09-08T12:00:00Z');
const secret = 'only-a-local-test-secret-with-at-least-32-characters';
const session: QuoteSession = { purpose:'rblx_quote_only', version:PLAY_TERMS_VERSION, walletAddress:`0x${'2'.repeat(40)}`, sessionId:'browser-session', acceptedAt:new Date(now).toISOString(), expiresAt:new Date(now + QUOTE_SESSION_TTL_MS).toISOString() };
describe('read-only quote session', () => {
  it('authenticates a wallet in its original browser session', async () => {
    expect(await verifyQuoteSession(await signQuoteSession(session, secret), secret, session, now)).toEqual(session);
  });
  it.each(['walletAddress', 'sessionId'])('rejects a different %s', async field => {
    await expect(verifyQuoteSession(await signQuoteSession(session, secret), secret, {...session,[field]:'another'}, now)).rejects.toThrow();
  });
  it.each([{version:'old'}, {purpose:'deposit'}, {expiresAt:new Date(now).toISOString()}, {expiresAt:new Date(now + QUOTE_SESSION_TTL_MS + 1).toISOString()}])('rejects stale terms, wrong purpose and invalid expiry: %o', async patch => {
    await expect(verifyQuoteSession(await signQuoteSession({...session,...patch} as QuoteSession,secret),secret,session,now)).rejects.toThrow();
  });
  it('rejects forged signatures and cannot authorize a payout or deposit', async () => {
    const token = await signQuoteSession(session, secret);
    await expect(verifyQuoteSession(token, secret+'other', session, now)).rejects.toThrow();
    await expect(verifyRblxAuthorization(token,secret,{walletAddress:session.walletAddress,escrowAddress:`0x${'1'.repeat(40)}`,stakeWei:'100'},now)).rejects.toThrow();
  });
});
