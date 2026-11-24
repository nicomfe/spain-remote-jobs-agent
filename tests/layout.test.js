import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assertDir(relativePath) {
  const path = join(root, relativePath);
  assert.ok(existsSync(path), `missing ${relativePath}`);
  assert.ok(statSync(path).isDirectory(), `${relativePath} is not a directory`);
}

test("empty layout places exist", () => {
  assertDir("lib/ats");
  assertDir("mcp");
  assertDir("skills");
  assertDir("web");
  assertDir("tests");
  assertDir("data");

  const directoryPath = join(root, "data/directory.json");
  const jobsPath = join(root, "data/jobs.json");
  assert.ok(existsSync(directoryPath), "missing data/directory.json");
  assert.ok(existsSync(jobsPath), "missing data/jobs.json");
  assert.deepEqual(JSON.parse(readFileSync(directoryPath, "utf8")), []);
  assert.deepEqual(JSON.parse(readFileSync(jobsPath, "utf8")), []);
});
