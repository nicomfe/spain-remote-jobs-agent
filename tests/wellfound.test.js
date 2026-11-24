import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_FIELDS,
  keepAfterCrawl,
  startupGate,
} from "../lib/directory.js";
import {
  fetchWellfound,
  loadWellfoundCatalog,
  mergeWellfoundSeeds,
  toWellfoundSeed,
} from "../lib/wellfound.js";
import {
  discoverWellfound,
  parseArgs,
  writeDirectory,
  writeJobs,
} from "../scripts/discover-wellfound.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures/wellfound");
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

const struckHand = {
  name: "Struck WF",
  domain: "struck-wf.example",
  ats: "greenhouse",
  board: "struck-wf",
  hq_country: "US",
  via: "hand",
  startup_gate: { evidence: "hand" },
  strike_off: "no",
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

function payKeys(value, path = "") {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => found.push(...payKeys(entry, `${path}[${index}]`)));
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (/pay|salary|compensation|comp_/i.test(key)) found.push(path ? `${path}.${key}` : key);
      found.push(...payKeys(nested, path ? `${path}.${key}` : key));
    }
  }
  return found;
}

async function runDiscovery(seed = [cabify, struckHand]) {
  return discoverWellfound({
    catalog: loadWellfoundCatalog(join(fixtureDir, "companies.json")),
    seed,
    now,
    lastCrawl,
    fixtureDir,
  });
}

test("Wellfound is read by its own fetcher", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  try {
    const seeds = await fetchWellfound({ path: join(fixtureDir, "companies.json") });
    assert.ok(seeds.some((company) => company.name === "WF Qualifier" && company.via === "wellfound"));
    assert.equal(
      seeds.find((company) => company.name === "WF Qualifier").startup_gate.evidence,
      "headcount",
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("a company already in the directory is not duplicated", async () => {
  const { directory } = await runDiscovery();
  const cabifies = directory.filter((company) => company.domain === "cabify.com");
  assert.equal(cabifies.length, 1);
  assert.equal(cabifies[0].via, "hand");
  assert.equal(cabifies[0].board, "cabify");
});

test("a new company passes the same startup gate and Spain-employable judge", async () => {
  const { directory, roles } = await runDiscovery();
  const record = directory.find((company) => company.name === "WF Qualifier");
  const hand = directory.find((company) => company.name === "Cabify");
  assert.ok(record, "WF Qualifier should be on the directory");
  assert.ok(hand);
  assert.deepEqual(Object.keys(record).sort(), Object.keys(hand).sort());
  for (const field of PUBLIC_FIELDS) {
    assert.ok(Object.hasOwn(record, field), `missing ${field}`);
  }
  assert.equal(record.via, "wellfound");
  assert.equal(startupGate(record)?.evidence, "headcount");
  assert.equal(record.startup_gate.headcount, 42);
  assert.equal(record.startup_gate.url, "https://wellfound.com/company/wf-qualifier");
  assert.ok(record.open_role_count >= 1);
  assert.equal(typeof record.eligibility_class, "string");
  assert.ok(typeof record.evidence === "string" && record.evidence.length > 0);
  assert.ok(roles.some((role) => role.board === "wf-qualifier"));
});

test("the new record stores the eligibility evidence", async () => {
  const { directory } = await runDiscovery();
  const record = directory.find((company) => company.name === "WF Qualifier");
  assert.ok(record);
  assert.equal(typeof record.eligibility_class, "string");
  assert.equal(typeof record.evidence, "string");
  assert.notEqual(record.evidence, "");
});

test("fetchWellfound is exported for the twice-monthly discovery run", async () => {
  assert.equal(typeof fetchWellfound, "function");
  assert.equal(typeof mergeWellfoundSeeds, "function");
  const catalog = loadWellfoundCatalog(join(fixtureDir, "companies.json"));
  const seeds = await fetchWellfound({ records: catalog });
  const merged = mergeWellfoundSeeds([cabify], seeds);
  assert.equal(merged.filter((company) => company.domain === "cabify.com").length, 1);
});

test("a consultancy, a bank, or a subsidiary stays out", async () => {
  const catalog = loadWellfoundCatalog(join(fixtureDir, "companies.json"));
  assert.equal(toWellfoundSeed(catalog.find((row) => row.name === "Consult Co")).kind, "consultancy");
  assert.equal(toWellfoundSeed(catalog.find((row) => row.name === "Bank Co")).kind, "bank");
  assert.equal(toWellfoundSeed(catalog.find((row) => row.name === "Sub Co")).kind, "subsidiary");
  assert.equal(startupGate(toWellfoundSeed(catalog.find((row) => row.name === "Consult Co"))), null);

  const { directory } = await runDiscovery();
  const names = directory.map((company) => company.name);
  assert.equal(names.includes("Consult Co"), false);
  assert.equal(names.includes("Bank Co"), false);
  assert.equal(names.includes("Sub Co"), false);
});

test("a hand strike-off is not put back", async () => {
  const { directory, crawled } = await runDiscovery();
  assert.equal(directory.some((company) => company.domain === "struck-wf.example"), false);
  assert.equal(crawled.some((company) => company.board === "struck-wf"), false);
});

test("unknown or over-cap headcount stays out; quiet boards drop; stated pay stays on the job", async () => {
  const { directory, roles } = await runDiscovery();
  const out = mkdtempSync(join(tmpdir(), "wf-discover-"));
  writeJobs(roles, join(out, "jobs.json"));
  writeDirectory(directory, join(out, "directory.json"));
  const writtenDirectory = JSON.parse(readFileSync(join(out, "directory.json"), "utf8"));
  const writtenJobs = JSON.parse(readFileSync(join(out, "jobs.json"), "utf8"));

  assert.equal(writtenDirectory.some((company) => company.name === "Quiet WF"), false);
  assert.equal(writtenDirectory.some((company) => company.name === "No Board"), false);
  assert.equal(writtenDirectory.some((company) => company.name === "Unknown Headcount"), false);
  assert.equal(writtenDirectory.some((company) => company.name === "Too Big"), false);
  assert.equal(
    keepAfterCrawl(
      {
        via: "wellfound",
        startup_gate: { evidence: "headcount", url: "https://wellfound.com/company/x", headcount: 10 },
      },
      0,
      now,
    ),
    false,
  );

  const qualifier = writtenDirectory.find((company) => company.name === "WF Qualifier");
  assert.ok(qualifier.open_role_count >= 1);
  assert.deepEqual(payKeys(qualifier), []);

  const paid = writtenJobs.find((role) => role.id === "greenhouse:wf-qualifier:7001");
  assert.deepEqual(paid.stated_pay, { min: 90000, max: 120000, currency: "EUR", period: "year" });
  assert.deepEqual(contactKeys(writtenDirectory), []);
  assert.deepEqual(contactKeys(writtenJobs), []);
});

test("a careers URL is enough to find an ATS board", async () => {
  const { directory } = await runDiscovery();
  const record = directory.find((company) => company.name === "From Url");
  assert.ok(record);
  assert.equal(record.ats, "ashby");
  assert.equal(record.board, "wf-from-url");
  assert.equal(record.via, "wellfound");
  assert.equal(record.startup_gate.headcount, 50);
});

test("fixture discovery does not use the network", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  try {
    await runDiscovery();
  } finally {
    globalThis.fetch = previous;
  }
});

test("discover-wellfound requires --live or --fixture-dir", () => {
  assert.throws(() => parseArgs([]), /live or --fixture-dir/);
  const args = parseArgs(["--fixture-dir", "tests/fixtures/wellfound"]);
  assert.equal(args.fixtureDir, "tests/fixtures/wellfound");
  assert.equal(args.live, false);
});
