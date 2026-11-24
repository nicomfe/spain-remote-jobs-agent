import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  crawlBoards,
  installFixtureFetch,
  loadFixturePayloads,
  runCrawl,
  writeJobs,
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

test("Greenhouse and Ashby boards each produce roles in jobs.json", async () => {
  const roles = await withFixtures([greenhouse, ashby], () => crawlBoards([greenhouse, ashby]));
  const out = join(mkdtempSync(join(tmpdir(), "jobs-")), "jobs.json");
  writeJobs(roles, out);
  const written = JSON.parse(readFileSync(out, "utf8"));

  const fromGreenhouse = written.filter((role) => role.ats === "greenhouse");
  const fromAshby = written.filter((role) => role.ats === "ashby");
  assert.ok(fromGreenhouse.length >= 1, "Greenhouse board produced no roles");
  assert.ok(fromAshby.length >= 1, "Ashby board produced no roles");
  assert.equal(written.length, fromGreenhouse.length + fromAshby.length);
});

test("each role has a place class from the location classifier", async () => {
  const roles = await withFixtures([greenhouse, ashby], () => crawlBoards([greenhouse, ashby]));
  assert.ok(roles.length > 0);
  for (const role of roles) {
    assert.equal(typeof role.place_class, "string");
    assert.ok(role.place_class.length > 0, `${role.id} missing place class`);
  }
});

test("stated pay on a posting is stored; a posting with none is still written", async () => {
  const roles = await withFixtures([greenhouse, ashby], () => crawlBoards([greenhouse, ashby]));
  const paid = roles.find((role) => role.id === "greenhouse:cabify:1001");
  const unpaid = roles.find((role) => role.id === "greenhouse:cabify:1003");
  assert.deepEqual(paid.stated_pay, { min: 60000, max: 80000, currency: "EUR", period: "year" });
  assert.equal(unpaid.stated_pay, null);
  assert.equal(unpaid.title, "Support Specialist");
});

test("fixture crawl writes jobs.json without the network", async () => {
  const out = join(mkdtempSync(join(tmpdir(), "jobs-")), "jobs.json");
  const roles = await runCrawl({
    live: false,
    fixtureDir,
    out,
    greenhouse: "cabify",
    ashby: "acme",
    names: { greenhouse: "Cabify", ashby: "Acme" },
  });
  assert.ok(roles.some((role) => role.ats === "greenhouse"));
  assert.ok(roles.some((role) => role.ats === "ashby"));
  assert.deepEqual(JSON.parse(readFileSync(out, "utf8")), roles);
});
