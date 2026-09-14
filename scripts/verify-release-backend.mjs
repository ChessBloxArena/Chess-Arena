import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { pathToFileURL } from "node:url";

// This probe creates only an ephemeral authentication session. It never accepts
// play terms, prepares a contest, requests a transaction, or saves a wallet key.
export async function verifyReleaseBackend(
  { url, publicKey, request = fetch },
) {
  const base = new URL(url);
  if (
    base.protocol !== "https:" &&
    !(base.protocol === "http:" && base.hostname === "127.0.0.1")
  ) {
    throw new Error("Use HTTPS or an isolated loopback backend.");
  }
  if (!publicKey) {
    throw new Error("A public Supabase publishable key is required.");
  }
  const checks = [];
  const check = (name, passed, details = {}) =>
    checks.push({ name, passed, ...details });
  const headers = { apikey: publicKey, "content-type": "application/json" };
  const call = async (session, body) => {
    const response = await request(new URL("/functions/v1/pvp-referee", base), {
      method: "POST",
      headers,
      body: JSON.stringify({ ...session, ...body }),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: response.status, data: await response.json() };
  };
  const schema = await request(
    new URL("/rest/v1/pvp_play_consents?select=wallet_address&limit=0", base),
    {
      headers,
      signal: AbortSignal.timeout(20_000),
    },
  );
  const schemaBody = await schema.json();
  // This table is service-only: browser credentials must not read it. A missing
  // relation is a different failure, not evidence that access controls work.
  check(
    "Saved-consent table exists and denies browser reads",
    [401, 403].includes(schema.status) && schemaBody.code === "42501",
    { status: schema.status, code: schemaBody.code ?? null },
  );
  const init = await call(null, { action: "init_session" });
  check(
    "Referee initializes an authentication session",
    init.status === 200 &&
      typeof init.data.sessionId === "string" &&
      typeof init.data.sessionProof === "string",
    { status: init.status },
  );
  if (!checks.at(-1).passed) return { passed: false, checks };
  const session = {
    sessionId: init.data.sessionId,
    sessionProof: init.data.sessionProof,
  };
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = await call(session, {
    action: "create_wallet_proof_challenge",
    proofAction: "get_rblx_entry_quote",
    walletAddress: account.address,
  });
  const proof = challenge.data.walletProof;
  check(
    "Referee issues a quote-only wallet challenge",
    challenge.status === 200 &&
      typeof proof?.message === "string" && typeof proof?.nonce === "string",
    { status: challenge.status },
  );
  if (!checks.at(-1).passed) return { passed: false, checks };
  const signature = await account.signMessage({ message: proof.message });
  const response = await call(session, {
    action: "get_rblx_entry_quote",
    walletAddress: account.address,
    walletProofNonce: proof.nonce,
    walletProofExpiresAt: proof.expiresAt,
    walletSignature: Buffer.from(signature.slice(2), "hex").toString("base64"),
  });
  check(
    "Current referee rejects entry quotes without saved play consent",
    response.status === 400 && response.data.code === "play_terms_required",
    {
      status: response.status,
      code: response.data.code ?? null,
      payoutMode: response.data.payoutMode ?? null,
    },
  );
  return { passed: checks.every((c) => c.passed), checks };
}

if (
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const report = await verifyReleaseBackend({
      url: process.env.VITE_SUPABASE_URL,
      publicKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
    console.log(
      JSON.stringify(
        { checkedAt: new Date().toISOString(), ...report },
        null,
        2,
      ),
    );
    process.exitCode = report.passed ? 0 : 1;
  } catch {
    console.error(
      "Backend verification could not complete. Check public configuration and connectivity.",
    );
    process.exitCode = 1;
  }
}
