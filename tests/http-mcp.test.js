import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startHttpServer } from "../mcp/http.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let server;
let port;

function call(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "http-mcp-"));
  const directoryPath = join(dir, "directory.json");
  const jobsPath = join(dir, "jobs.json");
  writeFileSync(directoryPath, "[]\n");
  writeFileSync(jobsPath, "[]\n");
  ({ server, port } = await startHttpServer({ directoryPath, jobsPath, port: 0 }));
});

after(() => new Promise((resolve) => server.close(resolve)));

test("POST /mcp lists only find_jobs and get_startup", async () => {
  const res = await call("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^application\/json/);
  const names = JSON.parse(res.text).result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["find_jobs", "get_startup"]);
});

test("POST /mcp answers a JSON-RPC batch with a JSON array", async () => {
  const res = await call("POST", "/mcp", [
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { jsonrpc: "2.0", id: 2, method: "ping" },
  ]);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.text).length, 2);
});

test("POST /mcp tools/call job_questions is an unknown tool error", async () => {
  const res = await call("POST", "/mcp", {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "job_questions", arguments: {} },
  });
  const reply = JSON.parse(res.text);
  assert.ok(reply.error);
  assert.match(reply.error.message, /unknown tool/);
});

test("POST /mcp notification gets 202 with an empty body", async () => {
  const res = await call("POST", "/mcp", { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(res.status, 202);
  assert.equal(res.text, "");
});

test("POST /mcp invalid JSON is a JSON-RPC parse error", async () => {
  const res = await call("POST", "/mcp", "{not json");
  assert.equal(JSON.parse(res.text).error.code, -32700);
});

test("GET /mcp and DELETE /mcp are 405 with Allow: POST", async () => {
  for (const method of ["GET", "DELETE"]) {
    const res = await call(method, "/mcp");
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.allow, "POST", method);
  }
});

test("GET / serves the existing English landing page", async () => {
  const headline = readFileSync(join(root, "web/en.html"), "utf8").match(/<h1>([^<]+)<\/h1>/)[1];
  const res = await call("GET", "/");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/html/);
  assert.ok(res.text.includes(headline));
});

test("GET serves other files from web/ and rejects traversal", async () => {
  const es = await call("GET", "/es.html");
  assert.equal(es.status, 200);
  assert.equal((await call("GET", "/nope.html")).status, 404);
  for (const path of ["/../package.json", "/%2e%2e/package.json", "/..%2fpackage.json"]) {
    const res = await call("GET", path);
    assert.ok([400, 404].includes(res.status), `${path} -> ${res.status}`);
    assert.equal(res.text.includes('"spain-remote-jobs-agent"'), false, path);
  }
});

test("compose publishes no ports, keeps tunnels out, and keeps private_bundle off the mcp service", () => {
  const compose = readFileSync(join(root, "docker/compose.yml"), "utf8");
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.doesNotMatch(compose, /cloudflared/i);
  assert.doesNotMatch(compose, /vercel/i);
  assert.doesNotMatch(compose, /DATA_KEY/);
  assert.match(compose, /private_bundle/);
  const mcpBlock = compose.match(/^ {2}mcp:\n((?: {4}.*\n|\n)+)/m)?.[1];
  assert.ok(mcpBlock, "mcp service exists");
  assert.doesNotMatch(mcpBlock, /private_bundle/);
  assert.doesNotMatch(mcpBlock, /env_file/);
  assert.match(mcpBlock, /\["node", "mcp\/http\.mjs"\]/);
  assert.match(compose, /\/etc\/spain-remote-agent\/crawl\.env/);
});

test("Dockerfile copies mcp and web but not the data files", () => {
  const dockerfile = readFileSync(join(root, "docker/Dockerfile"), "utf8");
  assert.match(dockerfile, /^COPY mcp\b/m);
  assert.match(dockerfile, /^COPY web\b/m);
  assert.match(dockerfile, /^COPY server\.json\b/m);
  assert.doesNotMatch(dockerfile, /^\s*COPY\s+.*(?:jobs|directory)\.json/m);
  assert.match(dockerfile, /CMD \["cron", "-f"\]/);
});

test("the image workflow and host pull script have no ssh, and the host pulls via compose", () => {
  const workflow = readFileSync(join(root, ".github/workflows/image.yml"), "utf8");
  const pull = readFileSync(join(root, "docker/host-pull.sh"), "utf8");
  assert.doesNotMatch(workflow, /ssh/i);
  assert.doesNotMatch(pull, /ssh/i);
  assert.match(pull, /compose pull/);
});
