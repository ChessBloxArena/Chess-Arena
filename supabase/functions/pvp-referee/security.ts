import { bytesToHex, isAddress, verifyMessage } from "viem";

export type CaptchaProviderName = "off" | "static" | "external";

export interface CaptchaProvider {
  readonly name: CaptchaProviderName;
  readonly available: boolean;
  verify(token: string | null | undefined, context: CaptchaContext): Promise<CaptchaVerificationResult>;
}

export interface CaptchaContext {
  action: string;
  sessionId?: string | null;
  walletAddress?: string | null;
}

export interface CaptchaVerificationResult {
  ok: boolean;
  reason?: string;
}

export interface EnvReader {
  get(name: string): string | undefined;
}

export interface WalletProofChallenge {
  action: string;
  sessionId: string;
  gameId: string | null;
  nonce: string;
  expiresAt: string;
  message: string;
}

export interface WalletProofRequest {
  action: string;
  sessionId: string;
  gameId?: string | null;
  walletAddress: string;
  nonce: string;
  expiresAt: string;
  signature: string;
}

export interface WalletProofNonceStore {
  consume(request: WalletProofRequest): Promise<boolean>;
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58Map = new Map([...base58Alphabet].map((character, index) => [character, index]));

export function walletProofMessage(input: Omit<WalletProofChallenge, "message">): string {
  return [
    "Chess Arena PvP",
    `Action: ${input.action}`,
    `Session: ${input.sessionId}`,
    `Game: ${input.gameId ?? "none"}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt}`,
  ].join("\n");
}

export function createWalletProofChallenge(input: Omit<WalletProofChallenge, "message">): WalletProofChallenge {
  return {
    ...input,
    message: walletProofMessage(input),
  };
}

export function base58Decode(value: string): Uint8Array {
  if (!value) throw new Error("Invalid base58 value");
  const bytes = [0];
  for (const character of value) {
    const digit = base58Map.get(character);
    if (digit == null) throw new Error("Invalid base58 value");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroes = 0;
  for (const character of value) {
    if (character !== "1") break;
    leadingZeroes += 1;
  }

  return new Uint8Array([
    ...Array.from({ length: leadingZeroes }, () => 0),
    ...bytes.reverse(),
  ]);
}

export function base58Encode(input: Uint8Array): string {
  if (input.length === 0) return "";
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let leadingZeroes = 0;
  for (const byte of input) {
    if (byte !== 0) break;
    leadingZeroes += 1;
  }

  return `${"1".repeat(leadingZeroes)}${digits.reverse().map((digit) => base58Alphabet[digit]).join("")}`;
}

function decodeBase64Signature(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBufferBacked(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

export function captchaProviderFromEnv(env: EnvReader): CaptchaProvider {
  const provider = (env.get("PVP_CAPTCHA_PROVIDER") ?? "off").trim().toLowerCase();
  if (provider === "static") {
    const expectedToken = env.get("PVP_CAPTCHA_STATIC_TOKEN")?.trim() ?? "";
    return {
      name: "static",
      available: expectedToken.length > 0,
      async verify(token) {
        return {
          ok: expectedToken.length > 0 && token === expectedToken,
          reason: expectedToken.length > 0 ? "static-token-mismatch" : "static-token-not-configured",
        };
      },
    };
  }

  if (provider === "external") {
    const verifyUrl = env.get("PVP_CAPTCHA_VERIFY_URL")?.trim() ?? "";
    const secret = env.get("PVP_CAPTCHA_SECRET")?.trim() ?? "";
    return {
      name: "external",
      available: verifyUrl.length > 0 && secret.length > 0,
      async verify(token) {
        if (!verifyUrl || !secret) return { ok: false, reason: "external-provider-not-configured" };
        if (!token) return { ok: false, reason: "missing-token" };
        const form = new URLSearchParams();
        form.set("secret", secret);
        form.set("response", token);
        const response = await fetch(verifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        });
        if (!response.ok) return { ok: false, reason: "provider-http-error" };
        const body = await response.json().catch(() => null) as { success?: unknown } | null;
        return { ok: body?.success === true, reason: body?.success === true ? undefined : "provider-rejected" };
      },
    };
  }

  return {
    name: "off",
    available: false,
    async verify() {
      return { ok: true };
    },
  };
}

export function practiceCaptchaRequired(env: EnvReader): boolean {
  return env.get("PVP_CAPTCHA_PRACTICE_QUEUE_REQUIRED") === "true";
}

export async function verifyCaptchaOrThrow(
  provider: CaptchaProvider,
  token: string | null | undefined,
  context: CaptchaContext,
): Promise<void> {
  if (!token) throw new Error("CAPTCHA required");
  const result = await provider.verify(token, context);
  if (!result.ok) throw new Error("CAPTCHA verification failed");
}

export async function verifyWalletSignatureProof(request: WalletProofRequest): Promise<boolean> {
  const message = walletProofMessage({
    action: request.action,
    sessionId: request.sessionId,
    gameId: request.gameId ?? null,
    nonce: request.nonce,
    expiresAt: request.expiresAt,
  });
  if (isAddress(request.walletAddress)) {
    const signature = bytesToHex(decodeBase64Signature(request.signature));
    return verifyMessage({
      address: request.walletAddress,
      message: { raw: new TextEncoder().encode(message) },
      signature,
    });
  }

  const walletBytes = arrayBufferBacked(base58Decode(request.walletAddress));
  if (walletBytes.length !== 32) return false;

  const signatureBytes = arrayBufferBacked(decodeBase64Signature(request.signature));
  if (signatureBytes.length !== 64) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    walletBytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signatureBytes,
    new TextEncoder().encode(message),
  );
}

export async function verifyWalletProofWithNonceStore(
  request: WalletProofRequest,
  store: WalletProofNonceStore,
): Promise<boolean> {
  const signatureOk = await verifyWalletSignatureProof(request).catch(() => false);
  if (!signatureOk) return false;
  return store.consume(request);
}
