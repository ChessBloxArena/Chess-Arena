import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRpcProxy } from './robinhood-rpc-proxy.mjs';

async function withProxy(options, run) {
  const server = http.createServer(createRpcProxy(options));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const request = (method, params = [], id = 1) => fetch(`http://127.0.0.1:${server.address().port}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  try { await run(request); } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); }
}
const success = result => Response.json({ jsonrpc: '2.0', id: 1, result });

test('falls back on 429 and cools down primary while preserving request IDs', async () => {
  const calls = [];
  await withProxy({ primary: 'https://primary.invalid/private-key', fallbacks: ['https://backup.invalid'], fetchRpc: async url => {
    calls.push(url); return url.includes('primary') ? new Response('rate limited', { status: 429 }) : success('0x123');
  } }, async request => {
    assert.deepEqual(await (await request('eth_blockNumber', [], 7)).json(), { jsonrpc: '2.0', id: 7, result: '0x123' });
    assert.equal((await (await request('eth_gasPrice')).json()).result, '0x123');
    assert.equal(calls.filter(url => url.includes('primary')).length, 1);
    assert.equal(calls.filter(url => url.includes('backup')).length, 2);
  });
});

test('deduplicates simultaneous reads and caches briefly', async () => {
  let calls = 0;
  await withProxy({ primary: 'https://primary.invalid', fallbacks: [], fetchRpc: async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 20)); return success('0x2');
  } }, async request => {
    const replies = await Promise.all([request('eth_blockNumber', [], 1), request('eth_blockNumber', [], 2)]);
    assert.deepEqual(await Promise.all(replies.map(r => r.json())).then(rows => rows.map(r => r.id)), [1, 2]);
    await request('eth_blockNumber'); assert.equal(calls, 1);
  });
});

test('rejects transaction submissions and expensive unsupported methods before calling providers', async () => {
  let calls = 0;
  await withProxy({ fetchRpc: async () => { calls++; return success(null); } }, async request => {
    for (const method of ['eth_sendRawTransaction', 'eth_sendTransaction', 'personal_sign', 'eth_getLogs', 'debug_traceTransaction']) {
      assert.equal((await request(method)).status, 400);
    }
    assert.equal(calls, 0);
  });
});

test('does not leak provider errors or retry an execution revert', async () => {
  let calls = 0;
  await withProxy({ primary: 'https://primary.invalid/private-key', fetchRpc: async () => {
    calls++; return Response.json({ jsonrpc: '2.0', id: 1, error: { code: 3, message: 'execution reverted at https://primary.invalid/private-key', data: '0x1234' } });
  } }, async request => {
    const result = await (await request('eth_call', [{ to: '0x123' }, 'latest'])).json();
    assert.deepEqual(result.error, { code: 3, message: 'Execution reverted', data: '0x1234' });
    assert.equal(calls, 1);
  });
});

test('returns a clean retryable error when all providers fail', async () => {
  await withProxy({ fetchRpc: async () => { throw new Error('secret upstream URL'); } }, async request => {
    const response = await request('eth_blockNumber');
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret|https/);
  });
});

test('rejects a wrong-chain primary and obtains the real chain ID from backup', async () => {
  await withProxy({ primary: 'https://wrong.invalid', fallbacks: ['https://backup.invalid'], fetchRpc: async url => success(url.includes('wrong') ? '0x1' : '0x1237') }, async request => {
    assert.equal((await (await request('eth_chainId')).json()).result, '0x1237');
  });
});
