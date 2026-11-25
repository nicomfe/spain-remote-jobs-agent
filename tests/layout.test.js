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

const ROLE_FIELDS = [
  "id",
  "company",
  "title",
  "url",
  "ats",
  "board",
  "location",
  "place_class",
  "description",
  "stated_pay",
  "eligibility_class",
  "evidence",
];

test("published layout places exist", () => {
  assertDir("lib/ats");
  assertDir("mcp");
  assertDir("skills");
  assertDir("web");
  assertDir("tests");
  assertDir("data");

  const directoryPath = join(root, "data/directory.json");
  const jobsPath = join(root, "data/jobs.json");
  const seedPath = join(root, "data/hand.json");
  assert.ok(existsSync(directoryPath), "missing data/directory.json");
  assert.ok(existsSync(jobsPath), "missing data/jobs.json");
  assert.ok(existsSync(seedPath), "missing data/hand.json");
  const directory = JSON.parse(readFileSync(directoryPath, "utf8"));
  assert.ok(Array.isArray(directory));
  assert.ok(directory.length >= 24, "directory.json should list a few dozen hand-seeded startups");
  const jobs = JSON.parse(readFileSync(jobsPath, "utf8"));
  assert.ok(Array.isArray(jobs));
  assert.ok(jobs.length > 0, "jobs.json should list qualifying roles");
  for (const role of jobs) {
    for (const field of ROLE_FIELDS) {
      assert.ok(Object.hasOwn(role, field), `${role.id ?? "role"} missing ${field}`);
    }
  }
});
