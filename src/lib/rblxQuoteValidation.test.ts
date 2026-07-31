import { describe, expect, it } from 'vitest';
import { validateRblxQuote } from './rblxQuoteValidation';
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_UNIVERSAL_ROUTER_ADDRESS } from './robinhoodChain';
const quote = { transaction: { to: ROBINHOOD_UNIVERSAL_ROUTER_ADDRESS, data: '0x12345678', value: '20', chainId: ROBINHOOD_CHAIN_ID }, minimumRblxOut: '9', quotedRblxOut: '10', expiresAt: '2030-01-01T00:00:00Z' };
describe('RBLX quote validation', () => {
  it('accepts the exact prize with positive minimum output', () => expect(() => validateRblxQuote(quote, 20n, 0)).not.toThrow());
  it('rejects overspending', () => expect(() => validateRblxQuote(quote, 10n, 0)).toThrow('amount'));
  it('rejects another network', () => expect(() => validateRblxQuote({ ...quote, transaction: { ...quote.transaction, chainId: 1 } }, 20n, 0)).toThrow('network'));
  it('rejects another router', () => expect(() => validateRblxQuote({ ...quote, transaction: { ...quote.transaction, to: '0x0' } }, 20n, 0)).toThrow('router'));
  it('rejects expired quotes', () => expect(() => validateRblxQuote(quote, 20n, Date.parse(quote.expiresAt))).toThrow('expired'));
  it('rejects zero output protection', () => expect(() => validateRblxQuote({ ...quote, minimumRblxOut: '0' }, 20n, 0)).toThrow('output'));
});
