import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_FIELDS,
  companiesToCrawl,
  eligibleForCrawl,
  excludedKind,
  isStruckOff,
  keepAfterCrawl,
  publishDirectory,
  startupGate,
} from "../lib/directory.js";
import {
  crawlHandDirectory,
  loadSeed,
} from "../scripts/crawl.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures");
const now = new Date("2026-11-24T12:00:00.000Z");

const cabify = {
  name: "Cabify",
  domain: "cabify.com",
  ats: "greenhouse",
  board: "cabify",
  hq_country: "ES",
  via: "hand",
  startup_gate: { evidence: "hand" },
};

const quietHand = {
  name: "Quiet Hand",
  domain: "quiet-hand.example",
  ats: "greenhouse",
  board: "quiet-hand",
  hq_country: "ES",
  via: "hand",
  startup_gate: { evidence: "hand" },
};

function contactKeys(value, path = "") {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => found.push(...contactKeys(entry, `${path}[${index}]`)));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/contact|email|recruiter|hiring_manager/i.test(key)) found.push(path ? `${path}.${key}` : key);
      found.push(...contactKeys(nested, path ? `${path}.${key}` : key));
    }
  }
  return found;
}

test("the directory lists a few dozen hand-seeded startups", () => {
  const directory = JSON.parse(readFileSync(join(root, "data/directory.json"), "utf8"));
  const seed = loadSeed();
  assert.ok(directory.length >= 24, `expected a few dozen companies, got ${directory.length}`);
  assert.equal(directory.length, seed.filter((company) => eligibleForCrawl(company, now)).length);
  for (const record of directory) {
    assert.equal(record.via, "hand");
    assert.deepEqual(record.startup_gate, { evidence: "hand" });
  }
});

test("each directory record has the required public fields", () => {
  const directory = JSON.parse(readFileSync(join(root, "data/directory.json"), "utf8"));
  assert.ok(directory.length > 0);
  for (const record of directory) {
    for (const field of PUBLIC_FIELDS) {
      assert.ok(Object.hasOwn(record, field), `${record.name} missing ${field}`);
    }
    assert.equal(typeof record.name, "string");
    assert.equal(typeof record.domain, "string");
    assert.equal(typeof record.ats, "string");
    assert.equal(typeof record.board, "string");
    assert.equal(typeof record.hq_country, "string");
    assert.equal(typeof record.open_role_count, "number");
  }
});

test("published JSON never carries hiring contacts", () => {
  const directory = JSON.parse(readFileSync(join(root, "data/directory.json"), "utf8"));
  const jobs = JSON.parse(readFileSync(join(root, "data/jobs.json"), "utf8"));
  const seed = loadSeed();
  assert.deepEqual(contactKeys(directory), []);
  assert.deepEqual(contactKeys(jobs), []);
  assert.deepEqual(contactKeys(seed), []);
});

test("via hand stays on the directory with zero qualifying roles", () => {
  assert.equal(keepAfterCrawl(quietHand, 0, now), true);
  const records = publishDirectory([quietHand], [], { now, lastCrawl: null, crawledBoards: [] });
  assert.equal(records.length, 1);
  assert.equal(records[0].open_role_count, 0);
  assert.equal(records[0].eligibility_class, null);
  assert.equal(records[0].via, "hand");
});

test("strike-off of no is permanent; a date rechecks on or after that day", () => {
  assert.equal(isStruckOff("no", now), true);
  assert.equal(isStruckOff("2099-01-01", now), true);
  assert.equal(isStruckOff("2020-01-01", now), false);
  assert.equal(isStruckOff("2026-11-24", now), false);
  assert.equal(isStruckOff(null, now), false);
});

test("the next run leaves a struck-off company off", () => {
  const struckNo = { ...cabify, name: "Gone", board: "gone", strike_off: "no" };
  const struckFuture = { ...cabify, name: "Later", board: "later", strike_off: "2099-06-01" };
  const struckPast = { ...cabify, name: "Back", board: "cabify", strike_off: "2020-01-01" };
  const seed = [struckNo, struckFuture, struckPast, quietHand];
  const crawlable = companiesToCrawl(seed, now);
  assert.deepEqual(crawlable.map((company) => company.name), ["Back", "Quiet Hand"]);
  const records = publishDirectory(seed, [], { now, crawledBoards: [] });
  assert.deepEqual(records.map((record) => record.name), ["Back", "Quiet Hand"]);
});

test("exclusion list drops a consultancy, a bank, or a subsidiary", () => {
  const consultancy = { ...quietHand, name: "Consult Co", kind: "consultancy" };
  const bank = { ...quietHand, name: "Bank Co", kind: "bank" };
  const subsidiary = { ...quietHand, name: "Sub Co", kind: "subsidiary" };
  assert.equal(excludedKind(consultancy), "consultancy");
  assert.equal(excludedKind(bank), "bank");
  assert.equal(excludedKind(subsidiary), "subsidiary");
  assert.equal(startupGate(consultancy), null);
  assert.equal(eligibleForCrawl(consultancy, now), false);
  const records = publishDirectory([consultancy, bank, subsidiary, quietHand], [], { now, crawledBoards: [] });
  assert.deepEqual(records.map((record) => record.name), ["Quiet Hand"]);
});

test("hand crawl rewrites jobs.json to qualifying roles from fixtures", async () => {
  const acme = {
    name: "Acme",
    domain: "acme.example",
    ats: "ashby",
    board: "acme",
    hq_country: "US",
    via: "hand",
    startup_gate: { evidence: "hand" },
  };
  const seed = [
    cabify,
    acme,
    quietHand,
    { ...cabify, name: "Struck", board: "struck", strike_off: "no" },
    { ...quietHand, name: "Bank Co", domain: "bank.example", board: "bank-co", kind: "bank" },
  ];
  const { roles, directory, crawled } = await crawlHandDirectory({
    seed,
    now,
    lastCrawl: "2026-11-24T12:00:00.000Z",
    fixtureDir,
  });
  const out = join(mkdtempSync(join(tmpdir(), "jobs-")), "jobs.json");
  const { writeJobs } = await import("../scripts/crawl.mjs");
  writeJobs(roles, out);
  const written = JSON.parse(readFileSync(out, "utf8"));

  assert.deepEqual(crawled.map((company) => company.board).sort(), ["acme", "cabify"]);
  assert.equal(written.length, roles.length);
  assert.ok(roles.length > 0);
  for (const role of written) {
    assert.ok(["spain-named", "eu-eea", "worldwide", "contractor"].includes(role.eligibility_class));
    assert.equal(typeof role.evidence, "string");
  }
  assert.equal(written.some((role) => role.id === "greenhouse:cabify:1002"), false);
  assert.equal(written.some((role) => role.id === "ashby:acme:bbbb-2222"), false);

  const quiet = directory.find((record) => record.name === "Quiet Hand");
  assert.equal(quiet.open_role_count, 0);
  assert.equal(quiet.last_crawl, null);
  assert.equal(directory.some((record) => record.name === "Struck"), false);
  assert.equal(directory.some((record) => record.name === "Bank Co"), false);
  const cabifyRecord = directory.find((record) => record.name === "Cabify");
  assert.ok(cabifyRecord.open_role_count >= 1);
  assert.equal(cabifyRecord.last_crawl, "2026-11-24T12:00:00.000Z");
  assert.equal(typeof cabifyRecord.eligibility_class, "string");
  assert.equal(typeof cabifyRecord.evidence, "string");
});
