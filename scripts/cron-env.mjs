// cron starts jobs with a clean environment, so Docker env_file values never
// reach the crawl. Copy the keys the crawl needs from pid 1, then exec.
//
//     node scripts/cron-env.mjs /app/scripts/daily-crawl.sh

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const KEYS = new Set([
  "PUBLIC_DATA_DIR",
  "PUBLIC_REPO",
  "CRAWL_GIT_COMMIT",
  "CRAWL_OPEN_ISSUE",
  "DATA_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
]);

export function applyContainerEnv(env, block) {
  const text = Buffer.isBuffer(block) ? block.toString("utf8") : String(block);
  for (const entry of text.split("\0")) {
    if (!entry) continue;
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const key = entry.slice(0, eq);
    if (!KEYS.has(key)) continue;
    env[key] = entry.slice(eq + 1);
  }
  return env;
}

function main() {
  const block = readFileSync(process.env.CRON_ENVIRON || "/proc/1/environ");
  applyContainerEnv(process.env, block);
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("cron-env: missing command\n");
    process.exit(1);
  }
  const child = spawn(args[0], args.slice(1), { stdio: "inherit", env: process.env });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
