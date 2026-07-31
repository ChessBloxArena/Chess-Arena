import { ROBINHOOD_CHAIN_ID, ROBINHOOD_UNIVERSAL_ROUTER_ADDRESS } from './robinhoodChain';

export function validateRblxQuote(quote: { walletAddress?: string; transaction: { to: string; data: string; value: string; chainId: number }; minimumRblxOut: string; quotedRblxOut: string; expiresAt: string }, expectedPrizeWei: bigint, now = Date.now(), expectedWalletAddress?: string): void {
  if (expectedWalletAddress && quote?.walletAddress?.toLowerCase() !== expectedWalletAddress.toLowerCase()) throw new Error("Wallet changed. Request a new RBLX quote for this wallet.");
  if (!quote?.transaction || quote.transaction.chainId !== ROBINHOOD_CHAIN_ID) throw new Error('Conversion quote is for the wrong network.');
  if (quote.transaction.to?.toLowerCase() !== ROBINHOOD_UNIVERSAL_ROUTER_ADDRESS.toLowerCase()) throw new Error('Conversion quote uses an unexpected router.');
  if (!/^0x(?:[0-9a-fA-F]{2}){4,}$/.test(quote.transaction.data || '')) throw new Error('Conversion transaction data is invalid.');
  if (!/^\d+$/.test(quote.transaction.value || '') || expectedPrizeWei <= 0n || BigInt(quote.transaction.value) !== expectedPrizeWei) throw new Error('Conversion amount does not match your prize.');
  const expires = Date.parse(quote.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw new Error('Conversion quote expired. Request a new quote.');
  if (!/^\d+$/.test(quote.minimumRblxOut || '') || !/^\d+$/.test(quote.quotedRblxOut || '') || BigInt(quote.minimumRblxOut) <= 0n || BigInt(quote.minimumRblxOut) > BigInt(quote.quotedRblxOut)) throw new Error('Conversion output is invalid.');
}
