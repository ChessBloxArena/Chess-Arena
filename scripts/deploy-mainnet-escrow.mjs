#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const PROGRAM_SO = "target/deploy/game_escrow.so";
const PROGRAM_KEYPAIR = "target/deploy/game_escrow-keypair.json";
const LOG_PATH = "target/deploy/mainnet-deploy.log";
const MAINNET_URL = "mainnet-beta";
const DEFAULT_CLI_KEYPAIR = `${process.env.HOME}/.config/solana/id.json`;

function appleString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function osascript(lines) {
  const result = spawnSync("osascript", lines.flatMap((line) => ["-e", line]), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "User cancelled");
  return result.stdout.trim();
}

function confirmDialog(message, continueLabel = "Continue") {
  const button = osascript([
    `display dialog ${appleString(message)} buttons {"Cancel", ${appleString(continueLabel)}} default button "Cancel" with icon caution with title "Chess Arena Mainnet Deploy"`,
    "button returned of result",
  ]);
  return button === continueLabel;
}

function chooseFile(message) {
  return osascript([
    `POSIX path of (choose file with prompt ${appleString(message)})`,
  ]);
}

function promptDialog(message, { hidden = false, defaultValue = "" } = {}) {
  const hiddenClause = hidden ? " with hidden answer" : "";
  return osascript([
    `display dialog ${appleString(message)} default answer ${appleString(defaultValue)}${hiddenClause} buttons {"Cancel", "OK"} default button "OK" with title "Chess Arena Mainnet Deploy"`,
    "text returned of result",
  ]);
}

function chooseDeployerKeypair() {
  if (existsSync(DEFAULT_CLI_KEYPAIR)) {
    const button = osascript([
      `display dialog ${appleString(`Choose the deployer wallet keypair.\n\nUse Solana CLI default?\n${DEFAULT_CLI_KEYPAIR}\n\nThe keypair contents are not printed.`)} buttons {"Cancel", "Choose File", "Use CLI Default"} default button "Use CLI Default" with icon caution with title "Chess Arena Mainnet Deploy"`,
      "button returned of result",
    ]);
    if (button === "Use CLI Default") return DEFAULT_CLI_KEYPAIR;
  }

  return chooseFile("Select the deployer wallet keypair JSON. This wallet pays deployment fees and becomes upgrade authority. The key is not printed.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

function runOrThrow(command, args, options = {}) {
  const result = run(command, args, options);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function programExists(programId, rpcUrl) {
  const account = run("solana", ["account", programId, "--url", rpcUrl]);
  return account.ok;
}

function main() {
  const programSo = resolve(PROGRAM_SO);
  const programKeypair = resolve(PROGRAM_KEYPAIR);
  const logPath = resolve(LOG_PATH);
  const rpcInput = promptDialog(
    "Optional: enter a mainnet RPC URL for deployment. Leave blank to use mainnet-beta public RPC.",
    { hidden: true },
  );
  const rpcUrl = rpcInput || MAINNET_URL;

  if (!existsSync(programSo)) throw new Error(`Missing build artifact: ${programSo}`);
  if (!existsSync(programKeypair)) throw new Error(`Missing program keypair: ${programKeypair}`);

  const programId = runOrThrow("solana", ["address", "-k", programKeypair]);
  const alreadyExists = programExists(programId, rpcUrl);

  if (alreadyExists) {
    confirmDialog(
      `Escrow program ${programId} already exists on mainnet-beta.\n\nContinuing will UPGRADE the existing program and spend SOL from your deployer wallet.`,
      "Upgrade Program",
    );
  } else {
    confirmDialog(
      `Escrow program ${programId} was not found on mainnet-beta.\n\nContinuing will DEPLOY it to mainnet-beta and spend SOL from your deployer wallet.`,
      "Deploy Program",
    );
  }

  const deployerKeypair = chooseDeployerKeypair();
  if (resolve(deployerKeypair) === programKeypair) {
    throw new Error("You selected the escrow program keypair as the deployer. Select the funded deployer wallet keypair instead.");
  }
  const balance = runOrThrow("solana", ["balance", "--keypair", deployerKeypair, "--url", rpcUrl]);

  confirmDialog(
    `Final confirmation:\n\nProgram: ${programId}\nCluster: mainnet-beta\nRPC: ${rpcInput ? "custom RPC" : "public RPC"}\nDeployer balance: ${balance}\nUpgradeable: yes\n\nThis sends mainnet transactions and spends SOL.`,
    alreadyExists ? "Upgrade Now" : "Deploy Now",
  );

  mkdirSync(dirname(logPath), { recursive: true });
  const deploy = run("solana", [
    "program",
    "deploy",
    programSo,
    "--program-id",
    programKeypair,
    "--keypair",
    deployerKeypair,
    "--upgrade-authority",
    deployerKeypair,
    "--url",
    rpcUrl,
    "--use-rpc",
  ], { timeout: 10 * 60 * 1000 });

  writeFileSync(logPath, `${deploy.stdout}\n${deploy.stderr}\n`, { mode: 0o600 });
  if (!deploy.ok) {
    throw new Error(`Deployment failed. Log written to ${logPath}`);
  }

  const show = run("solana", [
    "program",
    "show",
    programId,
    "--keypair",
    deployerKeypair,
    "--url",
    rpcUrl,
  ]);
  writeFileSync(logPath, `${deploy.stdout}\n${deploy.stderr}\n\n${show.stdout}\n${show.stderr}\n`, { mode: 0o600 });

  osascript([
    `display dialog ${appleString(`Escrow deployment finished.\n\nProgram id:\n${programId}\n\nNext: run the production wager env setup popup.`)} buttons {"OK"} default button "OK" with title "Chess Arena Mainnet Deploy"`,
  ]);

  console.log(`Escrow deployment finished for ${programId}`);
  console.log(`Deployment log: ${logPath}`);
}

Promise.resolve().then(main).catch((error) => {
  const message = error instanceof Error ? error.message : "Deployment cancelled";
  try {
    osascript([
      `display dialog ${appleString(`Escrow deployment did not finish.\n\n${message}`)} buttons {"OK"} default button "OK" with icon caution with title "Chess Arena Mainnet Deploy"`,
    ]);
  } catch {
    // The user may cancel the final notice too.
  }
  console.error(`Escrow deployment did not finish: ${message}`);
  process.exit(1);
});
