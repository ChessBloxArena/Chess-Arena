import { fallback, http } from 'viem';

export const PUBLICNODE_RPC = 'https://robinhood-rpc.publicnode.com';
export const OFFICIAL_RPC = 'https://rpc.mainnet.chain.robinhood.com';

/** Read clients only. Wallet signing/broadcast transports remain separate. */
export function robinhoodReadTransport(primary) {
  const urls = [...new Set([primary, PUBLICNODE_RPC, OFFICIAL_RPC].filter(Boolean))];
  return fallback(urls.map(url => http(url, { timeout: 5000, retryCount: 0 })), {
    retryCount: 0,
    rank: false,
  });
}
