import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  crawlNpmArgs,
  runDailyCrawl,
  sanitizeIssueBody,
} from "../scripts/daily-crawl.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures");

const cabify = {
  name: "Cabify",
  domain: "cabify.com",
  ats: "greenhouse",
  board: "cabify",
  hq_country: "ES",
  via: "hand",
  startup_gate: { evidence: "hand" },
};

const lodgify = {
  name: "Lodgify",
  domain: "lodgify.com",
  ats: "lever",
  board: "lodgify",
  hq_country: "ES",
  via: "hand",
  startup_gate: { evidence: "hand" },
};

test("a scheduled run crawls the kept boards and rewrites jobs.json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "daily-crawl-"));
  const seedPath = join(dir, "hand.json");
  const out = join(dir, "jobs.json");
  const directoryOut = join(dir, "directory.json");
  writeFileSync(seedPath, `${JSON.stringify([cabify, lodgify], null, 2)}\n`);
  writeFileSync(out, "[]\n");

  const committed = [];
  const issues = [];
  await runDailyCrawl({
    argv: [
      "--fixture-dir",
      fixtureDir,
      "--seed",
      seedPath,
      "--out",
      out,
      "--directory-out",
      directoryOut,
    ],
    gitCommit: async (files) => {
      committed.push(files);
    },
    openIssue: async (issue) => {
      issues.push(issue);
    },
  });

  const written = JSON.parse(readFileSync(out, "utf8"));
  assert.ok(written.some((role) => role.ats === "greenhouse" && role.board === "cabify"));
  assert.ok(written.some((role) => role.ats === "lever" && role.board === "lodgify"));
  assert.ok(written.length >= 2);
  assert.deepEqual(issues, []);
  assert.deepEqual(committed, [["data/jobs.json", "data/directory.json"]]);
});

test("the droplet schedule invokes npm run crawl -- --hand --live", () => {
  assert.deepEqual(crawlNpmArgs({ live: true }), ["run", "crawl", "--", "--hand", "--live"]);
  assert.deepEqual(crawlNpmArgs({ fixtureDir: "tests/fixtures" }), [
    "run",
    "crawl",
    "--",
    "--hand",
    "--fixture-dir",
    "tests/fixtures",
  ]);
});

test("a failed crawl opens a GitHub issue and does not print secrets", async () => {
  const issues = [];
  await assert.rejects(
    () =>
      runDailyCrawl({
        crawl: async () => {
          throw new Error("boom DATA_KEY=supersecret cursor=abc hire@example.com");
        },
        gitCommit: async () => {
          throw new Error("should not commit after failure");
        },
        openIssue: async (issue) => {
          issues.push(issue);
        },
      }),
    /boom/,
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, "Daily crawl failed");
  assert.equal(issues[0].body.includes("supersecret"), false);
  assert.equal(issues[0].body.includes("hire@example.com"), false);
  assert.match(issues[0].body, /\[redacted\]/);
});

test("sanitizeIssueBody strips the key, contacts, and cursors", () => {
  const body = sanitizeIssueBody("fail DATA_KEY=abc123 contact=Ada cursor=xyz ada@co.com", {
    DATA_KEY: "abc123",
  });
  assert.equal(body.includes("abc123"), false);
  assert.equal(body.includes("ada@co.com"), false);
  assert.equal(body.includes("Ada"), false);
  assert.equal(body.includes("xyz"), false);
});

test("Docker cron is daily, caps crawl memory, and mounts public JSON as a volume", () => {
  const compose = readFileSync(join(root, "docker/compose.yml"), "utf8");
  const crontab = readFileSync(join(root, "docker/crontab"), "utf8");
  const dockerfile = readFileSync(join(root, "docker/Dockerfile"), "utf8");
  const wrapper = readFileSync(join(root, "scripts/daily-crawl.sh"), "utf8");

  assert.match(crontab, /\b\d{1,2} \d{1,2} \* \* \*/);
  assert.match(crontab, /daily-crawl/);
  assert.match(wrapper, /daily-crawl\.mjs/);
  assert.match(compose, /mem_limit:\s*384m/);
  assert.match(compose, /public_json:/);
  assert.doesNotMatch(compose, /cloudflared|vercel/i);
  assert.doesNotMatch(compose, /DATA_KEY/);
  assert.doesNotMatch(dockerfile, /^\s*COPY\s+.*(?:jobs|directory)\.json/m);
  assert.doesNotMatch(dockerfile, /DATA_KEY/);
});

test("GitHub Actions builds GHCR and does not crawl", () => {
  const workflow = readFileSync(join(root, ".github/workflows/image.yml"), "utf8");
  assert.match(workflow, /ghcr\.io\/nicomfe\/spain-remote-jobs-agent/);
  assert.match(workflow, /docker\/build-push-action/);
  assert.doesNotMatch(workflow, /npm run crawl|daily-crawl|--hand|--live/);
  assert.doesNotMatch(workflow, /DATA_KEY/);
  assert.doesNotMatch(workflow, /schedule:/);
});
