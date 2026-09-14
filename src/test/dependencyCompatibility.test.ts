// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { u64, u128, u256 } from '@solana/buffer-layout-utils';

const require = createRequire(import.meta.url);
const layoutRequire = createRequire(require.resolve('@solana/buffer-layout-utils'));
const bigint = layoutRequire('bigint-buffer');
const jayson = require('jayson');

describe('patched dependency compatibility', () => {
  it('round trips native bigint buffers beyond the old 32-byte stack boundary', () => {
    for (const width of [0, 1, 7, 8, 31, 32, 33, 64, 65, 256, 257]) {
      const bytes = Buffer.alloc(width, 0xa5);
      const expected = width ? BigInt(`0x${bytes.toString('hex')}`) : 0n;
      expect(bigint.toBigIntLE(bytes)).toBe(expected);
      expect(bigint.toBigIntBE(bytes)).toBe(expected);
      if (width) {
        expect(bigint.toBufferLE(expected, width)).toEqual(bytes);
        expect(bigint.toBufferBE(expected, width)).toEqual(bytes);
      }
    }
  });

  it('preserves unsigned SPL amount layouts at their maximum values and offsets', () => {
    for (const makeLayout of [u64, u128, u256]) {
      const layout = makeLayout();
      const value = (1n << BigInt(layout.span * 8)) - 1n;
      const bytes = Buffer.alloc(layout.span + 4, 0x42);
      layout.encode(value, bytes, 2);
      expect(layout.decode(bytes, 2)).toBe(value);
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x42, 0x42]));
      expect(bytes.subarray(-2)).toEqual(Buffer.from([0x42, 0x42]));
    }
  });

  it('parses fragmented and consecutive JSON-RPC values using the patched stream API', async () => {
    const values: unknown[] = [];
    const stream = new PassThrough();
    const done = new Promise<void>((resolve, reject) => {
      jayson.Utils.parseStream(stream, {}, (error: Error | null, value: unknown) => {
        if (error) return reject(error);
        values.push(value);
        if (values.length === 2) resolve();
      });
    });
    stream.write('{"jsonrpc":"2.0","id":"one","result":');
    stream.write('{"balance":123}}\n');
    stream.end('{"jsonrpc":"2.0","id":"two","result":[]}');
    await done;
    expect(values).toEqual([
      { jsonrpc: '2.0', id: 'one', result: { balance: 123 } },
      { jsonrpc: '2.0', id: 'two', result: [] },
    ]);
  });

  it('rejects invalid JSON-RPC stream input', async () => {
    const stream = new PassThrough();
    const rejected = new Promise<Error>(resolve => {
      jayson.Utils.parseStream(stream, {}, (error: Error | null) => { if (error) resolve(error); });
    });
    stream.end('{invalid json}');
    expect(await rejected).toBeInstanceOf(Error);
  });

  it('keeps UUID v4 generation compatible with wallet and JSON-RPC callers', () => {
    for (const caller of ['jayson', '@metamask/utils', '@solflare-wallet/sdk']) {
      const fromCaller = createRequire(require.resolve(caller));
      const { v4, validate, version } = fromCaller('uuid');
      const id = v4();
      expect(validate(id)).toBe(true);
      expect(version(id)).toBe(4);
      expect(fromCaller('uuid/package.json').version).toBe('11.1.1');
    }
  });
});
