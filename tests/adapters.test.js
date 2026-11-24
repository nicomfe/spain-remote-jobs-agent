import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CompanySchema } from "../lib/ats/domain/campaign.js";
import { adapterFor } from "../lib/ats/sources/registry.js";
import { installFixtureFetch, loadFixturePayloads, toRole } from "../scripts/crawl.mjs";

process.env.ATS_MIN_INTERVAL_MS = "0";
process.env.ATS_LOG_LEVEL = "error";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("Greenhouse, Ashby, Lever, and Teamtailor adapters are usable", async () => {
  const companies = [
    { name: "Cabify", ats: "greenhouse", board: "cabify" },
    { name: "Acme", ats: "ashby", board: "acme" },
    { name: "Lodgify", ats: "lever", board: "lodgify" },
    { name: "Example", ats: "teamtailor", board: "careers.example.com" },
  ];
  const restore = installFixtureFetch(loadFixturePayloads(fixtureDir, companies));
  try {
    const capturedAt = "2026-01-01T00:00:00.000Z";
    for (const input of companies) {
      const company = CompanySchema.parse({ ...input, active: true });
      const adapter = adapterFor(company.ats);
      assert.equal(adapter.kind, company.ats);
      assert.equal(typeof adapter.listUrl, "function");
      assert.equal(typeof adapter.listJobs, "function");
      const jobs = await adapter.listJobs(company, capturedAt);
      assert.ok(jobs.length >= 1, `${company.ats} returned no jobs`);
      const role = toRole(jobs[0]);
      assert.equal(role.ats, company.ats);
      assert.equal(typeof role.place_class, "string");
    }
  } finally {
    restore();
  }
});
