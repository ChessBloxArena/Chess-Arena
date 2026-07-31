// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const modulePath = '../../supabase/functions/pvp-referee/rblxSwap.ts';
const wallet = '0x1111111111111111111111111111111111111111';
const token = '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8';
const native = '0x0000000000000000000000000000000000000000';
const router = '0x8876789976decbfcbbbe364623c63652db8c0904';
const fixtures = () => ({
  permission: { results: [{ token, isPermissioned: false, isAllowlisted: false }] },
  quote: { routing: 'CLASSIC', quote: { chainId: 4663, swapper: wallet,
    input: { token: native, amount: '20' }, output: { token, recipient: wallet, amount: '10', minimumAmount: '9' } } },
  built: { gasFee: '7', swap: { to: router, from: wallet, data: '0x3593564c0000', value: '0x14', chainId: 4663 } },
});

describe('Uniswap RBLX quote preparation', () => {
  async function prepare(data = fixtures()) {
    const { buildRblxSwapQuote } = await import(modulePath);
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(data.permission), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data.quote), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data.built), { status: 200 }));
    const result = await buildRblxSwapQuote({ apiKey: 'test-key', walletAddress: wallet, payoutWei: 20n, fetchImpl: request });
    return { result, request };
  }

  it('spends from the escrow while delivering tokens to the winner', async () => {
    const { buildRblxSwapQuote } = await import(modulePath);
    const escrow = '0x3333333333333333333333333333333333333333';
    const data = fixtures(); data.quote.quote.swapper = escrow; data.built.swap.from = escrow;
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data.permission), {status:200})).mockResolvedValueOnce(new Response(JSON.stringify(data.quote), {status:200})).mockResolvedValueOnce(new Response(JSON.stringify(data.built), {status:200}));
    const result = await buildRblxSwapQuote({apiKey:'test-key',walletAddress:wallet,swapperAddress:escrow,payoutWei:20n,fetchImpl:request});
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({swapper:escrow,recipient:wallet});
    expect(result.walletAddress.toLowerCase()).toBe(wallet);
  });
  it('uses the deployed router version and accepts Uniswap hex transaction amounts', async () => {
    const { result, request } = await prepare();
    expect(result.transaction).toEqual({ to: expect.stringMatching(/^0x/), data: '0x3593564c0000', value: '20', chainId: 4663 });
    expect(result.minimumRblxOut).toBe('9');
    expect(result.estimatedGasWei).toBe('7');
    expect(request.mock.calls).toHaveLength(3);
    expect(request.mock.calls[1][1].headers['x-universal-router-version']).toBe('2.1.1');
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ protocols: ['V4'], recipient: wallet, amount: '20' });
    expect(request.mock.calls.map(call => call[0])).toEqual([
      'https://trade-api.gateway.uniswap.org/v1/permissions',
      'https://trade-api.gateway.uniswap.org/v1/quote',
      'https://trade-api.gateway.uniswap.org/v1/swap',
    ]);
  });

  it.each(['wrong recipient', 'wrong router', 'wrong network', 'overspend', 'zero minimum', 'unallowlisted'])('rejects %s', async reason => {
    const data = fixtures();
    if (reason === 'wrong recipient') data.quote.quote.output.recipient = router;
    if (reason === 'wrong router') data.built.swap.to = wallet;
    if (reason === 'wrong network') data.built.swap.chainId = 1;
    if (reason === 'overspend') data.built.swap.value = '0x15';
    if (reason === 'zero minimum') data.quote.quote.output.minimumAmount = '0';
    if (reason === 'unallowlisted') data.permission.results[0].isPermissioned = true;
    await expect(prepare(data)).rejects.toThrow();
  });

  it('does not build a swap when no route is available', async () => {
    const { buildRblxSwapQuote } = await import(modulePath);
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(fixtures().permission), {status:200}))
      .mockResolvedValueOnce(new Response(JSON.stringify({detail:'No quotes available'}), {status:404}));
    await expect(buildRblxSwapQuote({apiKey:'test-key',walletAddress:wallet,payoutWei:20n,fetchImpl:request})).rejects.toThrow('Keep your ETH');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
