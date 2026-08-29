#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = resolve(appRoot, "dist");
const indexPath = resolve(distDir, "index.html");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".glb", "model/gltf-binary"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function start(command, args, env = process.env) {
  const child = spawn(command, args, {
    env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function cacheControl(filePath) {
  return filePath.includes(`${sep}assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    "cache-control": "no-cache",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function fileForPathname(pathname) {
  const decodedPathname = decodeURIComponent(pathname);
  if (decodedPathname.split("/").some(segment => segment.startsWith("."))) return null;
  const requestedPath = decodedPathname === "/" ? "/index.html" : decodedPathname;
  const filePath = resolve(distDir, `.${requestedPath}`);
  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) return null;
  return filePath;
}

function sendFile(req, res, filePath, status = 200) {
  const stat = statSync(filePath);
  res.writeHead(status, {
    "cache-control": cacheControl(filePath),
    "content-length": stat.size,
    "content-type": contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath)
    .on("error", () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    })
    .pipe(res);
}

function startStaticWebServer() {
  if (!existsSync(indexPath)) {
    console.error(`Missing ${indexPath}. Run npm run build before starting the web service.`);
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/health/") {
      return writeJson(res, 200, { ok: true, service: "web" });
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return writeJson(res, 405, { error: "Method not allowed" });
    }

    let url;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      return writeJson(res, 400, { error: "Bad request" });
    }

    let filePath;
    try {
      filePath = fileForPathname(url.pathname);
    } catch {
      return writeJson(res, 400, { error: "Bad request" });
    }

    if (!filePath) return writeJson(res, 403, { error: "Forbidden" });

    try {
      if (statSync(filePath).isFile()) return sendFile(req, res, filePath);
    } catch {
      if (extname(url.pathname)) return writeJson(res, 404, { error: "Not found" });
    }

    return sendFile(req, res, indexPath);
  });

  const port = Number(process.env.PORT || "4173");
  server.listen(port, "0.0.0.0", () => {
    console.error(`Chess Arena web service listening on ${server.address().port}`);
  });
}

const serviceName = process.env.RAILWAY_SERVICE_NAME ?? "";
const isSettlementWorker =
  serviceName.toLowerCase().includes("settlement-worker") ||
  process.env.CHESS_ARENA_SERVICE_ROLE === "settlement-worker";
const isSponsorSigner =
  serviceName.toLowerCase().includes("sponsor") ||
  process.env.CHESS_ARENA_SERVICE_ROLE === "sponsor-signer";

if (isSettlementWorker) {
  const legacySolana = process.env.WAGER_PAYMENT_MODE === "wsol_escrow" || process.env.WAGER_PAYMENT_MODE === "native_sol_sponsored";
  start("node", [legacySolana ? "scripts/wager-settlement-worker.mjs" : "scripts/robinhood-wager-settlement-worker.mjs"]);
} else if (isSponsorSigner) {
  start("node", ["scripts/sponsored-wager-transaction-service.mjs"]);
} else {
  startStaticWebServer();
}
