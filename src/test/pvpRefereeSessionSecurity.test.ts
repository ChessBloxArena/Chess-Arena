import { describe, expect, it } from "vitest";
import {
  browserCallableActions,
  hashSessionProof,
  normalizeRateLimitResult,
  rateLimitKeys,
  refereeRateLimits,
  requestIpFromHeaders,
  validateSessionRecord,
  type SessionSecurityRow,
} from "../../supabase/functions/pvp-referee/sessionSecurity.ts";

async function sha256Hex(value: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hashBuffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string | null | undefined, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

const sessionId = "00000000-0000-4000-8000-000000000001";
const nowMs = Date.parse("2026-06-17T00:00:00.000Z");

async function sessionRow(proof = "proof-a", overrides: Partial<SessionSecurityRow> = {}): Promise<SessionSecurityRow> {
  return {
    id: sessionId,
    session_proof_hash: await hashSessionProof(sessionId, proof, sha256Hex),
    expires_at: "2026-06-18T00:00:00.000Z",
    disabled_at: null,
    disabled_reason: null,
    ...overrides,
  };
}

describe("pvp-referee session security", () => {
  function headers(values: Record<string, string | undefined>) {
    return {
      get(name: string) {
        return values[name.toLowerCase()] ?? null;
      },
    };
  }

  it("accepts a live server-issued session proof", async () => {
    const row = await sessionRow("proof-a");
    const expectedProofHash = await hashSessionProof(sessionId, "proof-a", sha256Hex);

    expect(validateSessionRecord({
      sessionId,
      sessionProof: "proof-a",
      expectedProofHash,
      row,
      nowMs,
      timingSafeEqual,
    })).toEqual({ ok: true });
  });

  it("rejects a forged localStorage session id with no server row", async () => {
    const expectedProofHash = await hashSessionProof(sessionId, "attacker-proof", sha256Hex);

    expect(validateSessionRecord({
      sessionId,
      sessionProof: "attacker-proof",
      expectedProofHash,
      row: null,
      nowMs,
      timingSafeEqual,
    })).toEqual({ ok: false, reason: "session_not_found" });
  });

  it("rejects invalid, expired, and disabled session proofs", async () => {
    const row = await sessionRow("proof-a");
    const forgedHash = await hashSessionProof(sessionId, "proof-b", sha256Hex);

    expect(validateSessionRecord({
      sessionId,
      sessionProof: "proof-b",
      expectedProofHash: forgedHash,
      row,
      nowMs,
      timingSafeEqual,
    })).toEqual({ ok: false, reason: "invalid_session_proof" });

    expect(validateSessionRecord({
      sessionId,
      sessionProof: "proof-a",
      expectedProofHash: await hashSessionProof(sessionId, "proof-a", sha256Hex),
      row: await sessionRow("proof-a", { expires_at: "2026-06-16T23:59:59.000Z" }),
      nowMs,
      timingSafeEqual,
    })).toEqual({ ok: false, reason: "expired_session" });

    expect(validateSessionRecord({
      sessionId,
      sessionProof: "proof-a",
      expectedProofHash: await hashSessionProof(sessionId, "proof-a", sha256Hex),
      row: await sessionRow("proof-a", { disabled_at: "2026-06-17T00:00:00.000Z" }),
      nowMs,
      timingSafeEqual,
    })).toEqual({ ok: false, reason: "disabled_session" });
  });

  it("defines the Phase 2 per-action limits", () => {
    expect(refereeRateLimits.init_session).toMatchObject({ limit: 20, windowSeconds: 600 });
    expect(refereeRateLimits.submit_cpu_result).toMatchObject({ limit: 6, windowSeconds: 60 });
    expect(refereeRateLimits.list_cpu_leaderboard).toMatchObject({ limit: 30, windowSeconds: 60 });
    expect(refereeRateLimits.join_queue).toMatchObject({ limit: 10, windowSeconds: 60 });
    expect(refereeRateLimits.create_lobby).toMatchObject({ limit: 8, windowSeconds: 60 });
    expect(refereeRateLimits.list_lobbies).toMatchObject({ limit: 60, windowSeconds: 60 });
    expect(refereeRateLimits.join_lobby).toMatchObject({ limit: 20, windowSeconds: 60 });
    expect(refereeRateLimits.cancel_lobby).toMatchObject({ limit: 8, windowSeconds: 600 });
    expect(refereeRateLimits.heartbeat_lobby).toMatchObject({ limit: 6, windowSeconds: 60 });
    expect(refereeRateLimits.heartbeat).toMatchObject({ limit: 4, windowSeconds: 60 });
    expect(refereeRateLimits.move).toMatchObject({ limit: 20, windowSeconds: 60 });
    expect(refereeRateLimits.resign).toMatchObject({ limit: 3, windowSeconds: 60 });
    expect(refereeRateLimits.cancel_waiting).toMatchObject({ limit: 5, windowSeconds: 600 });
    expect(refereeRateLimits.claim_timeout).toMatchObject({ limit: 3, windowSeconds: 60 });
    expect(refereeRateLimits.request_wager_refund).toMatchObject({ limit: 3, windowSeconds: 600 });
    expect(refereeRateLimits.list_wager_recovery).toMatchObject({ limit: 10, windowSeconds: 600 });
    expect(refereeRateLimits.recover_orphaned_wager_refund).toMatchObject({ limit: 5, windowSeconds: 600 });
    expect(refereeRateLimits.prepare_wager_queue).toMatchObject({ limit: 5, windowSeconds: 300 });
    expect(refereeRateLimits.prepare_wager_lobby).toMatchObject({ limit: 5, windowSeconds: 300 });
    expect(refereeRateLimits.prepare_sponsored_wager).toMatchObject({ limit: 5, windowSeconds: 300 });
    expect(refereeRateLimits.confirm_sponsored_deposit).toMatchObject({ limit: 10, windowSeconds: 60 });
    expect(refereeRateLimits.cancel_sponsored_wager).toMatchObject({ limit: 5, windowSeconds: 600 });
    expect(refereeRateLimits.confirm_white_deposit).toMatchObject({ limit: 10, windowSeconds: 60 });
    expect(refereeRateLimits.settle_finished_wager).toMatchObject({ limit: 20, windowSeconds: 60 });
    expect(refereeRateLimits.reconcile_contest_rent).toMatchObject({ limit: 20, windowSeconds: 60 });
    expect(refereeRateLimits.reconcile_sponsored_rent).toMatchObject({ limit: 20, windowSeconds: 60 });
    expect(browserCallableActions.has("resign")).toBe(true);
    expect(browserCallableActions.has("submit_cpu_result")).toBe(true);
    expect(browserCallableActions.has("list_cpu_leaderboard")).toBe(true);
    expect(browserCallableActions.has("create_lobby")).toBe(true);
    expect(browserCallableActions.has("list_lobbies")).toBe(true);
    expect(browserCallableActions.has("join_lobby")).toBe(true);
    expect(browserCallableActions.has("cancel_lobby")).toBe(true);
    expect(browserCallableActions.has("heartbeat_lobby")).toBe(true);
    expect(browserCallableActions.has("prepare_wager_lobby")).toBe(true);
    expect(browserCallableActions.has("prepare_sponsored_wager")).toBe(true);
    expect(browserCallableActions.has("get_sponsored_wager_state")).toBe(true);
    expect(browserCallableActions.has("reconcile_contest_rent")).toBe(false);
    expect(browserCallableActions.has("reconcile_sponsored_rent")).toBe(false);
  });

  it("does not trust spoofable proxy IP headers unless explicitly enabled", () => {
    const requestHeaders = headers({
      "x-forwarded-for": "198.51.100.10, 203.0.113.20",
      "x-real-ip": "203.0.113.30",
    });

    expect(requestIpFromHeaders(requestHeaders, false)).toBeNull();
    expect(requestIpFromHeaders(requestHeaders, true)).toBe("203.0.113.30");
    expect(requestIpFromHeaders(headers({ "x-forwarded-for": "198.51.100.10, 203.0.113.20" }), true))
      .toBe("203.0.113.20");
  });

  it("normalizes rate-limit RPC responses and builds keyed buckets", () => {
    expect(normalizeRateLimitResult([{
      allowed: false,
      count: 11,
      retry_after_seconds: 42,
      window_start: "2026-06-17T00:00:00.000Z",
      blocked_until: "2026-06-17T00:00:42.000Z",
    }])).toMatchObject({
      allowed: false,
      count: 11,
      retryAfterSeconds: 42,
    });

    expect(rateLimitKeys({
      action: "move",
      sessionId,
      ipHash: "ip-hash",
      userAgentHash: "ua-hash",
      walletAddress: "wallet-a",
      gameId: "game-a",
    })).toEqual([
      `session:${sessionId}`,
    ]);
  });
});
