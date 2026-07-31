import { describe, expect, it } from 'vitest';
import { INITIAL_PREVIEW, previewWalletReducer as reduce } from './wagerPreview';
import { PUSH_IMPACT_TIME, pushProgress } from './pushMotion';
describe('local wager walkthrough accounting', () => {
  it.each([.005,.01,.025])('preserves principal and profit through claim and conversion for %s ETH', stake => {
    let state = reduce(INITIAL_PREVIEW, { type:'stake', amount:stake });
    state = reduce(state,{type:'fund'});
    expect(state.eth).toBeCloseTo(.1-stake);
    state = reduce(state,{type:'play'}); state = reduce(state,{type:'win'}); state = reduce(state,{type:'claim'});
    expect(state.eth).toBeCloseTo(.1+stake);
    const claimed = state; expect(reduce(state,{type:'claim'})).toBe(claimed);
    state = reduce(state,{type:'convert'});
    expect(state.eth).toBeCloseTo(.1-stake);
    expect(state.rblx).toBeCloseTo(stake*100);
    expect(reduce(state,{type:'convert'})).toBe(state);
    expect(reduce(state,{type:'reset'})).toEqual(INITIAL_PREVIEW);
  });
  it('rejects premature claims, conversion, and unsupported stakes', () => {
    for (const type of ['claim','win','convert'] as const) expect(reduce(INITIAL_PREVIEW,{type})).toBe(INITIAL_PREVIEW);
    expect(reduce(INITIAL_PREVIEW,{type:'stake',amount:-1})).toBe(INITIAL_PREVIEW);
    expect(reduce(INITIAL_PREVIEW,{type:'stake',amount:NaN})).toBe(INITIAL_PREVIEW);
  });
});
it('keeps the piece still for the courier approach and lands before capture impact', () => {
  expect(pushProgress(0)).toBe(0); expect(pushProgress(.08)).toBe(0);
  expect(pushProgress(.4)).toBeGreaterThan(0); expect(pushProgress(.4)).toBeLessThan(1);
  expect(pushProgress(PUSH_IMPACT_TIME)).toBeCloseTo(1);
  expect(pushProgress(10)).toBe(1);
});
