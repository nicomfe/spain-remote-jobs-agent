// Publishes server.json to the MCP registry.
// Tests pass a fixture path and never hit the network. CI passes --live.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SERVER_JSON = join(ROOT, "server.json");

export function parseArgs(argv) {
  const args = { live: false, serverJson: DEFAULT_SERVER_JSON };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--live") args.live = true;
    else if (token === "--server-json") {
      i += 1;
      args.serverJson = argv[i];
    }
  }
  return args;
}

export function listingFromServer(meta) {
  const name = meta?.name;
  const version = meta?.version;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("server.json must have a name");
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("server.json must have a version");
  }
  return { name, version };
}

export function loadListing(serverJsonPath) {
  return listingFromServer(JSON.parse(readFileSync(serverJsonPath, "utf8")));
}

export function publisherArgs(serverJsonPath) {
  return ["publish", serverJsonPath];
}

function publisherBin() {
  const local = join(process.cwd(), "mcp-publisher");
  return existsSync(local) ? local : "mcp-publisher";
}

function defaultSpawn(args) {
  return spawnSync(publisherBin(), args, { encoding: "utf8" });
}

export function runPublish({ argv = [], spawnPublisher } = {}) {
  const opts = parseArgs(argv);
  const serverJson = resolve(opts.serverJson);
  const listing = loadListing(serverJson);
  if (!opts.live) {
    return { live: false, listing };
  }
  const spawn = spawnPublisher || defaultSpawn;
  const result = spawn(publisherArgs(serverJson));
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "mcp-publisher failed");
  }
  return { live: true, listing };
}

function main(argv) {
  const result = runPublish({ argv });
  process.stdout.write(`${JSON.stringify(result.listing)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
