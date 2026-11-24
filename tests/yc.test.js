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
import { loadYcCatalog, toYcSeed } from "../lib/yc.js";
import {
  discoverYc,
  parseArgs,
  writeDirectory,
  writeJobs,
} from "../scripts/discover-yc.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures/yc");
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
  name: "Struck YC",
  domain: "struck-yc.example",
  ats: "greenhouse",
  board: "struck-yc",
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
  return discoverYc({
    catalog: loadYcCatalog(join(fixtureDir, "companies.json")),
    seed,
    now,
    lastCrawl,
    fixtureDir,
  });
}

test("a YC company with an ATS board and a qualifying role joins the directory", async () => {
  const { directory, roles } = await runDiscovery();
  const record = directory.find((company) => company.name === "Qualifier");
  assert.ok(record, "Qualifier should be on the directory");
  assert.ok(record.open_role_count >= 1);
  assert.ok(roles.some((role) => role.board === "qualifier"));
});

test("the new record uses the same startup shape as the hand-seeded list", async () => {
  const { directory } = await runDiscovery();
  const record = directory.find((company) => company.name === "Qualifier");
  const hand = directory.find((company) => company.name === "Cabify");
  assert.ok(record);
  assert.ok(hand);
  assert.deepEqual(Object.keys(record).sort(), Object.keys(hand).sort());
  for (const field of PUBLIC_FIELDS) {
    assert.ok(Object.hasOwn(record, field), `missing ${field}`);
  }
  assert.equal(record.via, "yc");
  assert.deepEqual(record.startup_gate, { evidence: "yc" });
  assert.equal(hand.via, "hand");
  assert.deepEqual(hand.startup_gate, { evidence: "hand" });
});

test("a consultancy, a bank, or a subsidiary stays out", async () => {
  const catalog = loadYcCatalog(join(fixtureDir, "companies.json"));
  assert.equal(toYcSeed(catalog.find((row) => row.name === "Consult Co")).kind, "consultancy");
  assert.equal(toYcSeed(catalog.find((row) => row.name === "Bank Co")).kind, "bank");
  assert.equal(toYcSeed(catalog.find((row) => row.name === "Sub Co")).kind, "subsidiary");
  assert.equal(startupGate(toYcSeed(catalog.find((row) => row.name === "Consult Co"))), null);

  const { directory } = await runDiscovery();
  const names = directory.map((company) => company.name);
  assert.equal(names.includes("Consult Co"), false);
  assert.equal(names.includes("Bank Co"), false);
  assert.equal(names.includes("Sub Co"), false);
});

test("a hand strike-off is not put back", async () => {
  const { directory, crawled } = await runDiscovery();
  assert.equal(directory.some((company) => company.domain === "struck-yc.example"), false);
  assert.equal(crawled.some((company) => company.board === "struck-yc"), false);
});

test("kept YC companies pass the startup gate and have a qualifying role; stated pay stays on the job", async () => {
  const { directory, roles } = await runDiscovery();
  const out = mkdtempSync(join(tmpdir(), "yc-discover-"));
  writeJobs(roles, join(out, "jobs.json"));
  writeDirectory(directory, join(out, "directory.json"));
  const writtenDirectory = JSON.parse(readFileSync(join(out, "directory.json"), "utf8"));
  const writtenJobs = JSON.parse(readFileSync(join(out, "jobs.json"), "utf8"));

  assert.equal(writtenDirectory.some((company) => company.name === "Quiet YC"), false);
  assert.equal(writtenDirectory.some((company) => company.name === "No Board"), false);
  assert.equal(keepAfterCrawl({ via: "yc", startup_gate: { evidence: "yc" } }, 0, now), false);

  const qualifier = writtenDirectory.find((company) => company.name === "Qualifier");
  assert.equal(startupGate({ via: "yc", startup_gate: { evidence: "yc" } })?.evidence, "yc");
  assert.ok(qualifier.open_role_count >= 1);
  assert.equal(typeof qualifier.eligibility_class, "string");
  assert.deepEqual(payKeys(qualifier), []);

  const paid = writtenJobs.find((role) => role.id === "greenhouse:qualifier:5001");
  assert.deepEqual(paid.stated_pay, { min: 90000, max: 120000, currency: "EUR", period: "year" });
  assert.deepEqual(contactKeys(writtenDirectory), []);
  assert.deepEqual(contactKeys(writtenJobs), []);
});

test("a careers URL is enough to find an ATS board", async () => {
  const { directory } = await runDiscovery();
  const record = directory.find((company) => company.name === "From Url");
  assert.ok(record);
  assert.equal(record.ats, "ashby");
  assert.equal(record.board, "from-url");
  assert.equal(record.via, "yc");
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

test("discover-yc requires --live or --fixture-dir", () => {
  assert.throws(() => parseArgs([]), /live or --fixture-dir/);
  const args = parseArgs(["--fixture-dir", "tests/fixtures/yc"]);
  assert.equal(args.fixtureDir, "tests/fixtures/yc");
  assert.equal(args.live, false);
});
