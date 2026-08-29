#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const WEB_SERVICE = process.env.RAILWAY_WEB_SERVICE || "web";
const WORKER_SERVICE = process.env.RAILWAY_WORKER_SERVICE || "settlement-worker";
const REPO = process.env.GITHUB_REPOSITORY || "ChessBloxArena/Chess-Arena";
const BRANCH = "main";
const SUPABASE_REF = process.env.SUPABASE_PROJECT_REF;
if (!SUPABASE_REF) throw new Error("Set SUPABASE_PROJECT_REF before configuring production.");
const SUPABASE_URL = `https://${SUPABASE_REF}.supabase.co`;
const DEFAULT_RPC_URL = "https://solana-rpc.publicnode.com";
const DEFAULT_WS0L_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DEFAULT_HOLD_MINT = "Dp4pqN6R2WprUakMDdqjEdebFbNrdWRPJAeexpvYpump";
const DEFAULT_HOLD_SYMBOL = "CHESS";
const DEFAULT_HOLD_DECIMALS = "6";
const DEFAULT_HOLD_TOKEN_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const DEFAULT_HOLD_MIN_UNITS = "50000";
const DEFAULT_HOLD_MIN_RAW = "50000000000";
const DEFAULT_FEE_AUTHORITY = "11111111111111111111111111111111";

function appleString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function osascript(lines, options = {}) {
  const args = lines.flatMap((line) => ["-e", line]);
  const result = spawnSync("osascript", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "User cancelled");
  }
  return result.stdout.trim();
}

function confirmDialog(message, continueLabel = "Continue") {
  const button = osascript([
    `display dialog ${appleString(message)} buttons {"Cancel", ${appleString(continueLabel)}} default button ${appleString(continueLabel)} with icon caution with title "Chess Arena Setup"`,
    "button returned of result",
  ]);
  return button === continueLabel;
}

function promptDialog(message, { hidden = false, defaultValue = "" } = {}) {
  const hiddenClause = hidden ? " with hidden answer" : "";
  return osascript([
    `display dialog ${appleString(message)} default answer ${appleString(defaultValue)}${hiddenClause} buttons {"Cancel", "OK"} default button "OK" with title "Chess Arena Setup"`,
    "text returned of result",
  ]);
}

function chooseFile(message) {
  return osascript([
    `POSIX path of (choose file with prompt ${appleString(message)})`,
  ]);
}

function run(command, args, { input, quiet = false } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    stdio: ["pipe", quiet ? "pipe" : "inherit", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function setRailwayVar(service, key, value) {
  run("railway", [
    "variable",
    "set",
    key,
    "--stdin",
    "--service",
    service,
    "--environment",
    "production",
    "--skip-deploys",
  ], { input: value, quiet: true });
}

function setSupabaseSecrets(values) {
  const dir = mkdtempSync(join(tmpdir(), "chess-arena-supabase-secrets-"));
  const envPath = join(dir, "secrets.env");
  const contents = Object.entries(values)
    .map(([key, value]) => `${key}=${String(value).replace(/\n/g, "")}`)
    .join("\n");

  try {
    writeFileSync(envPath, `${contents}\n`, { mode: 0o600 });
    run("supabase", ["secrets", "set", "--project-ref", SUPABASE_REF, "--env-file", envPath], { quiet: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function serviceExists(name) {
  const stdout = run("railway", ["service", "list", "--json"], { quiet: true });
  const services = JSON.parse(stdout);
  return services.some((service) => service.name === name || service.id === name);
}

function ensureWorkerService() {
  if (serviceExists(WORKER_SERVICE)) return;
  confirmDialog(
    `Railway service "${WORKER_SERVICE}" does not exist yet.\n\nCreate it from ${REPO}:${BRANCH}? It may deploy once before secrets are complete, then it will be configured and redeployed.`,
    "Create Service",
  );
  run("railway", [
    "add",
    "--repo",
    REPO,
    "--branch",
    BRANCH,
    "--service",
    WORKER_SERVICE,
    "--json",
  ], { quiet: false });
}

function readResultSignerJson() {
  const filePath = chooseFile("Select the result-signer keypair JSON file. It will be sent directly to Railway secrets and not printed.");
  const raw = readFileSync(filePath, "utf8").trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 32) {
    throw new Error("Result signer keypair JSON must be an array of secret-key bytes.");
  }
  return JSON.stringify(parsed);
}

function main() {
  confirmDialog(
    "This will configure production wager environment values for Supabase and Railway.\n\nIt keeps public wager entry disabled. It will ask for sensitive values in local macOS prompts and will not print them.",
    "Start Setup",
  );

  const escrowProgramId = promptDialog("Enter the mainnet escrow program id. Cancel if the escrow program has not been deployed yet.");
  const feeAuthority = promptDialog("Enter the fee authority public key.", { defaultValue: DEFAULT_FEE_AUTHORITY });
  const assetMint = promptDialog("Enter the active wager mint.", { defaultValue: DEFAULT_WS0L_MINT });
  const assetSymbol = promptDialog("Enter the active wager symbol.", { defaultValue: "SOL" });
  const assetDecimals = promptDialog("Enter the active wager decimals.", { defaultValue: "9" });
  const holdMint = promptDialog("Enter the mint users must hold before entering SOL wagers.", { defaultValue: DEFAULT_HOLD_MINT });
  const holdSymbol = promptDialog("Enter the holder-gate token symbol.", { defaultValue: DEFAULT_HOLD_SYMBOL });
  const holdDecimals = promptDialog("Enter the holder-gate token decimals.", { defaultValue: DEFAULT_HOLD_DECIMALS });
  const holdTokenProgram = promptDialog("Enter the holder-gate token program.", { defaultValue: DEFAULT_HOLD_TOKEN_PROGRAM });
  const holdMinUnits = promptDialog("Enter the holder-gate minimum display units.", { defaultValue: DEFAULT_HOLD_MIN_UNITS });
  const holdMinRaw = promptDialog("Enter the holder-gate minimum raw units.", { defaultValue: DEFAULT_HOLD_MIN_RAW });
  const maxStakeRaw = promptDialog("Enter max stake in base units. For 0.34 SOL, use 340000000.", { defaultValue: "340000000" });
  const rpcUrlInput = promptDialog("Enter mainnet RPC URL. Leave blank to use public Solana RPC. If this contains an API key, it will be treated as a secret.", {
    hidden: true,
  });
  const rpcUrl = rpcUrlInput || DEFAULT_RPC_URL;

  const serviceRoleKey = promptDialog("Paste the Supabase service role key. It will go only to the Railway worker secret.", {
    hidden: true,
  });
  const resultSignerJson = readResultSignerJson();

  ensureWorkerService();

  const serviceToken = randomBytes(32).toString("base64url");
  const serviceTokenHash = createHash("sha256").update(serviceToken).digest("hex");

  setSupabaseSecrets({
    PVP_REFEREE_SERVICE_TOKEN_SHA256: serviceTokenHash,
    PVP_REFEREE_ALLOW_MOCK_CHAIN_VERIFICATION: "false",
    PVP_WAGER_QUEUE_ENABLED: "false",
    PVP_WAGER_SETTLEMENT_ENABLED: "true",
    PVP_WAGER_SOLANA_CLUSTER: "mainnet-beta",
    PVP_WAGER_SOLANA_RPC_URL: rpcUrl,
    PVP_WAGER_ESCROW_PROGRAM_ID: escrowProgramId,
    PVP_WAGER_ALLOWED_MINT: assetMint,
    PVP_WAGER_ASSET_SYMBOL: assetSymbol,
    PVP_WAGER_ASSET_DECIMALS: assetDecimals,
    PVP_WAGER_MAX_STAKE_RAW: maxStakeRaw,
    PVP_WAGER_HOLD_GATE_ENABLED: "true",
    PVP_WAGER_HOLD_MINT: holdMint,
    PVP_WAGER_HOLD_SYMBOL: holdSymbol,
    PVP_WAGER_HOLD_DECIMALS: holdDecimals,
    PVP_WAGER_HOLD_TOKEN_PROGRAM_ID: holdTokenProgram,
    PVP_WAGER_HOLD_MIN_UNITS: holdMinUnits,
    PVP_WAGER_HOLD_MIN_RAW: holdMinRaw,
    PVP_WAGER_GAME_ID: "chess-arena",
    PVP_WAGER_FEE_AUTHORITY: feeAuthority,
  });

  const sharedWorkerVars = {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    PVP_REFEREE_SERVICE_TOKEN: serviceToken,
    RESULT_SIGNER_KEYPAIR_JSON: resultSignerJson,
    PVP_WAGER_SOLANA_CLUSTER: "mainnet-beta",
    PVP_WAGER_SOLANA_RPC_URL: rpcUrl,
    PVP_WAGER_ESCROW_PROGRAM_ID: escrowProgramId,
    PVP_WAGER_ALLOWED_MINT: assetMint,
    PVP_WAGER_ASSET_SYMBOL: assetSymbol,
    PVP_WAGER_ASSET_DECIMALS: assetDecimals,
    PVP_WAGER_TOKEN_PROGRAM_ID: DEFAULT_TOKEN_PROGRAM,
    PVP_WAGER_HOLD_GATE_ENABLED: "true",
    PVP_WAGER_HOLD_MINT: holdMint,
    PVP_WAGER_HOLD_SYMBOL: holdSymbol,
    PVP_WAGER_HOLD_DECIMALS: holdDecimals,
    PVP_WAGER_HOLD_TOKEN_PROGRAM_ID: holdTokenProgram,
    PVP_WAGER_HOLD_MIN_UNITS: holdMinUnits,
    PVP_WAGER_HOLD_MIN_RAW: holdMinRaw,
    PVP_WAGER_GAME_ID: "chess-arena",
    PVP_WAGER_FEE_AUTHORITY: feeAuthority,
    PVP_SETTLEMENT_WORKER_LOOP: "true",
    PVP_SETTLEMENT_WORKER_INTERVAL_MS: "15000",
    NIXPACKS_START_CMD: "npm run wager:settlement-worker",
  };

  for (const [key, value] of Object.entries(sharedWorkerVars)) {
    setRailwayVar(WORKER_SERVICE, key, value);
  }

  const webVars = {
    VITE_SOLANA_CLUSTER: "mainnet-beta",
    VITE_SOLANA_RPC_URL: rpcUrl,
    VITE_WAGER_ESCROW_PROGRAM_ID: escrowProgramId,
    VITE_WAGER_ASSET_MINT: assetMint,
    VITE_WAGER_ASSET_SYMBOL: assetSymbol,
    VITE_WAGER_ASSET_DECIMALS: assetDecimals,
    VITE_WAGER_TOKEN_PROGRAM_ID: DEFAULT_TOKEN_PROGRAM,
    VITE_WAGER_HOLD_GATE_ENABLED: "true",
    VITE_WAGER_HOLD_MINT: holdMint,
    VITE_WAGER_HOLD_SYMBOL: holdSymbol,
    VITE_WAGER_HOLD_DECIMALS: holdDecimals,
    VITE_WAGER_HOLD_TOKEN_PROGRAM_ID: holdTokenProgram,
    VITE_WAGER_HOLD_MIN_UNITS: holdMinUnits,
    VITE_WAGER_HOLD_MIN_RAW: holdMinRaw,
    VITE_WAGER_GAME_ID: "chess-arena",
    VITE_WAGER_FEE_AUTHORITY: feeAuthority,
    VITE_WAGER_MAX_STAKE_UNITS: assetDecimals === "9" ? String(Number(maxStakeRaw) / 1_000_000_000) : "0.34",
    VITE_WAGER_PRESET_STAKES: assetDecimals === "9"
      ? "0.025,0.03,0.035,0.04,0.14,0.24,0.34"
      : "0.025,0.03,0.035,0.04,0.14,0.24,0.34",
    VITE_WAGER_NEW_WAGERS_ENABLED: "false",
    VITE_WAGER_REAL_ESCROW_ENABLED: "false",
  };

  for (const [key, value] of Object.entries(webVars)) {
    setRailwayVar(WEB_SERVICE, key, value);
  }

  if (confirmDialog(
    "Secrets and variables are set with wager entry still disabled.\n\nRedeploy the settlement worker now?",
    "Redeploy Worker",
  )) {
    run("railway", ["service", "redeploy", "--service", WORKER_SERVICE, "--environment", "production", "--from-source", "--yes"], {
      quiet: false,
    });
  }

  osascript([
    `display dialog ${appleString("Chess Arena production wager environment setup finished. Wager entry is still disabled until you explicitly enable the launch switches.")} buttons {"OK"} default button "OK" with title "Chess Arena Setup"`,
  ]);
}

Promise.resolve().then(main).catch((error) => {
  const message = error instanceof Error ? error.message : "Setup cancelled";
  try {
    osascript([
      `display dialog ${appleString(`Chess Arena production setup did not finish.\n\n${message}`)} buttons {"OK"} default button "OK" with icon caution with title "Chess Arena Setup"`,
    ]);
  } catch {
    // The user may have cancelled the final notice too.
  }
  console.error(`Setup did not finish: ${message}`);
  process.exit(1);
});
