import test from "node:test";
import assert from "node:assert/strict";
import { verifyReleaseBackend } from "./verify-release-backend.mjs";

async function probe(
  {
    schema = [403, { code: "42501" }],
    quote = [400, { code: "play_terms_required" }],
  } = {},
) {
  const bodies = [];
  const response = ([status, body]) =>
    new Response(JSON.stringify(body), { status });
  const request = async (url, options) => {
    if (url.pathname.startsWith("/rest/")) return response(schema);
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.action === "init_session") {
      return response([200, {
        sessionId: "test-session",
        sessionProof: "test-proof",
      }]);
    }
    if (body.action === "create_wallet_proof_challenge") {
      return response([200, {
        walletProof: {
          message: "Isolated release verifier unit test",
          nonce: "unit-test-nonce",
          expiresAt: "2099-01-01",
        },
      }]);
    }
    return response(quote);
  };
  const result = await verifyReleaseBackend({
    url: "http://127.0.0.1:1",
    publicKey: "test-public-key",
    request,
  });
  assert.deepEqual(bodies.map((b) => b.action), [
    "init_session",
    "create_wallet_proof_challenge",
    "get_rblx_entry_quote",
  ]);
  assert(
    bodies.every((b) =>
      !("playTermsVersion" in b) && !("uniswapTermsAccepted" in b) &&
      !("stockTokenEligibilityAttested" in b)
    ),
  );
  return result;
}

test("accepts a protected consent table and compatible referee without accepting terms", async () => {
  assert.equal((await probe()).passed, true);
});
test("rejects the observed older production handler and absent migration", async () => {
  const result = await probe({
    schema: [404, { code: "PGRST205" }],
    quote: [200, { payoutMode: "eth_claim" }],
  });
  assert.equal(result.passed, false);
  assert.equal(result.checks.filter((c) => !c.passed).length, 2);
});
test("does not count public-readable consent data as a successful migration", async () => {
  assert.equal((await probe({ schema: [200, []] })).passed, false);
});
test("does not mistake a server failure for consent enforcement", async () => {
  assert.equal(
    (await probe({ quote: [503, { code: "play_terms_required" }] })).passed,
    false,
  );
});
