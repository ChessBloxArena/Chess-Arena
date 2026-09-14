import assert from 'node:assert/strict';
import { Connection, PublicKey } from 'npm:@solana/web3.js@1.99.0';

// web3.js uses jayson/lib/client/browser, not Jayson's legacy server stream API.
// Verify every RPC method the referee uses with the patched Deno dependency graph.
Deno.test('patched Solana RPC dependencies preserve all referee read methods', async () => {
  const address = '11111111111111111111111111111111';
  const account = new PublicKey(address);
  const amount = { amount: '12345', decimals: 6, uiAmount: 0.012345, uiAmountString: '0.012345' };
  const seen: string[] = [];
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
    const { id, method } = await request.json();
    assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
    seen.push(method);
    let result: unknown;
    if (method === 'getBalance') result = { context: { slot: 1 }, value: 1000 };
    else if (method === 'getTokenAccountBalance') result = { context: { slot: 1 }, value: amount };
    else if (method === 'getAccountInfo') result = { context: { slot: 1 }, value: {
      data: ['AQIDBA==', 'base64'], executable: false, lamports: 42, owner: address, rentEpoch: 0,
    } };
    else if (method === 'getTokenAccountsByOwner') result = { context: { slot: 1 }, value: [{
      pubkey: address,
      account: { executable: false, lamports: 42, owner: address, rentEpoch: 0,
        data: { program: 'spl-token', space: 165, parsed: { type: 'account', info: { mint: address, owner: address, tokenAmount: amount } } },
      },
    }] };
    else if (method === 'getTransaction') result = {
      slot: 1, blockTime: 1, version: 'legacy',
      meta: { err: null, fee: 5000, preBalances: [10000], postBalances: [5000], innerInstructions: [], logMessages: [] },
      transaction: { signatures: ['test-signature'], message: {
        accountKeys: [{ pubkey: address, signer: true, writable: true }],
        instructions: [], recentBlockhash: address,
      } },
    };
    else throw new Error(`Unexpected RPC method: ${method}`);
    return Response.json({ jsonrpc: '2.0', id, result });
  });
  try {
    const connection = new Connection(`http://127.0.0.1:${server.addr.port}`, 'confirmed');
    assert.equal(await connection.getBalance(account, 'confirmed'), 1000);
    assert.deepEqual((await connection.getTokenAccountBalance(account, 'confirmed')).value, amount);
    const info = await connection.getAccountInfo(account, 'confirmed');
    assert.deepEqual([...info!.data], [1, 2, 3, 4]);
    assert.equal(info!.owner.toBase58(), address);
    const tokens = await connection.getParsedTokenAccountsByOwner(account, { mint: account });
    assert.equal(tokens.value[0].pubkey.toBase58(), address);
    const transaction = await connection.getParsedTransaction('test-signature', { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    assert.equal(transaction!.transaction.message.accountKeys[0].pubkey.toBase58(), address);
    assert.equal(transaction!.transaction.message.accountKeys[0].signer, true);
    assert.deepEqual(seen, ['getBalance', 'getTokenAccountBalance', 'getAccountInfo', 'getTokenAccountsByOwner', 'getTransaction']);
  } finally {
    await server.shutdown();
  }
});
