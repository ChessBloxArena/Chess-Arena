import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { once } from "node:events";
import { createHardhatRuntimeEnvironment } from "hardhat/hre";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  keccak256,
  stringToHex,
  zeroAddress,
} from "viem";
import solc from "solc";
import { verifyReleaseBackend } from "./verify-release-backend.mjs";
const out = ".local/launch-remediation";
mkdirSync(out, { recursive: true });
const task = "chessblox-wallet-qa-" + process.pid;
const docker = (...args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
let db, networkCreated = false, dbCreated = false, restCreated = false;
async function startDatabase() {
  docker("network", "create", task);
  networkCreated = true;
  docker(
    "run",
    "--rm",
    "-d",
    "--name",
    task + "-db",
    "--network",
    task,
    "--network-alias",
    "qa-db",
    "-e",
    "POSTGRES_PASSWORD=isolated-test-only",
    "postgres:17",
  );
  dbCreated = true;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      docker(
        "exec",
        task + "-db",
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      );
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert(ready, "Local PostgreSQL did not start");
  let sql =
    "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;\n";
  const migrations = readdirSync("supabase/migrations").filter((n) =>
    n.endsWith(".sql")
  ).sort();
  for (const name of migrations) {
    sql += "\n" + readFileSync("supabase/migrations/" + name, "utf8");
  }
  const migrationLog = execFileSync("docker", [
    "exec",
    "-i",
    task + "-db",
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
  ], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  writeFileSync(out + "/wallet-migrations.log", migrationLog);
  docker(
    "run",
    "--rm",
    "-d",
    "--name",
    task + "-rest",
    "--network",
    task,
    "-p",
    "127.0.0.1::3000",
    "-e",
    "PGRST_DB_URI=postgres://postgres:isolated-test-only@qa-db:5432/postgres",
    "-e",
    "PGRST_DB_SCHEMAS=public",
    "-e",
    "PGRST_DB_ANON_ROLE=anon",
    "-e",
    "PGRST_JWT_SECRET=chessblox-isolated-test-only-jwt-secret-never-production",
    "postgrest/postgrest:v12.2.12",
  );
  restCreated = true;
  const port = docker("port", task + "-rest", "3000/tcp").split(":").at(-1);
  db = { rest: "http://127.0.0.1:" + port };
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(db.rest);
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  check(
    "All current migrations applied to disposable PostgreSQL",
    migrations.length > 0,
    { count: migrations.length },
  );
}

const sourceFiles = [
  "supabase/functions/pvp-referee/deno.lock",
  "package-lock.json",
  "contracts/RobinhoodChessEscrow.sol",
  "scripts/robinhood-wager-settlement-worker.mjs",
  "scripts/robinhood-settlement-core.mjs",
  ...readdirSync("supabase/functions/pvp-referee").filter((n) =>
    /\.(ts|json)$/.test(n)
  ).map((n) => "supabase/functions/pvp-referee/" + n),
];
const sourceHashes = () =>
  Object.fromEntries(
    sourceFiles.map(
      (p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")],
    ),
  );
const initialSourceHashes = sourceHashes();
const report = {
  sourceHashes: initialSourceHashes,
  checkedAt: new Date().toISOString(),
  environment:
    "isolated local EVM + PostgreSQL + current referee + actual worker; simulated ETH only",
  checks: [],
  externalFinancialTransactions: 0,
};
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, ...(detail ? { detail } : {}) });
  console.log(name, pass ? "PASS" : "FAIL");
  assert(pass, name);
};
const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const jwt = (role) => {
  const data = encode({ alg: "HS256", typ: "JWT" }) + "." +
    encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 });
  return data + "." +
    createHmac(
      "sha256",
      "chessblox-isolated-test-only-jwt-secret-never-production",
    ).update(data).digest("base64url");
};
const serviceJwt = jwt("service_role"), anonJwt = jwt("anon");
const keys = Array.from({ length: 4 }, () => generatePrivateKey());
const accounts = keys.map((k) => privateKeyToAccount(k));
const [authority, a, b, outsider] = accounts;
const chain = defineChain({
  id: 4663,
  name: "Isolated ChessBlox QA (no real funds)",
  nativeCurrency: { name: "Simulated ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1"] } },
});
let connection, proxy, rpc, referee, miner, worker, refereeUrl;
const children = [];
async function startServer(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return "http://127.0.0.1:" + server.address().port;
}
async function dbFetch(path, method = "GET", body) {
  const r = await fetch(db.rest + "/" + path, {
    method,
    headers: {
      authorization: "Bearer " + serviceJwt,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert(r.ok, "Local database request failed " + r.status);
  return data;
}
async function runWorker(env) {
  worker = spawn(process.execPath, [
    "scripts/robinhood-wager-settlement-worker.mjs",
    "--once",
  ], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(worker);
  let log = "";
  worker.stdout.on("data", (d) => log += d);
  worker.stderr.on("data", (d) => log += d);
  const timer = setTimeout(() => worker.kill("SIGTERM"), 30000);
  const [code] = await once(worker, "exit");
  clearTimeout(timer);
  writeFileSync(out + "/local-worker.log", log);
  assert.equal(code, 0, "Worker failed; inspect local-worker.log");
}
try {
  await startDatabase();
  const runtime = await createHardhatRuntimeEnvironment({
    networks: {
      qa: {
        type: "edr-simulated",
        chainType: "l1",
        chainId: 4663,
        hardfork: "prague",
        accounts: keys.map((privateKey) => ({
          privateKey,
          balance: 10n ** 22n,
        })),
      },
    },
  });
  connection = await runtime.network.create("qa");
  const provider = connection.provider;
  const client = createPublicClient({
    chain,
    transport: custom(provider),
    cacheTime: 0,
    pollingInterval: 50,
  });
  const wallets = accounts.map((account) =>
    createWalletClient({ account, chain, transport: custom(provider) })
  );
  const wallet = (account) => wallets[accounts.indexOf(account)];
  const compiled = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: {
      "RobinhoodChessEscrow.sol": {
        content: readFileSync("contracts/RobinhoodChessEscrow.sol", "utf8"),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 500 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  })));
  assert(!(compiled.errors || []).some((e) => e.severity === "error"));
  const contract =
    compiled.contracts["RobinhoodChessEscrow.sol"].RobinhoodChessEscrow;
  const deployment = await wallet(authority).deployContract({
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
    args: [authority.address],
  });
  const deployReceipt = await client.waitForTransactionReceipt({
    hash: deployment,
  });
  assert.equal(deployReceipt.status, "success");
  const escrow = deployReceipt.contractAddress;
  rpc = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const input = JSON.parse(Buffer.concat(chunks));
      const execute = async (x) => {
        try {
          return {
            jsonrpc: "2.0",
            id: x.id,
            result: await provider.request({
              method: x.method,
              params: x.params,
            }),
          };
        } catch (e) {
          return {
            jsonrpc: "2.0",
            id: x.id,
            error: { code: Number(e.code) || -32000, message: e.message },
          };
        }
      };
      const result = Array.isArray(input)
        ? await Promise.all(input.map(execute))
        : await execute(input);
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(500);
      res.end("{}");
    }
  });
  const rpcUrl = await startServer(rpc);
  miner = setInterval(
    () => provider.request({ method: "evm_mine", params: [] }).catch(() => {}),
    500,
  );
  proxy = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const target = req.url.startsWith("/functions/v1/pvp-referee")
        ? refereeUrl
        : db.rest + req.url.replace(/^\/rest\/v1/, "");
      assert(target && new URL(target).hostname === "127.0.0.1");
      const r = await fetch(target, {
        method: req.method,
        headers: {
          authorization: req.headers.authorization || "Bearer " + anonJwt,
          apikey: req.headers.apikey || anonJwt,
          "content-type": "application/json",
          prefer: req.headers.prefer || "",
          accept: req.headers.accept || "application/json",
        },
        ...(!["GET", "HEAD"].includes(req.method)
          ? { body: Buffer.concat(chunks) }
          : {}),
      });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end("{}");
    }
  });
  const backendUrl = await startServer(proxy);
  const ready = out + "/referee-ready.json";
  if (existsSync(ready)) unlinkSync(ready);
  writeFileSync(
    out + "/referee.ts",
    `const serve=Deno.serve; Deno.serve=((handler:Deno.ServeHandler)=>serve({hostname:'127.0.0.1',port:0,onListen:a=>Deno.writeTextFileSync('${ready}',JSON.stringify(a))},handler)) as typeof Deno.serve; await import('../../supabase/functions/pvp-referee/index.ts');\n`,
  );
  const localEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    SUPABASE_URL: backendUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceJwt,
    PVP_REFEREE_SERVICE_TOKEN: "isolated-test-only-service-token",
    PVP_REFEREE_SERVICE_TOKEN_SHA256: createHash("sha256").update(
      "isolated-test-only-service-token",
    ).digest("hex"),
    PVP_WAGER_SETTLEMENT_ENABLED: "true",
    PVP_WAGER_QUEUE_ENABLED: "true",
    PVP_ROBINHOOD_MAX_STAKE_WEI: "1000000000000000",
    ROBINHOOD_RPC_URL: rpcUrl,
    ROBINHOOD_ESCROW_ADDRESS: escrow,
    ROBINHOOD_RESULT_AUTHORITY: authority.address,
    ROBINHOOD_ESCROW_DEPLOY_BLOCK: deployReceipt.blockNumber.toString(),
    PVP_AUTOMATIC_RBLX_PAYOUT_ENABLED: "false",
    ROBINHOOD_MIN_CONFIRMATIONS: "1",
    ROBINHOOD_RESULT_SIGNER_PRIVATE_KEY: keys[0],
  };
  referee = spawn("deno", [
    "run",
    "--cached-only",
    "--no-check",
    "--allow-env",
    "--allow-net=127.0.0.1",
    "--allow-read=" + out,
    "--allow-write=" + out,
    "--config",
    "supabase/functions/pvp-referee/deno.json",
    out + "/referee.ts",
  ], { env: localEnv, stdio: ["ignore", "pipe", "pipe"] });
  children.push(referee);
  let log = "";
  referee.stdout.on("data", (d) => log += d);
  referee.stderr.on("data", (d) => log += d);
  referee.on("exit", () => writeFileSync(out + "/local-referee.log", log));
  for (
    let i = 0;
    i < 150 && !existsSync(ready) && referee.exitCode === null;
    i++
  ) await new Promise((r) => setTimeout(r, 100));
  assert(
    existsSync(ready),
    "Referee startup failed; inspect local-referee.log",
  );
  refereeUrl = "http://127.0.0.1:" + JSON.parse(readFileSync(ready)).port;
  const compatibility = await verifyReleaseBackend({
    url: backendUrl,
    publicKey: anonJwt,
  });
  check(
    "New release verifier passes against migrated local backend",
    compatibility.passed,
    compatibility.checks,
  );
  async function call(session, body) {
    const r = await fetch(refereeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...session, ...body }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await r.json();
    return { status: r.status, data };
  }
  async function ok(label, session, body) {
    const r = await call(session, body);
    check(label, r.status === 200, {
      status: r.status,
      error: r.data.error,
      code: r.data.code,
    });
    return r.data;
  }
  const sessionA = await ok("Player A initializes", null, {
      action: "init_session",
    }),
    sessionB = await ok("Player B initializes", null, {
      action: "init_session",
    });
  async function proof(session, account, proofAction, gameId) {
    const r = await call(session, {
      action: "create_wallet_proof_challenge",
      proofAction,
      gameId,
      walletAddress: account.address,
    });
    assert.equal(r.status, 200, r.data.error);
    const p = r.data.walletProof;
    const sig = await account.signMessage({ message: p.message });
    return {
      walletAddress: account.address,
      walletProofNonce: p.nonce,
      walletProofExpiresAt: p.expiresAt,
      walletSignature: Buffer.from(sig.slice(2), "hex").toString("base64"),
    };
  }
  for (const [s, account] of [[sessionA, a], [sessionB, b]]) {
    await ok("Synthetic local consent saved", s, {
      action: "get_rblx_entry_quote",
      ...await proof(s, account, "get_rblx_entry_quote"),
      playTermsVersion: "2026-09-08.1",
      stockTokenEligibilityAttested: true,
      uniswapTermsAccepted: true,
    });
  }
  const stake = 10n ** 14n;
  const terms = {
    paymentMode: "robinhood_eth_escrow",
    assetKind: "native_eth",
    assetMint: zeroAddress,
    stakeRaw: stake.toString(),
    timeControl: "1+0",
  };
  async function send(account, functionName, args = [], value) {
    const hash = await wallet(account).writeContract({
      address: escrow,
      abi: contract.abi,
      functionName,
      args,
      value,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return { hash, receipt };
  }
  async function createGame() {
    const host = await ok("Host prepares match", sessionA, {
      action: "prepare_wager_lobby",
      ...terms,
      ...await proof(sessionA, a, "prepare_wager_lobby"),
    });
    assert(
      host.gameId && host.contestId,
      "Preparation response must identify the persisted match",
    );
    const key = keccak256(stringToHex(host.contestId));
    const expires = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const deposit = await send(a, "createContest", [key, expires], stake);
    const request = {
      action: "confirm_white_deposit",
      ...terms,
      gameId: host.gameId,
      escrowContestId: host.contestId,
      playerToken: host.playerToken,
      walletAddress: a.address,
      transactionSignature: deposit.hash,
    };
    await ok("Referee verifies host deposit receipt", sessionA, request);
    await ok("Host deposit confirmation is idempotent", sessionA, request);
    return { host, key, expires };
  }
  async function joinGame(game) {
    const { host, key } = game;
    const guest = await ok("Second wallet reserves opponent seat", sessionB, {
      action: "prepare_black_deposit",
      ...terms,
      gameId: host.gameId,
      escrowContestId: host.contestId,
      ...await proof(sessionB, b, "prepare_black_deposit", host.gameId),
    });
    const deposit = await send(b, "joinContest", [key], stake);
    const active = await ok(
      "Referee verifies opponent deposit and starts game",
      sessionB,
      {
        action: "confirm_black_deposit",
        ...terms,
        gameId: host.gameId,
        escrowContestId: host.contestId,
        playerToken: guest.playerToken,
        walletAddress: b.address,
        transactionSignature: deposit.hash,
      },
    );
    check(
      "Both deposits persisted",
      active.game.payment_status === "both_deposited" &&
        active.game.status === "active",
    );
    return guest;
  }
  async function claim(account, key, amount, label) {
    const before = await client.getBalance({ address: account.address });
    const { receipt } = await send(account, "claimEth", [key]);
    const after = await client.getBalance({ address: account.address });
    check(
      label,
      after - before + receipt.gasUsed * receipt.effectiveGasPrice === amount,
    );
  }
  const game = await createGame(), guest = await joinGame(game);
  let finished;
  for (
    const [ply, [from, to]] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], [
      "d8",
      "h4",
    ]].entries()
  ) {
    finished = await ok(
      "Authoritative move " + (ply + 1),
      ply % 2 ? sessionB : sessionA,
      {
        action: "move",
        gameId: game.host.gameId,
        playerToken: ply % 2 ? guest.playerToken : game.host.playerToken,
        from,
        to,
        expectedPly: ply,
        requestId: randomUUID(),
      },
    );
  }
  check(
    "Checkmate queues actual worker settlement",
    finished.game.status === "finished" && finished.game.winner === "b" &&
      finished.game.settlement_status === "pending",
  );
  await runWorker(localEnv);
  const row = (await dbFetch("pvp_games?id=eq." + game.host.gameId))[0];
  check(
    "Worker confirms settlement back into referee database",
    row.settlement_status === "settled",
    { status: row.settlement_status },
  );
  await assert.rejects(() =>
    client.simulateContract({
      account: a.address,
      address: escrow,
      abi: contract.abi,
      functionName: "claimEth",
      args: [game.key],
    })
  );
  check("Losing wallet cannot claim pot", true);
  await claim(
    b,
    game.key,
    stake * 2n,
    "Winner receives exact simulated pot after gas",
  );
  await assert.rejects(() =>
    client.simulateContract({
      account: b.address,
      address: escrow,
      abi: contract.abi,
      functionName: "claimEth",
      args: [game.key],
    })
  );
  check("Duplicate winner claim rejected", true);
  const beforeWorkerReplay = await client.getTransactionCount({
    address: authority.address,
  });
  await runWorker(localEnv);
  check(
    "Worker restart does not pay or settle twice",
    await client.getTransactionCount({ address: authority.address }) ===
      beforeWorkerReplay,
  );
  const fresh = await ok("Fresh recovery session", null, {
    action: "init_session",
  });
  const recovery = await ok(
    "Winner wallet recovers match from fresh session",
    fresh,
    {
      action: "recover_robinhood_seat",
      gameId: game.host.gameId,
      ...await proof(fresh, b, "recover_robinhood_seat", game.host.gameId),
    },
  );
  check("Recovered seat belongs to winner", recovery.color === "b");
  const cancel = await createGame();
  const beforeCancel = await client.getBalance({ address: a.address });
  const refund = await send(a, "cancelUnmatched", [cancel.key]);
  const afterCancel = await client.getBalance({ address: a.address });
  check(
    "Unmatched creator receives exact refund after gas",
    afterCancel - beforeCancel +
        refund.receipt.gasUsed * refund.receipt.effectiveGasPrice === stake,
  );
  const cancelled = await ok(
    "Referee reconciles unmatched refund receipt",
    sessionA,
    {
      action: "cancel_wager_waiting",
      ...terms,
      gameId: cancel.host.gameId,
      escrowContestId: cancel.host.contestId,
      playerToken: cancel.host.playerToken,
      transactionSignature: refund.hash,
      ...await proof(sessionA, a, "cancel_wager_waiting", cancel.host.gameId),
    },
  );
  check(
    "Cancellation is persisted",
    cancelled.game.status === "cancelled" &&
      cancelled.game.refund_status === "refunded",
  );
  const draw = await createGame(), drawGuest = await joinGame(draw);
  let drawn;
  for (
    const [ply, [from, to]] of [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
    ].entries()
  ) {
    drawn = await ok(
      "Draw repetition move " + (ply + 1),
      ply % 2 ? sessionB : sessionA,
      {
        action: "move",
        gameId: draw.host.gameId,
        playerToken: ply % 2 ? drawGuest.playerToken : draw.host.playerToken,
        from,
        to,
        expectedPly: ply,
        requestId: randomUUID(),
      },
    );
  }
  check(
    "Threefold repetition queues draw settlement",
    drawn.game.status === "finished" && drawn.game.winner === "draw",
  );
  await runWorker(localEnv);
  const drawRow = (await dbFetch("pvp_games?id=eq." + draw.host.gameId))[0];
  check(
    "Worker and referee persist draw settlement",
    drawRow.settlement_status === "settled",
  );
  await claim(a, draw.key, stake, "Draw refunds exact host stake");
  await claim(b, draw.key, stake, "Draw refunds exact opponent stake");
  const expired = await createGame();
  await joinGame(expired);
  await provider.request({
    method: "evm_setNextBlockTimestamp",
    params: [Number(expired.expires) + 1],
  });
  await provider.request({ method: "evm_mine", params: [] });
  const expiryRefund = await send(a, "refundExpired", [expired.key]);
  // Advance this local fixture's inactivity timestamp with the simulated chain clock.
  await dbFetch("pvp_games?id=eq." + expired.host.gameId, "PATCH", {
    updated_at: new Date(Date.now() - 3600000).toISOString(),
  });
  const expiryState = await ok(
    "Referee reconciles expired refund receipt",
    sessionA,
    {
      action: "request_wager_refund",
      ...terms,
      gameId: expired.host.gameId,
      escrowContestId: expired.host.contestId,
      playerToken: expired.host.playerToken,
      transactionSignature: expiryRefund.hash,
      ...await proof(sessionA, a, "request_wager_refund", expired.host.gameId),
    },
  );
  check(
    "Expiry refund persisted in recovery state",
    expiryState.game.payment_status === "refunded" &&
      expiryState.game.status === "cancelled",
  );
  await claim(a, expired.key, stake, "Expired contest refunds host");
  await claim(b, expired.key, stake, "Expired contest refunds opponent");
  check(
    "No simulated ETH remains in escrow",
    await client.getBalance({ address: escrow }) === 0n,
  );
  check(
    "Source and dependency lock remained unchanged during test",
    JSON.stringify(sourceHashes()) === JSON.stringify(initialSourceHashes),
  );
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error.shortMessage || error.message;
  console.error(report.error);
  process.exitCode = 1;
} finally {
  if (miner) clearInterval(miner);
  for (const c of children) {
    if (c.exitCode === null && !c.killed) {
      c.kill("SIGTERM");
      await once(c, "exit");
    }
  }
  for (const s of [proxy, rpc]) {
    if (s?.listening) await new Promise((r) => s.close(r));
  }
  if (connection) await connection.close();
  if (restCreated) docker("rm", "-f", task + "-rest");
  if (dbCreated) docker("rm", "-f", task + "-db");
  if (networkCreated) docker("network", "rm", task);
  writeFileSync(
    out + "/wallet-lifecycle-report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
