#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = "target/deploy/game_escrow.so";
const sourceFiles = [
  "Anchor.toml",
  "programs/game-escrow/Cargo.toml",
  "programs/game-escrow/Cargo.lock",
  "programs/game-escrow/src/lib.rs",
];
const upgradeableLoaderId = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const programStateTag = 2;
const programDataStateTag = 3;
const programDataBytesOffset = 45;
const checks = [];
const warnings = [];

function repoPath(relativePath) {
  return path.join(rootDir, relativePath);
}

function read(relativePath) {
  return readFileSync(repoPath(relativePath), "utf8");
}

function check(name, passed, detail = "") {
  checks.push({ name, passed: Boolean(passed), detail });
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function boolEnv(name) {
  return ["1", "true", "yes", "on"].includes(normalize(process.env[name]));
}

function setEnv(name) {
  return String(process.env[name] ?? "").trim().length > 0;
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseSourceProgramId() {
  const match = read("programs/game-escrow/src/lib.rs").match(/declare_id!\("([^"]+)"\)/);
  return match?.[1] ?? "";
}

function parseAnchorMainnetProgramId() {
  const anchorToml = read("Anchor.toml");
  const match = anchorToml.match(/\[programs\.mainnet\][\s\S]*?game_escrow\s*=\s*"([^"]+)"/);
  return match?.[1] ?? "";
}

function redactedUrl(value) {
  try {
    const url = new URL(value);
    url.username = url.username ? "redacted" : "";
    url.password = url.password ? "redacted" : "";
    url.search = url.search ? "?redacted" : "";
    return url.toString();
  } catch {
    return "<unparseable rpc url>";
  }
}

function sponsoredSignals() {
  const signals = [];
  const browserNativeMode = normalize(process.env.VITE_WAGER_PAYMENT_MODE) === "native_sol_sponsored" ||
    normalize(process.env.VITE_WAGER_PAYMENT_MODE) === "sponsored_sol";

  if (boolEnv("PVP_SPONSORED_WAGERS_ENABLED")) signals.push("PVP_SPONSORED_WAGERS_ENABLED=true");
  if (browserNativeMode && boolEnv("VITE_WAGER_NEW_WAGERS_ENABLED")) {
    signals.push("VITE_WAGER_PAYMENT_MODE=native_sol_sponsored with VITE_WAGER_NEW_WAGERS_ENABLED=true");
  }
  if (browserNativeMode && boolEnv("VITE_WAGER_REAL_ESCROW_ENABLED")) {
    signals.push("VITE_WAGER_PAYMENT_MODE=native_sol_sponsored with VITE_WAGER_REAL_ESCROW_ENABLED=true");
  }
  if (browserNativeMode && normalize(process.env.VITE_WAGER_SPONSOR_STATUS) === "available") {
    signals.push("VITE_WAGER_PAYMENT_MODE=native_sol_sponsored with VITE_WAGER_SPONSOR_STATUS=available");
  }
  if (browserNativeMode && setEnv("VITE_WAGER_SPONSOR_SIGNER_URL")) {
    signals.push("VITE_WAGER_PAYMENT_MODE=native_sol_sponsored with VITE_WAGER_SPONSOR_SIGNER_URL set");
  }

  return signals;
}

function requireSponsoredReady() {
  return process.argv.includes("--require-sponsored-ready") ||
    boolEnv("REQUIRE_SPONSORED_PROGRAM_READY") ||
    boolEnv("CI_REQUIRE_SPONSORED_PROGRAM_READY");
}

function programIdFromEnv() {
  const browserProgramId = String(process.env.VITE_WAGER_ESCROW_PROGRAM_ID ?? "").trim();
  const refereeProgramId = String(process.env.PVP_WAGER_ESCROW_PROGRAM_ID ?? "").trim();

  if (browserProgramId && refereeProgramId && browserProgramId !== refereeProgramId) {
    check(
      "browser and referee escrow program ids match",
      false,
      `VITE_WAGER_ESCROW_PROGRAM_ID=${browserProgramId}, PVP_WAGER_ESCROW_PROGRAM_ID=${refereeProgramId}`,
    );
  } else if (browserProgramId || refereeProgramId) {
    check("browser and referee escrow program ids match", true);
  }

  return refereeProgramId || browserProgramId;
}

function assertNativeSourceShape() {
  const source = read("programs/game-escrow/src/lib.rs");
  const requiredMarkers = [
    "pub fn create_native_contest",
    "pub fn join_native_contest",
    "pub fn cancel_native_contest",
    "pub fn refund_expired_native_contest",
    "pub fn settle_native_contest",
    "pub struct NativeContest",
    "AssetKind::NativeSol",
  ];
  const missing = requiredMarkers.filter((marker) => !source.includes(marker));
  check(
    "local Anchor source contains sponsored native SOL handlers",
    missing.length === 0,
    missing.join(", "),
  );
}

function assertProgramIdsAlign(sourceProgramId, anchorProgramId, configuredProgramId) {
  check(
    "Anchor.toml mainnet program id matches declare_id",
    anchorProgramId === sourceProgramId,
    anchorProgramId === sourceProgramId ? "" : `${anchorProgramId} != ${sourceProgramId}`,
  );
  if (configuredProgramId) {
    check(
      "configured escrow program id matches local Anchor program id",
      configuredProgramId === sourceProgramId,
      configuredProgramId === sourceProgramId ? "" : `${configuredProgramId} != ${sourceProgramId}`,
    );
  }
}

function assertArtifactReady(isRequired) {
  if (!existsSync(repoPath(artifactPath))) {
    check("local game_escrow SBF artifact exists", !isRequired, `${artifactPath} is missing; run npm run solana:mainnet:build before enabling sponsored wagers`);
    return null;
  }

  const artifact = readFileSync(repoPath(artifactPath));
  check("local game_escrow SBF artifact exists", artifact.length > 0, artifact.length > 0 ? "" : `${artifactPath} is empty`);

  const artifactMtime = statSync(repoPath(artifactPath)).mtimeMs;
  const newerSourceFiles = sourceFiles.filter((relativePath) =>
    existsSync(repoPath(relativePath)) && statSync(repoPath(relativePath)).mtimeMs > artifactMtime + 1000
  );
  const fresh = newerSourceFiles.length === 0;
  if (!fresh && !isRequired) {
    warnings.push(`Local ${artifactPath} is older than ${newerSourceFiles.join(", ")}; rebuild before any sponsored launch gate.`);
  }
  if (isRequired) {
    check(
      "local game_escrow SBF artifact is fresh enough for sponsored launch",
      fresh,
      fresh ? "" : newerSourceFiles.join(", "),
    );
  }

  return artifact;
}

function parseUpgradeableProgramDataAddress(account) {
  if (!account.executable) throw new Error("program account is not executable");
  if (!account.owner.equals(upgradeableLoaderId)) {
    throw new Error(`program owner is ${account.owner.toBase58()}, not the upgradeable loader`);
  }
  if (account.data.length < 36 || account.data.readUInt32LE(0) !== programStateTag) {
    throw new Error("program account is not an upgradeable-loader Program account");
  }
  return new PublicKey(account.data.subarray(4, 36));
}

function parseProgramDataBytes(account) {
  if (!account.owner.equals(upgradeableLoaderId)) {
    throw new Error(`ProgramData owner is ${account.owner.toBase58()}, not the upgradeable loader`);
  }
  if (account.data.length < programDataBytesOffset || account.data.readUInt32LE(0) !== programDataStateTag) {
    throw new Error("account is not upgradeable-loader ProgramData");
  }
  return {
    deploymentSlot: account.data.readBigUInt64LE(4),
    bytes: account.data.subarray(programDataBytesOffset),
  };
}

function hasOnlyTrailingZeroes(bytes) {
  return bytes.every((byte) => byte === 0);
}

async function assertDeployedProgramMatchesArtifact(programId, artifact) {
  const rpcUrl = process.env.PVP_WAGER_SOLANA_RPC_URL ||
    process.env.VITE_SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  warnings.push(`Read-only RPC check used ${redactedUrl(rpcUrl)}; no transactions were built, simulated, signed, or sent.`);

  const programAccount = await connection.getAccountInfo(programId, "confirmed");
  if (!programAccount) {
    check("configured escrow program exists on mainnet RPC", false, `${programId.toBase58()} was not found`);
    return;
  }
  check("configured escrow program exists on mainnet RPC", true, programId.toBase58());

  let programDataAddress;
  try {
    programDataAddress = parseUpgradeableProgramDataAddress(programAccount);
    check("configured escrow program is inspectable upgradeable program", true, programDataAddress.toBase58());
  } catch (error) {
    check("configured escrow program is inspectable upgradeable program", false, error instanceof Error ? error.message : String(error));
    return;
  }

  const programDataAccount = await connection.getAccountInfo(programDataAddress, "confirmed");
  if (!programDataAccount) {
    check("configured escrow ProgramData account exists", false, programDataAddress.toBase58());
    return;
  }

  let programData;
  try {
    programData = parseProgramDataBytes(programDataAccount);
    check("configured escrow ProgramData account is readable", true, `slot ${programData.deploymentSlot.toString()}`);
  } catch (error) {
    check("configured escrow ProgramData account is readable", false, error instanceof Error ? error.message : String(error));
    return;
  }

  if (programData.bytes.length < artifact.length) {
    check(
      "deployed escrow bytes match local game_escrow SBF artifact",
      false,
      `deployed program data is smaller (${programData.bytes.length} bytes) than ${artifactPath} (${artifact.length} bytes)`,
    );
    return;
  }

  const deployedPrefix = programData.bytes.subarray(0, artifact.length);
  const trailingBytes = programData.bytes.subarray(artifact.length);
  const localHash = hash(artifact);
  const deployedHash = hash(deployedPrefix);
  const trailingZeroes = hasOnlyTrailingZeroes(trailingBytes);

  check(
    "deployed escrow bytes match local game_escrow SBF artifact",
    deployedHash === localHash,
    `deployed=${deployedHash.slice(0, 16)} local=${localHash.slice(0, 16)}`,
  );
  check(
    "deployed ProgramData has no nonzero bytes after local artifact length",
    trailingZeroes,
    trailingZeroes ? "" : "program data contains nonzero bytes after the local artifact length",
  );
}

async function main() {
  const required = requireSponsoredReady();
  const signals = sponsoredSignals();
  const sponsoredEnabled = required || signals.length > 0;
  const sourceProgramId = parseSourceProgramId();
  const anchorProgramId = parseAnchorMainnetProgramId();
  const envProgramId = programIdFromEnv();
  const configuredProgramId = envProgramId || sourceProgramId;

  assertNativeSourceShape();
  assertProgramIdsAlign(sourceProgramId, anchorProgramId, configuredProgramId);

  const artifact = assertArtifactReady(sponsoredEnabled);

  if (!sponsoredEnabled) {
    warnings.push("Sponsored native SOL mode is not enabled in this shell; skipping deployed-program byte comparison.");
  } else {
    if (signals.length) warnings.push(`Sponsored native SOL enabled signal(s): ${signals.join("; ")}.`);
    if (!envProgramId) warnings.push("No escrow program id was provided in this shell; falling back to local declare_id for the read-only check.");

    let programId;
    try {
      programId = new PublicKey(configuredProgramId);
      check("configured escrow program id is a valid public key", true, programId.toBase58());
    } catch {
      check("configured escrow program id is a valid public key", false, configuredProgramId || "<missing>");
    }

    if (programId && artifact) await assertDeployedProgramMatchesArtifact(programId, artifact);
  }

  for (const item of checks) {
    const marker = item.passed ? "PASS" : "FAIL";
    console.log(`${marker} ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
  }

  if (warnings.length) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }

  const failed = checks.filter((item) => !item.passed);
  if (failed.length) {
    console.error(`\nSponsored program readiness gate failed: ${failed.length} issue(s).`);
    console.error("Do not enable native_sol_sponsored until this passes against the intended mainnet program id.");
    process.exitCode = 1;
  } else if (sponsoredEnabled) {
    console.log("\nSponsored program readiness gate passed.");
  } else {
    console.log("\nSponsored program readiness gate passed for local repo checks; deployed-program check skipped because sponsored mode is off.");
  }
}

main().catch((error) => {
  console.error(`Sponsored program readiness gate failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
