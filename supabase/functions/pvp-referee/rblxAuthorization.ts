export interface RblxEntryAuthorization {
  version: 1;
  chainId: 4663;
  escrowAddress: string;
  walletAddress: string;
  stakeWei: string;
  minimumRblxOut: string;
  quotedRblxOut: string;
  expiresAt: string;
  fallbackSeconds: 900;
}

const encoder = new TextEncoder();
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}
async function key(secret: string) {
  if (secret.length < 32) throw new Error('Payout authorization signing key is not configured');
  return crypto.subtle.importKey('raw', encoder.encode(`chessblox:rblx-entry:v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signRblxAuthorization(payload: RblxEntryAuthorization, secret: string): Promise<string> {
  const body = encode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(body))))}`;
}
export async function verifyRblxAuthorization(token: unknown, secret: string, expected: { walletAddress: string; escrowAddress: string; stakeWei: string }, now = Date.now()): Promise<RblxEntryAuthorization> {
  try {
    if (typeof token !== 'string' || token.length > 4096) throw new Error();
    const parts = token.split('.');
    if (parts.length !== 2 || !await crypto.subtle.verify('HMAC', await key(secret), decode(parts[1]), encoder.encode(parts[0]))) throw new Error();
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0]))) as RblxEntryAuthorization;
    if (payload.version !== 1 || payload.chainId !== 4663 || payload.fallbackSeconds !== 900
      || payload.walletAddress.toLowerCase() !== expected.walletAddress.toLowerCase()
      || payload.escrowAddress.toLowerCase() !== expected.escrowAddress.toLowerCase()
      || payload.stakeWei !== expected.stakeWei
      || !/^[1-9][0-9]*$/.test(payload.minimumRblxOut) || !/^[1-9][0-9]*$/.test(payload.quotedRblxOut)
      || BigInt(payload.minimumRblxOut) > BigInt(payload.quotedRblxOut)
      || !Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= now) throw new Error();
    return payload;
  } catch {
    throw new Error('Payout authorization is invalid or expired. Review a fresh RBLX quote before depositing.');
  }
}
