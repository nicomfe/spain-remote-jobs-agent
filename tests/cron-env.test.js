import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("cron jobs load the container output directory", () => {
  const crontab = readFileSync(join(root, "docker/crontab"), "utf8");
  assert.match(crontab, /^0 4 \* \* \* .*cron-env\.mjs .*daily-crawl\.sh$/m);
  assert.match(crontab, /^0 5 1,15 \* \* .*cron-env\.mjs .*discover\.sh$/m);

  const dir = mkdtempSync(join(tmpdir(), "cron-env-"));
  const envFile = join(dir, "environ");
  writeFileSync(
    envFile,
    Buffer.from("PUBLIC_DATA_DIR=/repo/data\0PUBLIC_REPO=/repo\0DATA_KEY=ab=cd\0OTHER=no\0"),
  );
  const env = { ...process.env, CRON_ENVIRON: envFile, PUBLIC_DATA_DIR: "/app/data" };
  delete env.OTHER;
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts/cron-env.mjs"),
      process.execPath,
      "-e",
      "process.stdout.write(JSON.stringify({dir:process.env.PUBLIC_DATA_DIR,repo:process.env.PUBLIC_REPO,key:process.env.DATA_KEY,other:Object.hasOwn(process.env,'OTHER')}))",
    ],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    dir: "/repo/data",
    repo: "/repo",
    key: "ab=cd",
    other: false,
  });
});
