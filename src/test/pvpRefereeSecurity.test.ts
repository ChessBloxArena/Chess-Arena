// @vitest-environment node

import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  base58Encode,
  captchaProviderFromEnv,
  createWalletProofChallenge,
  verifyCaptchaOrThrow,
  verifyWalletProofWithNonceStore,
  type WalletProofNonceStore,
  type WalletProofRequest,
} from "../../supabase/functions/pvp-referee/security.ts";

function staticEnv(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function ed25519Wallet() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  return {
    walletAddress: base58Encode(publicKey),
    sign: async (message: string) => new Uint8Array(await crypto.subtle.sign(
      { name: "Ed25519" },
      keyPair.privateKey,
      new TextEncoder().encode(message),
    )),
  };
}

class MemoryNonceStore implements WalletProofNonceStore {
  private readonly nonces = new Set<string>();

  add(request: Omit<WalletProofRequest, "signature">) {
    this.nonces.add(this.key(request));
  }

  async consume(request: WalletProofRequest): Promise<boolean> {
    const key = this.key(request);
    if (!this.nonces.has(key)) return false;
    this.nonces.delete(key);
    return true;
  }

  private key(request: Omit<WalletProofRequest, "signature">) {
    return [
      request.walletAddress,
      request.action,
      request.sessionId,
      request.gameId ?? "none",
      request.nonce,
      request.expiresAt,
    ].join(":");
  }
}

describe("pvp-referee bot friction and wallet proofs", () => {
  it("verifies an EIP-191 wallet proof for a Robinhood Chain address", async () => {
    const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
    const challenge = createWalletProofChallenge({
      action: "get_rblx_swap_quote",
      sessionId: "session-evm",
      gameId: "00000000-0000-4000-8000-000000000003",
      nonce: "nonce-evm",
      expiresAt: "2026-09-03T03:00:00.000Z",
    });
    const signature = await account.signMessage({ message: { raw: new TextEncoder().encode(challenge.message) } });
    const request = {
      action: challenge.action,
      sessionId: challenge.sessionId,
      gameId: challenge.gameId,
      walletAddress: account.address,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature: base64(hexToBytes(signature)),
    };
    const store = new MemoryNonceStore();
    store.add(request);
    await expect(verifyWalletProofWithNonceStore(request, store)).resolves.toBe(true);
  });

  it("rejects missing CAPTCHA when a configured provider requires it", async () => {
    const provider = captchaProviderFromEnv(staticEnv({
      PVP_CAPTCHA_PROVIDER: "static",
      PVP_CAPTCHA_STATIC_TOKEN: "token-ok",
    }));

    await expect(verifyCaptchaOrThrow(provider, undefined, { action: "join_queue" }))
      .rejects.toThrow("CAPTCHA required");
  });

  it("rejects bad CAPTCHA tokens", async () => {
    const provider = captchaProviderFromEnv(staticEnv({
      PVP_CAPTCHA_PROVIDER: "static",
      PVP_CAPTCHA_STATIC_TOKEN: "token-ok",
    }));

    await expect(verifyCaptchaOrThrow(provider, "token-bad", { action: "join_queue" }))
      .rejects.toThrow("CAPTCHA verification failed");
  });

  it("rejects bad wallet signatures", async () => {
    const wallet = await ed25519Wallet();
    const challenge = createWalletProofChallenge({
      action: "prepare_wager_queue",
      sessionId: "session-a",
      gameId: null,
      nonce: "nonce-a",
      expiresAt: "2026-06-17T03:00:00.000Z",
    });
    const store = new MemoryNonceStore();
    store.add({ ...challenge, walletAddress: wallet.walletAddress });

    const ok = await verifyWalletProofWithNonceStore({
      action: challenge.action,
      sessionId: challenge.sessionId,
      gameId: challenge.gameId,
      walletAddress: wallet.walletAddress,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature: base64(new Uint8Array(64)),
    }, store);

    expect(ok).toBe(false);
  });

  it("rejects nonce reuse", async () => {
    const wallet = await ed25519Wallet();
    const challenge = createWalletProofChallenge({
      action: "prepare_wager_queue",
      sessionId: "session-a",
      gameId: null,
      nonce: "nonce-a",
      expiresAt: "2026-06-17T03:00:00.000Z",
    });
    const signature = base64(await wallet.sign(challenge.message));
    const store = new MemoryNonceStore();
    const request = {
      action: challenge.action,
      sessionId: challenge.sessionId,
      gameId: challenge.gameId,
      walletAddress: wallet.walletAddress,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature,
    };
    store.add(request);

    await expect(verifyWalletProofWithNonceStore(request, store)).resolves.toBe(true);
    await expect(verifyWalletProofWithNonceStore(request, store)).resolves.toBe(false);
  });

  it("binds wallet proof signatures to action, session, and game", async () => {
    const wallet = await ed25519Wallet();
    const challenge = createWalletProofChallenge({
      action: "claim_timeout",
      sessionId: "session-a",
      gameId: "00000000-0000-4000-8000-000000000001",
      nonce: "nonce-a",
      expiresAt: "2026-06-17T03:00:00.000Z",
    });
    const signature = base64(await wallet.sign(challenge.message));
    const store = new MemoryNonceStore();
    store.add({ ...challenge, walletAddress: wallet.walletAddress });

    await expect(verifyWalletProofWithNonceStore({
      action: "request_wager_refund",
      sessionId: challenge.sessionId,
      gameId: challenge.gameId,
      walletAddress: wallet.walletAddress,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature,
    }, store)).resolves.toBe(false);

    await expect(verifyWalletProofWithNonceStore({
      action: challenge.action,
      sessionId: "session-b",
      gameId: challenge.gameId,
      walletAddress: wallet.walletAddress,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature,
    }, store)).resolves.toBe(false);

    await expect(verifyWalletProofWithNonceStore({
      action: challenge.action,
      sessionId: challenge.sessionId,
      gameId: "00000000-0000-4000-8000-000000000002",
      walletAddress: wallet.walletAddress,
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt,
      signature,
    }, store)).resolves.toBe(false);
  });
});
