# Jayson stream compatibility

Jayson 4.3 requires two interfaces from `stream-json` 1: `StreamValues.withParser()`
and `new Verifier()`. That release contains the vulnerable filter implementation
covered by GHSA-528h-pc64-c93x. This private adapter delegates both interfaces to
the patched `stream-json` 3.6 Node streams. It does not copy the old parser or filters.

The root dependency and scoped Jayson override keep the local package portable
through `npm ci`. Node 22 can load the upstream synchronous ES modules from these
CommonJS entry points. `src/test/dependencyCompatibility.test.ts` checks fragmented
and consecutive JSON-RPC messages and malformed input through Jayson itself.

Remove the adapter when Jayson supports the patched stream API directly. This
adapter applies to the Node dependency graph; the referee's separate Deno graph
uses a flat pin to stream-json 3.6. Its web3.js consumer imports only Jayson's
browser RPC client, which does not load the legacy server stream API. The referee's
loopback RPC test verifies every Solana read method it uses with that graph.
