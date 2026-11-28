import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  commitTrackedFiles,
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

test("a crawl commit is pushed to origin main", () => {
  const dir = mkdtempSync(join(tmpdir(), "daily-crawl-push-"));
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const git = (args) => {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git(["init", "--bare", "-b", "main", origin]);
  git(["init", "-b", "main", repo]);
  git(["-C", repo, "config", "user.name", "spain-remote-agent"]);
  git(["-C", repo, "config", "user.email", "crawl@localhost"]);
  mkdirSync(join(repo, "data"));
  writeFileSync(join(repo, "data/jobs.json"), "[]\n");
  git(["-C", repo, "add", "data/jobs.json"]);
  git(["-C", repo, "commit", "-m", "init"]);
  git(["-C", repo, "remote", "add", "origin", origin]);
  git(["-C", repo, "push", "origin", "HEAD:main"]);
  writeFileSync(join(repo, "data/jobs.json"), "[{\"id\":\"new\"}]\n");

  commitTrackedFiles(["data/jobs.json"], {
    repo,
    env: { ...process.env, CRAWL_GIT_COMMIT: "1", GH_TOKEN: "should-not-leak" },
  });

  const log = spawnSync("git", ["--git-dir", origin, "log", "-1", "--format=%s"], { encoding: "utf8" });
  assert.equal(log.status, 0, log.stderr);
  assert.equal(log.stdout.trim(), "chore: daily crawl of kept boards");
  const shown = spawnSync("git", ["--git-dir", origin, "show", "HEAD:data/jobs.json"], { encoding: "utf8" });
  assert.equal(shown.stdout.includes("should-not-leak"), false);
  assert.match(shown.stdout, /"id":"new"/);
});

test("a crawl commit rebases onto origin main before pushing", () => {
  const dir = mkdtempSync(join(tmpdir(), "daily-crawl-rebase-"));
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const other = join(dir, "other");
  const git = (args) => {
    const result = spawnSync("git", args, { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  git(["init", "--bare", "-b", "main", origin]);
  git(["init", "-b", "main", repo]);
  git(["-C", repo, "config", "user.name", "spain-remote-agent"]);
  git(["-C", repo, "config", "user.email", "crawl@localhost"]);
  mkdirSync(join(repo, "data"));
  writeFileSync(join(repo, "data/jobs.json"), "[]\n");
  writeFileSync(join(repo, "data/hand.json"), "[]\n");
  git(["-C", repo, "add", "data/jobs.json", "data/hand.json"]);
  git(["-C", repo, "commit", "-m", "init"]);
  git(["-C", repo, "remote", "add", "origin", origin]);
  git(["-C", repo, "push", "origin", "HEAD:main"]);
  git(["clone", origin, other]);
  git(["-C", other, "config", "user.name", "spain-remote-agent"]);
  git(["-C", other, "config", "user.email", "crawl@localhost"]);
  writeFileSync(join(other, "README.md"), "ahead\n");
  git(["-C", other, "add", "README.md"]);
  git(["-C", other, "commit", "-m", "code on main"]);
  git(["-C", other, "push", "origin", "HEAD:main"]);
  writeFileSync(join(repo, "data/jobs.json"), "[{\"id\":\"new\"}]\n");
  spawnSync("rm", [join(repo, "data/hand.json")]);

  commitTrackedFiles(["data/jobs.json"], {
    repo,
    env: { ...process.env, CRAWL_GIT_COMMIT: "1" },
  });

  const log = spawnSync("git", ["--git-dir", origin, "log", "--format=%s", "-2"], { encoding: "utf8" });
  assert.equal(log.status, 0, log.stderr);
  assert.equal(log.stdout, "chore: daily crawl of kept boards\ncode on main\n");
  assert.equal(spawnSync("test", ["!", "-e", join(repo, "data/hand.json")]).status, 0);
});

test("GitHub Actions builds GHCR and does not crawl", () => {
  const workflow = readFileSync(join(root, ".github/workflows/image.yml"), "utf8");
  assert.match(workflow, /ghcr\.io\/nicomfe\/spain-remote-jobs-agent/);
  assert.match(workflow, /docker\/build-push-action/);
  assert.doesNotMatch(workflow, /npm run crawl|daily-crawl|--hand|--live/);
  assert.doesNotMatch(workflow, /DATA_KEY/);
  assert.doesNotMatch(workflow, /schedule:/);
});
