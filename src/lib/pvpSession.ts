import { supabase } from "@/integrations/supabase/client";

export interface PvpSessionProof {
  sessionId: string;
  sessionProof: string;
  expiresAt: string;
  riskLevel: "low" | "medium" | "high";
  captchaRequired: boolean;
  walletProofRequired: boolean;
}

const PVP_SESSION_KEY = "chess_pvp_session_v1";
const PVP_REFEREE_FUNCTION = "pvp-referee";
let memorySession: PvpSessionProof | null = null;

function readStoredSession(): PvpSessionProof | null {
  if (typeof localStorage === "undefined") return memorySession;
  try {
    const raw = localStorage.getItem(PVP_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PvpSessionProof>;
    if (
      typeof parsed.sessionId !== "string" ||
      typeof parsed.sessionProof !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      sessionProof: parsed.sessionProof,
      expiresAt: parsed.expiresAt,
      riskLevel: parsed.riskLevel ?? "low",
      captchaRequired: parsed.captchaRequired === true,
      walletProofRequired: parsed.walletProofRequired === true,
    };
  } catch {
    return null;
  }
}

function writeStoredSession(session: PvpSessionProof): void {
  memorySession = session;
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PVP_SESSION_KEY, JSON.stringify(session));
}

function sessionIsUsable(session: PvpSessionProof | null): session is PvpSessionProof {
  if (!session) return false;
  const expiresAt = Date.parse(session.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000;
}

export function getStoredPvpSessionSync(): PvpSessionProof | null {
  const stored = readStoredSession();
  return sessionIsUsable(stored) ? stored : null;
}

export function getPvpSessionIdSync(): string {
  return getStoredPvpSessionSync()?.sessionId ?? "";
}

export function clearStoredPvpSession(): void {
  memorySession = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(PVP_SESSION_KEY);
  }
}

export function isInvalidPvpSessionError(code?: string, message?: string): boolean {
  return code === "missing_session" ||
    code === "invalid_session_id" ||
    code === "session_not_found" ||
    code === "invalid_session_proof" ||
    code === "expired_session" ||
    code === "disabled_session" ||
    message === "Invalid session proof";
}

export async function ensurePvpSession(clientVersion = "web"): Promise<PvpSessionProof> {
  const stored = readStoredSession();
  if (sessionIsUsable(stored)) return stored;

  const { data, error } = await supabase.functions.invoke(PVP_REFEREE_FUNCTION, {
    body: {
      action: "init_session",
      clientVersion,
    },
  });

  if (error) {
    let message = error.message || "Could not start PvP session";
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const responseBody = await context.clone().json();
        if (responseBody?.error) message = responseBody.error;
      } catch {
        // Keep the SDK error message when the function did not return JSON.
      }
    }
    throw new Error(message);
  }

  if (!data || typeof data !== "object" || "error" in data) {
    throw new Error(String((data as { error?: unknown } | null)?.error ?? "Could not start PvP session"));
  }

  const session = data as PvpSessionProof;
  writeStoredSession(session);
  return session;
}
