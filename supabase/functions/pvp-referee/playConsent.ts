export const PLAY_TERMS_VERSION = '2026-09-08.1';
export const QUOTE_SESSION_TTL_MS = 30 * 60 * 1000;
export interface QuoteSession {
  purpose: 'rblx_quote_only'; version: string; walletAddress: string;
  sessionId: string; acceptedAt: string; expiresAt: string;
}
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function key(secret: string) {
  if (secret.length < 32) throw new Error('Quote session signing key unavailable');
  return crypto.subtle.importKey('raw', encoder.encode(`chessblox:quote-session:v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signQuoteSession(payload: QuoteSession, secret: string) {
  const body = encode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body))))}`;
}
export async function verifyQuoteSession(token: unknown, secret: string, expected: { walletAddress: string; sessionId: string }, now = Date.now()): Promise<QuoteSession> {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(secret), decode(parts[1]), encoder.encode(parts[0]))) throw new Error();
    const p: QuoteSession = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const expires = Date.parse(p.expiresAt);
    if (p.purpose !== 'rblx_quote_only' || p.version !== PLAY_TERMS_VERSION
      || p.walletAddress.toLowerCase() !== expected.walletAddress.toLowerCase() || p.sessionId !== expected.sessionId
      || !Number.isFinite(expires) || expires <= now || expires > now + QUOTE_SESSION_TTL_MS
      || !Number.isFinite(Date.parse(p.acceptedAt)) || Date.parse(p.acceptedAt) > now) throw new Error();
    return p;
  } catch { throw new Error('Quote session expired. Continue to reconnect it in your wallet.'); }
}
