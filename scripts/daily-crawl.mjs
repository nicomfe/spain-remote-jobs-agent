// Scheduled crawl of kept Directory boards.
// The droplet cron calls this with --live. Tests pass --fixture-dir.
// A failed crawl opens a GitHub issue; the body must not print contacts,
// cursors, or DATA_KEY. GitHub is not called unless CRAWL_OPEN_ISSUE=1.

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, runCrawl } from "./crawl.mjs";

const SECRET_ENV = ["DATA_KEY", "GH_TOKEN", "GITHUB_TOKEN"];

export function crawlNpmArgs({ live = false, fixtureDir = null } = {}) {
  if (live === Boolean(fixtureDir)) {
    throw new Error("pass exactly one of --live or --fixture-dir");
  }
  const args = ["run", "crawl", "--", "--hand"];
  if (live) args.push("--live");
  else args.push("--fixture-dir", fixtureDir);
  return args;
}

export function sanitizeIssueBody(text, env = process.env) {
  let out = String(text);
  for (const key of SECRET_ENV) {
    const value = env[key];
    if (value) out = out.split(value).join("[redacted]");
  }
  out = out.replace(/DATA_KEY\s*=\s*\S+/gi, "DATA_KEY=[redacted]");
  out = out.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]");
  out = out.replace(/\bcursors?\s*=\s*\S+/gi, "cursor=[redacted]");
  out = out.replace(/\bcontacts?\s*=\s*\S+/gi, "contact=[redacted]");
  return out;
}

function withHand(argv) {
  return argv.includes("--hand") ? [...argv] : ["--hand", ...argv];
}

function argvFromEnv(argv) {
  const next = withHand(argv);
  const dataDir = process.env.PUBLIC_DATA_DIR;
  if (dataDir && !next.includes("--out")) {
    next.push("--out", join(dataDir, "jobs.json"), "--directory-out", join(dataDir, "directory.json"));
  }
  return next;
}

function defaultGitCommit(files) {
  if (process.env.CRAWL_GIT_COMMIT !== "1") return;
  const repo = process.env.PUBLIC_REPO || ".";
  const add = spawnSync("git", ["-C", repo, "add", "--", ...files], { encoding: "utf8" });
  if (add.status !== 0) {
    throw new Error(add.stderr || add.stdout || "git add failed");
  }
  const diff = spawnSync("git", ["-C", repo, "diff", "--cached", "--quiet"], { encoding: "utf8" });
  if (diff.status === 0) return;
  const commit = spawnSync(
    "git",
    ["-C", repo, "commit", "-m", "chore: daily crawl of kept boards"],
    { encoding: "utf8" },
  );
  if (commit.status !== 0) {
    throw new Error(commit.stderr || commit.stdout || "git commit failed");
  }
}

function defaultOpenIssue(issue) {
  if (process.env.CRAWL_OPEN_ISSUE !== "1") {
    process.stderr.write(`${issue.title}\n${issue.body}\n`);
    return;
  }
  const created = spawnSync(
    "gh",
    ["issue", "create", "--title", issue.title, "--body", issue.body],
    { encoding: "utf8" },
  );
  if (created.status !== 0) {
    throw new Error(created.stderr || created.stdout || "gh issue create failed");
  }
}

export async function runDailyCrawl({
  argv = ["--live"],
  crawl,
  gitCommit = defaultGitCommit,
  openIssue = defaultOpenIssue,
} = {}) {
  try {
    if (crawl) await crawl();
    else await runCrawl(parseArgs(argvFromEnv(argv)));
    await gitCommit(["data/jobs.json", "data/directory.json"]);
  } catch (error) {
    const body = sanitizeIssueBody(error instanceof Error ? error.stack || error.message : String(error));
    await openIssue({ title: "Daily crawl failed", body });
    throw error;
  }
}

async function main(argv) {
  try {
    await runDailyCrawl({ argv: argv.length ? argv : ["--live"] });
  } catch {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
