#!/usr/bin/env node
// The MCP server over stdio. Same `respond` as tests:
//
//     node mcp/stdio.mjs
//     node mcp/stdio.mjs path/to/directory.json path/to/jobs.json
//
// Reads directory.json and jobs.json from disk as plaintext. No network.
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadStore, parseLine, respond } from "./index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directoryPath = process.argv[2] ?? process.env.MCP_DIRECTORY ?? join(root, "data/directory.json");
const jobsPath = process.argv[3] ?? process.env.MCP_JOBS ?? join(root, "data/jobs.json");
const store = loadStore(directoryPath, jobsPath);

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const reply = await respond(store, parseLine(line));
  if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
}
