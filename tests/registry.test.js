import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runPublish } from "../scripts/publish-mcp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function writeFixture(listing) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  const serverJson = join(dir, "server.json");
  writeFileSync(serverJson, `${JSON.stringify(listing, null, 2)}\n`);
  return serverJson;
}

test("a change to server.json is published to the MCP registry", () => {
  const workflow = readFileSync(join(root, ".github/workflows/mcp-registry.yml"), "utf8");
  assert.match(workflow, /paths:[\s\S]*server\.json/);
  assert.match(workflow, /node scripts\/publish-mcp\.mjs --live/);
  assert.match(workflow, /MCP_PRIVATE_KEY: \$\{\{ secrets\.MCP_PRIVATE_KEY \}\}/);
  assert.match(workflow, /tr -d ':\[:space:\]'/);
  assert.match(
    workflow,
    /MCP_PUBLISHER_VERSION: v1\.8\.16/,
    "v1.8.1 ignores MCP_PRIVATE_KEY; login needs v1.8.16 or newer",
  );
});

test("the published name is the server name, and the published version matches server.json", () => {
  const serverJson = writeFixture({
    name: "com.example/fixture-jobs",
    version: "3.2.1",
    remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
  });
  const calls = [];
  const result = runPublish({
    argv: ["--server-json", serverJson],
    spawnPublisher: (args) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.live, false);
  assert.deepEqual(calls, []);
  assert.equal(result.listing.name, "com.example/fixture-jobs");
  assert.equal(result.listing.version, "3.2.1");
});

test("the repo listing publishes the server.json name and version", () => {
  const meta = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  const result = runPublish({ argv: [] });
  assert.equal(result.live, false);
  assert.equal(result.listing.name, meta.name);
  assert.equal(result.listing.version, meta.version);
  assert.equal(result.listing.name, "com.nicofetter/spain-remote-jobs-agent");
});

test("--live publishes that same listing through mcp-publisher", () => {
  const serverJson = writeFixture({
    name: "com.example/fixture-jobs",
    version: "3.2.1",
  });
  const calls = [];
  const result = runPublish({
    argv: ["--live", "--server-json", serverJson],
    spawnPublisher: (args) => {
      calls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(result.live, true);
  assert.equal(result.listing.name, "com.example/fixture-jobs");
  assert.equal(result.listing.version, "3.2.1");
  assert.deepEqual(calls, [["publish", serverJson]]);
});
