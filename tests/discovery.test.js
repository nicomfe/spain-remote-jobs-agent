import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadCcCatalog, loadCcIndex } from "../lib/common-crawl.js";
import { fetchWellfound, loadWellfoundCatalog } from "../lib/wellfound.js";
import { loadYcCatalog } from "../lib/yc.js";
import {
  discover,
  discoverNpmArgs,
  parseArgs,
  runDiscover,
} from "../scripts/discover.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures");
const now = new Date("2026-11-24T12:00:00.000Z");
const lastCrawl = "2026-11-24T12:00:00.000Z";

const cabify = {
  name: "Cabify",
  domain: "cabify.com",
  ats: "greenhouse",
  board: "cabify",
  hq_country: "ES",
  via: "hand",
  startup_gate: { evidence: "hand" },
};

async function runFixtureDiscovery(seed = [cabify]) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  try {
    return await discover({
      seed,
      ycCatalog: loadYcCatalog(join(fixtureDir, "yc/companies.json")),
      ccHits: loadCcIndex(join(fixtureDir, "cc/index.json")),
      ccCatalog: loadCcCatalog(join(fixtureDir, "cc/companies.json")),
      wellfoundCatalog: loadWellfoundCatalog(join(fixtureDir, "wellfound/companies.json")),
      now,
      lastCrawl,
      fixtureDir,
    });
  } finally {
    globalThis.fetch = previous;
  }
}

test("a scheduled run rediscovers boards, re-judges eligibility, and updates the directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "discover-"));
  const seedPath = join(dir, "hand.json");
  const out = join(dir, "jobs.json");
  const directoryOut = join(dir, "directory.json");
  writeFileSync(seedPath, `${JSON.stringify([cabify], null, 2)}\n`);
  writeFileSync(out, "[]\n");
  writeFileSync(directoryOut, "[]\n");

  const committed = [];
  const issues = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  try {
    await runDiscover({
      argv: ["--fixture-dir", fixtureDir, "--seed", seedPath, "--out", out, "--directory-out", directoryOut],
      gitCommit: async (files) => {
        committed.push(files);
      },
      openIssue: async (issue) => {
        issues.push(issue);
      },
    });
  } finally {
    globalThis.fetch = previous;
  }

  const directory = JSON.parse(readFileSync(directoryOut, "utf8"));
  const jobs = JSON.parse(readFileSync(out, "utf8"));
  const qualifier = directory.find((company) => company.name === "Qualifier");
  assert.ok(qualifier, "YC Qualifier should join the directory");
  assert.equal(typeof qualifier.eligibility_class, "string");
  assert.ok(typeof qualifier.evidence === "string" && qualifier.evidence.length > 0);
  assert.ok(directory.some((company) => company.name === "Small Co"));
  assert.ok(directory.some((company) => company.name === "WF Qualifier"));
  assert.equal(directory.find((company) => company.domain === "cabify.com")?.via, "hand");
  assert.ok(jobs.some((role) => role.board === "qualifier"));
  assert.ok(jobs.some((role) => role.board === "smallco"));
  assert.ok(jobs.some((role) => role.board === "wf-qualifier"));
  assert.deepEqual(issues, []);
  assert.deepEqual(committed, [["data/jobs.json", "data/directory.json"]]);
});

test("the run covers YC and Common Crawl", async () => {
  const { directory, crawled } = await runFixtureDiscovery();
  assert.ok(directory.some((company) => company.via === "yc" && company.name === "Qualifier"));
  assert.ok(directory.some((company) => company.via === "headcount" && company.name === "Small Co"));
  assert.ok(crawled.some((company) => company.via === "yc"));
  assert.ok(crawled.some((company) => company.via === "headcount"));
});

test("the scheduled run also fetches Wellfound", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  try {
    const seeds = await fetchWellfound({
      records: loadWellfoundCatalog(join(fixtureDir, "wellfound/companies.json")),
    });
    assert.ok(seeds.some((company) => company.name === "WF Qualifier" && company.via === "wellfound"));
  } finally {
    globalThis.fetch = previous;
  }

  const { directory, crawled } = await runFixtureDiscovery();
  const record = directory.find((company) => company.name === "WF Qualifier");
  assert.ok(record);
  assert.equal(record.via, "wellfound");
  assert.ok(crawled.some((company) => company.via === "wellfound" && company.board === "wf-qualifier"));
  assert.equal(directory.filter((company) => company.domain === "cabify.com").length, 1);
});

test("the droplet schedule is twice a month and invokes discovery, not GitHub Actions", () => {
  const crontab = readFileSync(join(root, "docker/crontab"), "utf8");
  const wrapper = readFileSync(join(root, "scripts/discover.sh"), "utf8");
  const workflow = readFileSync(join(root, ".github/workflows/image.yml"), "utf8");

  assert.match(crontab, /\b\d{1,2} \d{1,2} 1,15 \* \*/);
  assert.match(crontab, /discover\.sh/);
  assert.match(wrapper, /discover\.mjs/);
  assert.match(wrapper, /--live/);
  assert.doesNotMatch(workflow, /npm run discover|discover\.mjs|discover\.sh|--live/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.deepEqual(discoverNpmArgs({ live: true }), ["run", "discover", "--", "--live"]);
  assert.deepEqual(discoverNpmArgs({ fixtureDir: "tests/fixtures" }), [
    "run",
    "discover",
    "--",
    "--fixture-dir",
    "tests/fixtures",
  ]);
});

test("parseArgs requires exactly one of --live or --fixture-dir", () => {
  assert.equal(parseArgs(["--fixture-dir", "tests/fixtures"]).fixtureDir, "tests/fixtures");
  assert.equal(parseArgs(["--live"]).live, true);
  assert.throws(() => parseArgs([]), /pass exactly one of --live or --fixture-dir/);
  assert.throws(() => parseArgs(["--live", "--fixture-dir", "x"]), /pass exactly one of --live or --fixture-dir/);
});
