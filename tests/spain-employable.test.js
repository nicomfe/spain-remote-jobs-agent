import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CompanySchema } from "../lib/ats/domain/campaign.js";
import { adapterFor } from "../lib/ats/sources/registry.js";
import { judgeSpainEmployable } from "../lib/spain-employable.js";
import {
  crawlBoards,
  installFixtureFetch,
  loadFixturePayloads,
} from "../scripts/crawl.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures");
const greenhouse = { name: "Cabify", ats: "greenhouse", board: "cabify" };
const ashby = { name: "Acme", ats: "ashby", board: "acme" };

function withFixtures(companies, fn) {
  const restore = installFixtureFetch(loadFixturePayloads(fixtureDir, companies));
  return fn().finally(restore);
}

const SPAIN_NAMED = `Backend Engineer
Location: Remote, Spain

We are hiring a backend engineer to work remotely from Spain. This is not an office role.`;

const REMOTE_EUROPE = `Staff Engineer
Location: Remote - Europe

This role is open to candidates across Europe. You can work remotely from any European country.`;

const REMOTE_EUROPE_OMITS_SPAIN = `Staff Engineer
Location: Remote - Europe

Eligible countries: Germany, France, the Netherlands, and Italy.`;

const REMOTE_GLOBAL_INCLUDES_SPAIN = `Product Designer
Location: Remote

This is a remote-global role. We hire worldwide, including Spain.`;

const REMOTE_GLOBAL_BARE = `Product Designer
Location: Remote

Join a fully remote team. Work from anywhere you like.`;

const CONTRACTOR_DEEL = `Full Stack Engineer
Location: Remote

Employment via Deel. You invoice as a contractor; we do not run a local entity.`;

const CONTRACTOR_REMOTE_COM = `Full Stack Engineer
Location: Remote

You will be employed through Remote.com as a contractor in your country of residence.`;

const CONTRACTOR_AUTONOMO = `Full Stack Engineer
Location: Remote

Contratación como autónomo. Facturas mensuales, sin contrato laboral.`;

const US_ONLY = `Account Executive
Location: Remote - United States

This role is US-only. Candidates must be authorized to work in the United States.`;

const COUNTRY_LIST_OMITS_SPAIN = `Solutions Engineer
Location: Remote

You can work from the United Kingdom, Germany, France, or Portugal.`;

const ONSITE_SPAIN_OFFICE = `Office Manager
Location: Madrid, Spain

This role is based in our Madrid office. You will work on-site at the Spain office five days a week.`;

test("A role that names Spain as a remote place is kept as spain-named", () => {
  const result = judgeSpainEmployable({ place_class: "remote-spain", text: SPAIN_NAMED });
  assert.equal(result.eligibility_class, "spain-named");
  assert.match(result.evidence, /Remote, Spain/);
  assert.ok(SPAIN_NAMED.includes(result.evidence) || /Remote, Spain/.test(result.evidence));
});

test("A role whose place class is remote-europe is kept as eu-eea when the text does not leave Spain out", () => {
  const result = judgeSpainEmployable({ place_class: "remote-europe", text: REMOTE_EUROPE });
  assert.equal(result.eligibility_class, "eu-eea");
  assert.match(result.evidence, /Remote - Europe|Europe/);
});

test("remote-europe is dropped when a country list omits Spain", () => {
  assert.equal(
    judgeSpainEmployable({ place_class: "remote-europe", text: REMOTE_EUROPE_OMITS_SPAIN }),
    null,
  );
});

test("A role whose place class is remote-global is kept as worldwide only when the text still includes Spain", () => {
  const kept = judgeSpainEmployable({ place_class: "remote-global", text: REMOTE_GLOBAL_INCLUDES_SPAIN });
  assert.equal(kept.eligibility_class, "worldwide");
  assert.match(kept.evidence, /Spain/);
  assert.ok(REMOTE_GLOBAL_INCLUDES_SPAIN.includes(kept.evidence) || /Spain/.test(kept.evidence));

  assert.equal(
    judgeSpainEmployable({ place_class: "remote-global", text: REMOTE_GLOBAL_BARE }),
    null,
  );
});

test("A line about employment via Deel, Remote.com, or as autónomo is kept as contractor", () => {
  const deel = judgeSpainEmployable({ place_class: "remote-global", text: CONTRACTOR_DEEL });
  assert.equal(deel.eligibility_class, "contractor");
  assert.match(deel.evidence, /Deel/);

  const remoteCom = judgeSpainEmployable({ place_class: "remote-global", text: CONTRACTOR_REMOTE_COM });
  assert.equal(remoteCom.eligibility_class, "contractor");
  assert.match(remoteCom.evidence, /Remote\.com/);

  const autonomo = judgeSpainEmployable({ place_class: "remote-global", text: CONTRACTOR_AUTONOMO });
  assert.equal(autonomo.eligibility_class, "contractor");
  assert.match(autonomo.evidence, /autónomo/);
});

test("A posting that only says Remote, a US-only line, a country list that omits Spain, and an on-site Spain office are dropped", () => {
  assert.equal(judgeSpainEmployable({ place_class: "remote-global", text: "Remote\n\nLocation: Remote" }), null);
  assert.equal(judgeSpainEmployable({ place_class: "remote-us", text: US_ONLY }), null);
  assert.equal(judgeSpainEmployable({ place_class: "remote-global", text: COUNTRY_LIST_OMITS_SPAIN }), null);
  assert.equal(judgeSpainEmployable({ place_class: "spain", text: ONSITE_SPAIN_OFFICE }), null);
});

test("The evidence string that decided the class is stored with the role", () => {
  const result = judgeSpainEmployable({ place_class: "remote-spain", text: SPAIN_NAMED });
  assert.equal(typeof result.evidence, "string");
  assert.ok(result.evidence.length > 0);
});

test("keep/drop is not inside lib/ats; adapters still return roles the crawl drops", async () => {
  const atsRoot = join(root, "lib/ats");
  function walk(dir) {
    const names = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) names.push(...walk(path));
      else if (entry.name.endsWith(".js")) names.push(path);
    }
    return names;
  }
  for (const file of walk(atsRoot)) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("eligibility_class"), false, `${file} mentions eligibility_class`);
    assert.equal(source.includes("spain-employable"), false, `${file} mentions spain-employable`);
    assert.equal(source.includes("spain-named"), false, `${file} mentions spain-named`);
  }

  const company = CompanySchema.parse({ ...greenhouse, active: true });
  const restore = installFixtureFetch(loadFixturePayloads(fixtureDir, [greenhouse, ashby]));
  try {
    const jobs = await adapterFor(company.ats).listJobs(company, "2026-01-01T00:00:00.000Z");
    assert.ok(jobs.some((job) => job.externalId === "1002" && job.title === "Support Specialist"));
    const roles = await crawlBoards([greenhouse, ashby]);
    assert.equal(roles.some((role) => role.id === "greenhouse:cabify:1002"), false);
  } finally {
    restore();
  }
});

test("crawl writes only qualifying roles with eligibility class and evidence", async () => {
  const roles = await withFixtures([greenhouse, ashby], () => crawlBoards([greenhouse, ashby]));
  assert.ok(roles.length > 0);
  for (const role of roles) {
    assert.ok(["spain-named", "eu-eea", "worldwide", "contractor"].includes(role.eligibility_class), role.id);
    assert.equal(typeof role.evidence, "string");
    assert.ok(role.evidence.length > 0, `${role.id} missing evidence`);
  }
  assert.ok(roles.some((role) => role.id === "greenhouse:cabify:1001" && role.eligibility_class === "spain-named"));
  assert.ok(roles.some((role) => role.id === "ashby:acme:aaaa-1111" && role.eligibility_class === "eu-eea"));
  assert.equal(roles.some((role) => role.id === "ashby:acme:bbbb-2222"), false);
});
