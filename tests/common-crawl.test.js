import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  boardsFromIndex,
  loadCcCatalog,
  loadCcIndex,
} from "../lib/common-crawl.js";
import {
  PUBLIC_FIELDS,
  keepAfterCrawl,
  startupGate,
} from "../lib/directory.js";
import { HEADCOUNT_CAP, headcountEvidence, parseHeadcount } from "../lib/headcount.js";
import {
  discoverCc,
  parseArgs,
  writeDirectory,
  writeJobs,
} from "../scripts/discover-cc.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures/cc");
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
  name: "Struck CC",
  domain: "struck-cc.example",
  ats: "greenhouse",
  board: "struck-cc",
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

async function runDiscovery(seed = [cabify, struckHand]) {
  return discoverCc({
    hits: loadCcIndex(join(fixtureDir, "index.json")),
    catalog: loadCcCatalog(join(fixtureDir, "companies.json")),
    seed,
    now,
    lastCrawl,
    fixtureDir,
  });
}

test("Common Crawl index hits become Greenhouse, Ashby, Lever, or Teamtailor boards", () => {
  const boards = boardsFromIndex(loadCcIndex(join(fixtureDir, "index.json")));
  const kinds = new Set(boards.map((board) => board.ats));
  assert.deepEqual([...kinds].sort(), ["ashby", "greenhouse", "lever", "teamtailor"]);
  assert.equal(boards.some((board) => board.ats === "workable"), false);
  assert.equal(boards.filter((board) => board.board === "smallco").length, 1);
});

test("JSON-LD and prose yield a known headcount; a range or missing figure does not", () => {
  assert.equal(parseHeadcount(readFileSync(join(fixtureDir, "about-smallco.html"), "utf8")), 80);
  assert.equal(parseHeadcount("A team of 40 building the product."), 40);
  assert.equal(parseHeadcount("We're a growing team. Come join us."), null);
  assert.equal(
    parseHeadcount('<script type="application/ld+json">{"numberOfEmployees":{"minValue":51,"maxValue":200}}</script>'),
    null,
  );
  assert.deepEqual(
    headcountEvidence("https://smallco.example/about", "80 employees"),
    { evidence: "headcount", url: "https://smallco.example/about", headcount: 80 },
  );
  assert.equal(HEADCOUNT_CAP, 200);
  assert.equal(
    startupGate({ startup_gate: { evidence: "headcount", url: "https://huge-co.example/about", headcount: 5000 } }),
    null,
  );
  assert.equal(
    startupGate({ startup_gate: { evidence: "headcount", url: "https://smallco.example/about", headcount: 200 } })?.headcount,
    200,
  );
});

test("a board found via Common Crawl joins when headcount is known and under the cap and a role qualifies", async () => {
  const { directory, roles } = await runDiscovery();
  const record = directory.find((company) => company.name === "Small Co");
  assert.ok(record, "Small Co should be on the directory");
  assert.equal(record.via, "headcount");
  assert.deepEqual(record.startup_gate, {
    evidence: "headcount",
    url: "https://smallco.example/about",
    headcount: 80,
  });
  assert.ok(record.open_role_count >= 1);
  assert.ok(roles.some((role) => role.board === "smallco"));
  assert.ok(directory.find((company) => company.ats === "ashby" && company.board === "ashby-start"));
  assert.ok(directory.find((company) => company.ats === "lever" && company.board === "lever-start"));
  assert.ok(directory.find((company) => company.ats === "teamtailor" && company.board === "smalltt.teamtailor.com"));
});

test("unknown headcount stays out; a count over the cap stays out", async () => {
  const { directory, crawled } = await runDiscovery();
  const names = directory.map((company) => company.name);
  assert.equal(names.includes("Unknown Size"), false);
  assert.equal(names.includes("Huge Co"), false);
  assert.equal(crawled.some((company) => company.board === "unknown-size"), false);
  assert.equal(crawled.some((company) => company.board === "huge-co"), false);
});

test("a startup with no qualifying role for a few weeks drops off the directory", async () => {
  const { directory } = await runDiscovery();
  assert.equal(directory.some((company) => company.name === "Quiet CC"), false);
  assert.equal(
    keepAfterCrawl(
      {
        via: "headcount",
        startup_gate: { evidence: "headcount", url: "https://quiet-cc.example/about", headcount: 90 },
      },
      0,
      now,
    ),
    false,
  );
});

test("a company marked via hand stays", async () => {
  const { directory } = await runDiscovery();
  const hand = directory.find((company) => company.name === "Cabify");
  assert.ok(hand);
  assert.equal(hand.via, "hand");
  assert.deepEqual(hand.startup_gate, { evidence: "hand" });
});

test("the run writes the same directory and leaves strike-offs off", async () => {
  const { directory, roles, crawled } = await runDiscovery();
  const out = mkdtempSync(join(tmpdir(), "cc-discover-"));
  writeJobs(roles, join(out, "jobs.json"));
  writeDirectory(directory, join(out, "directory.json"));
  const writtenDirectory = JSON.parse(readFileSync(join(out, "directory.json"), "utf8"));
  const writtenJobs = JSON.parse(readFileSync(join(out, "jobs.json"), "utf8"));

  const small = writtenDirectory.find((company) => company.name === "Small Co");
  const hand = writtenDirectory.find((company) => company.name === "Cabify");
  assert.ok(small);
  assert.ok(hand);
  assert.deepEqual(Object.keys(small).sort(), Object.keys(hand).sort());
  for (const field of PUBLIC_FIELDS) {
    assert.ok(Object.hasOwn(small, field), `missing ${field}`);
  }
  assert.equal(writtenDirectory.some((company) => company.domain === "struck-cc.example"), false);
  assert.equal(crawled.some((company) => company.board === "struck-cc"), false);
  assert.deepEqual(contactKeys(writtenDirectory), []);
  assert.deepEqual(contactKeys(writtenJobs), []);
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

test("discover-cc requires --live or --fixture-dir", () => {
  assert.throws(() => parseArgs([]), /live or --fixture-dir/);
  const args = parseArgs(["--fixture-dir", "tests/fixtures/cc"]);
  assert.equal(args.fixtureDir, "tests/fixtures/cc");
  assert.equal(args.live, false);
});
