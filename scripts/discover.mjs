// Twice-monthly discovery: rediscover YC, Common Crawl, and Wellfound boards,
// re-judge eligibility, and rewrite the public directory.
// The droplet cron calls this with --live. Tests pass --fixture-dir.
// Actions does not crawl or discover.

import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchWellfound, mergeWellfoundSeeds } from "../lib/wellfound.js";
import { sanitizeIssueBody } from "./daily-crawl.mjs";
import {
  DEFAULT_DIRECTORY,
  DEFAULT_OUT,
  DEFAULT_SEED,
  loadSeed,
  writeDirectory,
  writeJobs,
} from "./crawl.mjs";
import { discoverCc, loadCatalog as loadCcCatalog, loadIndex as loadCcIndex } from "./discover-cc.mjs";
import { discoverWellfound, loadWellfoundRows } from "./discover-wellfound.mjs";
import { discoverYc, loadCatalog as loadYcCatalog } from "./discover-yc.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export { writeDirectory, writeJobs };

export function discoverNpmArgs({ live = false, fixtureDir = null } = {}) {
  if (live === Boolean(fixtureDir)) {
    throw new Error("pass exactly one of --live or --fixture-dir");
  }
  const args = ["run", "discover", "--"];
  if (live) args.push("--live");
  else args.push("--fixture-dir", fixtureDir);
  return args;
}

export function parseArgs(argv) {
  const args = {
    live: false,
    fixtureDir: null,
    ycCatalog: null,
    ccCatalog: null,
    ccIndex: null,
    wellfoundCatalog: null,
    out: DEFAULT_OUT,
    directoryOut: DEFAULT_DIRECTORY,
    seed: DEFAULT_SEED,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${token}`);
      i += 1;
      return value;
    };
    if (token === "--live") args.live = true;
    else if (token === "--fixture-dir") args.fixtureDir = next();
    else if (token === "--yc-catalog") args.ycCatalog = next();
    else if (token === "--cc-catalog") args.ccCatalog = next();
    else if (token === "--cc-index") args.ccIndex = next();
    else if (token === "--wellfound-catalog") args.wellfoundCatalog = next();
    else if (token === "--catalog") args.ycCatalog = next();
    else if (token === "--out") args.out = next();
    else if (token === "--directory-out") args.directoryOut = next();
    else if (token === "--seed") args.seed = next();
    else throw new Error(`unknown argument: ${token}`);
  }
  if (args.live === Boolean(args.fixtureDir)) {
    throw new Error("pass exactly one of --live or --fixture-dir");
  }
  return args;
}

function resolvePath(value, root) {
  return isAbsolute(value) ? value : join(root, value);
}

function sourceDir(fixtureDir, name) {
  return fixtureDir ? join(fixtureDir, name) : null;
}

function domainKey(company) {
  return String(company?.domain || "").toLowerCase();
}

function unionByDomain(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const company of list) {
      const key = domainKey(company);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(company);
    }
  }
  return out;
}

function roleKey(role) {
  return `${role.ats}:${role.board}:${role.url || role.id || role.title}`;
}

function unionRoles(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const role of list) {
      const key = roleKey(role);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(role);
    }
  }
  return out;
}

export async function discover({
  seed = [],
  ycCatalog,
  ccHits,
  ccCatalog = [],
  wellfoundCatalog,
  now = new Date(),
  lastCrawl = now.toISOString(),
  fixtureDir = null,
  live = false,
} = {}) {
  const ycDir = sourceDir(fixtureDir, "yc");
  const ccDir = sourceDir(fixtureDir, "cc");
  const wellfoundDir = sourceDir(fixtureDir, "wellfound");

  const yc = await discoverYc({
    catalog: ycCatalog,
    seed,
    now,
    lastCrawl,
    fixtureDir: ycDir,
    live,
  });
  const cc = await discoverCc({
    hits: ccHits,
    catalog: ccCatalog,
    seed,
    now,
    lastCrawl,
    fixtureDir: ccDir,
    live,
  });

  let wellfoundRows = wellfoundCatalog;
  if (!wellfoundRows && wellfoundDir) {
    wellfoundRows = await loadWellfoundRows({ fixtureDir: wellfoundDir, live: false }, ROOT);
  }
  const wellfoundSeeds = await fetchWellfound({
    records: wellfoundRows,
    live: live && !wellfoundRows,
  });
  const wellfoundSeed = mergeWellfoundSeeds(unionByDomain(seed, yc.directory, cc.directory), wellfoundSeeds);
  const wellfound = await discoverWellfound({
    catalog: wellfoundRows ?? wellfoundSeeds,
    seed: wellfoundSeed,
    now,
    lastCrawl,
    fixtureDir: wellfoundDir,
    live,
  });

  return {
    roles: unionRoles(yc.roles, cc.roles, wellfound.roles),
    directory: unionByDomain(yc.directory, cc.directory, wellfound.directory),
    crawled: [...yc.crawled, ...cc.crawled, ...wellfound.crawled],
  };
}

function argvFromEnv(argv) {
  const next = [...argv];
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
    ["-C", repo, "commit", "-m", "chore: twice-monthly discovery"],
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

export async function runDiscover({
  argv = ["--live"],
  gitCommit = defaultGitCommit,
  openIssue = defaultOpenIssue,
  root = ROOT,
} = {}) {
  try {
    const args = parseArgs(argvFromEnv(argv));
    const fixtureRoot = args.fixtureDir ? resolvePath(args.fixtureDir, root) : null;
    const ycDir = sourceDir(fixtureRoot, "yc");
    const ccDir = sourceDir(fixtureRoot, "cc");
    const wellfoundDir = sourceDir(fixtureRoot, "wellfound");
    const seed = Array.isArray(args.seed)
      ? args.seed
      : loadSeed(isAbsolute(args.seed) ? args.seed : join(root, args.seed));

    const ycCatalog = await loadYcCatalog(
      { live: args.live, fixtureDir: ycDir, catalog: args.ycCatalog },
      root,
    );
    const ccHits = await loadCcIndex(
      { live: args.live, fixtureDir: ccDir, index: args.ccIndex },
      root,
    );
    const ccCatalog = await loadCcCatalog(
      { live: args.live, fixtureDir: ccDir, catalog: args.ccCatalog },
      root,
    );
    const wellfoundCatalog = await loadWellfoundRows(
      { live: args.live, fixtureDir: wellfoundDir, catalog: args.wellfoundCatalog },
      root,
    );

    const { roles, directory } = await discover({
      seed,
      ycCatalog,
      ccHits,
      ccCatalog,
      wellfoundCatalog,
      fixtureDir: fixtureRoot,
      live: args.live,
    });
    writeJobs(roles, isAbsolute(args.out) ? args.out : join(root, args.out));
    writeDirectory(
      directory,
      isAbsolute(args.directoryOut) ? args.directoryOut : join(root, args.directoryOut),
    );
    await gitCommit(["data/jobs.json", "data/directory.json"]);
    return { roles, directory };
  } catch (error) {
    const body = sanitizeIssueBody(error instanceof Error ? error.stack || error.message : String(error));
    await openIssue({ title: "Twice-monthly discovery failed", body });
    throw error;
  }
}

function usage() {
  return `Usage:
  node scripts/discover.mjs --fixture-dir tests/fixtures
  node scripts/discover.mjs --live
`;
}

async function main(argv) {
  try {
    const { roles } = await runDiscover({ argv: argv.length ? argv : ["--live"] });
    process.stderr.write(`wrote ${roles.length} roles\n`);
  } catch (error) {
    process.stderr.write(`${usage()}${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
