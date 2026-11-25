#!/usr/bin/env node
// The read-only MCP over stateless streamable HTTP, plus the static landing in web/.
//
//     node mcp/http.mjs
//     node mcp/http.mjs path/to/directory.json path/to/jobs.json
//     PORT=8080 MCP_DIRECTORY=... MCP_JOBS=... node mcp/http.mjs
//
// POST /mcp takes one JSON-RPC object or a batch. No sessions, no apply tools.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStore, parseLine, respond } from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webDir = join(root, "web");
const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES = { ".html": "text/html; charset=utf-8" };

function send(res, status, body = "", headers = {}) {
  res.writeHead(status, { "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveMcp(store, req, res) {
  if (req.method !== "POST") {
    send(res, 405, "method not allowed\n", { allow: "POST", "content-type": "text/plain; charset=utf-8" });
    return;
  }
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    send(res, 415, "content-type must be application/json\n", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  let text;
  try {
    text = await readBody(req);
  } catch (err) {
    send(res, err.status ?? 400, "bad request\n", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  const reply = await respond(store, parseLine(text));
  if (reply === null || reply === undefined) {
    send(res, 202);
    return;
  }
  send(res, 200, JSON.stringify(reply), { "content-type": "application/json" });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "method not allowed\n", { allow: "GET, HEAD", "content-type": "text/plain; charset=utf-8" });
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    send(res, 400, "bad request\n", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  if (relative === "/") relative = "/en.html";
  if (relative.includes("\0") || relative.includes("\\") || relative.split("/").includes("..")) {
    send(res, 400, "bad request\n", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  const file = resolve(webDir, `.${relative}`);
  const extension = file.slice(file.lastIndexOf("."));
  const type = CONTENT_TYPES[extension];
  if (!file.startsWith(webDir + sep) || !type) {
    send(res, 404, "not found\n", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    send(res, 404, "not found\n", { "content-type": "text/plain; charset=utf-8" });
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": body.length });
  res.end(req.method === "HEAD" ? undefined : body);
}

export function createHttpServer(store) {
  return createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const handler = pathname === "/mcp" ? serveMcp(store, req, res) : serveStatic(req, res, pathname);
    handler.catch((err) => {
      console.error(err);
      if (!res.headersSent) send(res, 500, "internal error\n", { "content-type": "text/plain; charset=utf-8" });
      else res.end();
    });
  });
}

export function startHttpServer({ directoryPath, jobsPath, port = 8080, host = "0.0.0.0" }) {
  const server = createHttpServer(loadStore(directoryPath, jobsPath));
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveStart({ server, port: server.address().port }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directoryPath = process.argv[2] ?? process.env.MCP_DIRECTORY ?? join(root, "data/directory.json");
  const jobsPath = process.argv[3] ?? process.env.MCP_JOBS ?? join(root, "data/jobs.json");
  const port = Number(process.env.PORT ?? 8080);
  const { port: bound } = await startHttpServer({ directoryPath, jobsPath, port });
  console.error(`mcp http listening on 0.0.0.0:${bound}`);
}
