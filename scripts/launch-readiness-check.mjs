#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const warnings = [];

function repoPath(relativePath) {
  return path.join(rootDir, relativePath);
}

function read(relativePath) {
  return readFileSync(repoPath(relativePath), "utf8");
}

function has(relativePath, needle) {
  return read(relativePath).includes(needle);
}

function check(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail });
}

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n").filter(Boolean);
  } catch {
    warnings.push("Could not inspect tracked files because git is unavailable.");
    return [];
  }
}

const tracked = trackedFiles();
const packageJson = JSON.parse(read("package.json"));
const indexHtml = read("index.html");
const envExample = read(".env.example");
const referee = read("supabase/functions/pvp-referee/index.ts");
const sessionMigration = read("supabase/migrations/20260617025230_add_pvp_session_rate_limits.sql");
const walletProofMigration = read("supabase/migrations/20260617025301_add_pvp_wallet_proof_nonces.sql");
const safeReadsMigration = read("supabase/migrations/20260617010000_lock_down_pvp_games_public_reads.sql");
const setupProductionWagerEnv = read("scripts/setup-production-wager-env.mjs");

const forbiddenTracked = tracked.filter((relativePath) => {
  const base = path.basename(relativePath);
  if (/^\.env(?:\.|$)/.test(base) && !/^\.env\.(?:example|sample|template)$/.test(base)) return true;
  return /\.(?:pem|key|p12|pfx)$/i.test(base) || /^id_[A-Za-z0-9_-]+$/.test(base);
});
check(
  "no tracked secret-like files",
  forbiddenTracked.length === 0,
  forbiddenTracked.join(", "),
);

const browserPvpFiles = [
  "src/hooks/useOnlinePvp.ts",
  "src/lib/wagerRefereeClient.ts",
  "src/pages/Index.tsx",
  "src/pages/OnlineGame.tsx",
];
const unsafeBrowserReads = browserPvpFiles.filter((relativePath) => {
  const text = read(relativePath);
  return /from\(["']pvp_games["']\)|postgres_changes|white_session_id|black_session_id|getBaseSessionId/.test(text);
});
check(
  "browser PvP reads use referee-safe API",
  unsafeBrowserReads.length === 0,
  unsafeBrowserReads.join(", "),
);

check(
  "pvp_games base table reads revoked from browser roles",
  safeReadsMigration.includes("REVOKE SELECT") &&
    safeReadsMigration.includes("ON TABLE public.pvp_games") &&
    safeReadsMigration.includes("FROM anon, authenticated"),
);
check(
  "session, rate-limit, and abuse tables are RLS-protected",
  ["pvp_sessions", "pvp_rate_limits", "pvp_abuse_events"].every((table) =>
    sessionMigration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`) &&
    sessionMigration.includes(`REVOKE ALL ON public.${table} FROM anon, authenticated`) &&
    sessionMigration.includes(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO service_role`)
  ),
);
check(
  "wallet proof nonces are service-only and single-use",
  walletProofMigration.includes("alter table public.pvp_wallet_proof_nonces enable row level security") &&
    walletProofMigration.includes("revoke all on table public.pvp_wallet_proof_nonces from public, anon, authenticated") &&
    walletProofMigration.includes("where used_at is null") &&
    referee.includes('.is("used_at", null)'),
);
check(
  "referee supports launch-critical actions",
  ["init_session", "get_game", "create_wallet_proof_challenge", "join_queue", "move", "settle_finished_wager"].every((action) =>
    referee.includes(`"${action}"`)
  ),
);
check(
  "referee has rate-limit enforcement and 429 responses",
  referee.includes("class RateLimitError") &&
    referee.includes("pvp_consume_rate_limit") &&
    referee.includes('"Retry-After"') &&
    referee.includes("error.status"),
);
check(
  "unexpected referee failures are redacted from clients",
  referee.includes('console.error("Unexpected pvp-referee error", error)') &&
    referee.includes('return jsonResponse({ error: "Unexpected referee error" }, 500);'),
);
check(
  "mock chain verification is disabled by production setup",
  setupProductionWagerEnv.includes('PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION: "false"') &&
    referee.includes("PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION"),
);
check(
  "browser wager launch switches default off",
  envExample.includes("VITE_WAGER_NEW_WAGERS_ENABLED=false") &&
    envExample.includes("VITE_WAGER_REAL_ESCROW_ENABLED=false"),
);
check(
  "dev wallet is disabled by default",
  envExample.includes("VITE_ENABLE_DEV_WALLET=false"),
);
check(
  "favicon and social images use Chess Arena assets",
  existsSync(repoPath("public/favicon-32.png")) &&
    existsSync(repoPath("public/favicon-512.png")) &&
    existsSync(repoPath("public/favicon.ico")) &&
    indexHtml.includes("/favicon-512.png") &&
    !/lovable\.app|id-preview|pub-bb2e103a32db4e198524a2e9ed8f35b4/i.test(indexHtml),
);
check(
  "security hardening docs are present",
  existsSync(repoPath("docs/pvp-security-anti-abuse-hardening.md")) &&
    existsSync(repoPath("docs/LAUNCH_SMOKE_CHECKLIST.md")) &&
    has("docs/solana-payments/LAUNCH_CHECKLIST.md", "Approval-Gated Mainnet Actions") &&
    has("docs/solana-payments/SETTLEMENT_WORKER_RUNBOOK.md", "PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION=false"),
);
check(
  "standard launch commands are wired",
  ["lint", "test", "build", "launch:check:sponsored-program", "supabase:functions:check", "solana:escrow:test", "solana:mainnet:check"].every((scriptName) =>
    typeof packageJson.scripts?.[scriptName] === "string"
  ),
);

if (existsSync(repoPath("package-lock.json")) && existsSync(repoPath("bun.lock"))) {
  warnings.push("Both package-lock.json and bun.lock exist; use npm for this repo's launch checks unless the owner chooses otherwise.");
}

warnings.push("This local gate does not apply Supabase migrations, deploy Edge Functions, verify production secrets, enable wagers, send or simulate transactions, or prove a live two-player staging match.");

const failed = checks.filter((item) => !item.passed);
for (const item of checks) {
  const marker = item.passed ? "PASS" : "FAIL";
  console.log(`${marker} ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
}

if (warnings.length) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (failed.length) {
  console.error(`\nLaunch readiness gate failed: ${failed.length} issue(s).`);
  process.exitCode = 1;
} else {
  console.log("\nLaunch readiness gate passed for local repo checks.");
}
