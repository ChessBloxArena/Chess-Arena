const PUBLICNODE = 'https://robinhood-rpc.publicnode.com';
const OFFICIAL = 'https://rpc.mainnet.chain.robinhood.com';
const READ_METHODS = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount',
  'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_getBlockByNumber', 'eth_getBlockByHash',
]);
const CACHE_METHODS = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionReceipt']);

export function createRpcProxy({ primary = process.env.ROBINHOOD_RPC_URL, fetchRpc = fetch, fallbacks = [PUBLICNODE, OFFICIAL], timeoutMs = 4000 } = {}) {
  const urls = [...new Set([primary, ...fallbacks].filter(Boolean))];
  const cache = new Map();
  const inflight = new Map();
  let active = 0;
  let windowStart = 0;
  let requests = 0;
  let primaryUnavailableUntil = 0;

  async function read(payload) {
    for (let index = 0; index < urls.length; index++) {
      if (index === 0 && primary && Date.now() < primaryUnavailableUntil) continue;
      try {
        const response = await fetchRpc(urls[index], {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, id: 1 }), signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new Error('Upstream unavailable');
        const data = await response.json();
        if (data?.jsonrpc !== '2.0' || data.id !== 1 || (!('result' in data) && !data.error)) throw new Error('Invalid RPC response');
        if (data.error) {
          if ([-32005, -32016, -32603, 429].includes(data.error.code) || /rate|limit|capacity|temporar/i.test(data.error.message ?? '')) throw new Error('Upstream unavailable');
          // Never return upstream URLs, API keys, or provider diagnostics to browsers.
          const reverted = /revert/i.test(data.error.message ?? '');
          return { error: { code: data.error.code, message: reverted ? 'Execution reverted' : 'RPC request rejected',
            ...(typeof data.error.data === 'string' && /^0x[\da-f]*$/i.test(data.error.data) ? { data: data.error.data } : {}) } };
        }
        if (payload.method === 'eth_chainId' && data.result !== '0x1237') throw new Error('Wrong network');
        if (payload.method === 'net_version' && data.result !== '4663') throw new Error('Wrong network');
        return { result: data.result };
      } catch {
        if (index === 0 && primary) primaryUnavailableUntil = Date.now() + 15_000;
      }
    }
    throw new Error('RPC temporarily unavailable');
  }

  return async function handleRpc(req, res) {
    const send = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'POST') return send(405, { error: 'POST required' });
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON required' });
    if (Number(req.headers['content-length']) > 16384) return send(413, { error: 'Request too large' });
    let payload;
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 16384) return send(413, { error: 'Request too large' });
      }
      payload = JSON.parse(body);
    } catch { return send(400, { error: 'Invalid JSON' }); }
    if (!payload || Array.isArray(payload) || payload.jsonrpc !== '2.0' ||
        !['string', 'number'].includes(typeof payload.id) || String(payload.id).length > 100 ||
        !READ_METHODS.has(payload.method) || !Array.isArray(payload.params) || payload.params.length > 4) {
      return send(400, { error: 'Unsupported read request' });
    }
    const reply = value => ({ jsonrpc: '2.0', id: payload.id, ...value });
    const key = JSON.stringify([payload.method, payload.params]);
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return send(200, reply(cached.value));
    let pending = inflight.get(key);
    if (!pending) {
      if (Date.now() - windowStart >= 10_000) { windowStart = Date.now(); requests = 0; }
      if (active >= 6 || requests >= 100) {
        res.setHeader('retry-after', '2');
        return send(429, reply({ error: { code: -32005, message: 'Please retry shortly' } }));
      }
      active++; requests++;
      pending = read(payload).then(value => {
        if (CACHE_METHODS.has(payload.method) && 'result' in value) {
          if (cache.size >= 1024) cache.delete(cache.keys().next().value);
          cache.set(key, { value, until: Date.now() + 1000 });
        }
        return value;
      }).finally(() => { active--; inflight.delete(key); });
      inflight.set(key, pending);
    }
    try { return send(200, reply(await pending)); }
    catch { return send(503, reply({ error: { code: -32005, message: 'RPC temporarily unavailable. Please retry shortly.' } })); }
  };
}
