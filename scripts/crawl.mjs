// Crawl kept Directory boards (or one Greenhouse board and one Ashby board)
// into data/jobs.json.
// Adapters return every open role; keep/drop of Spain-employable roles happens
// here via lib/spain-employable.js. Qualifying roles are written with a place
// class, eligibility class, evidence, and stated pay when present.
//
//     npm run crawl -- --greenhouse cabify --ashby acme --live
//     npm run crawl -- --greenhouse cabify --ashby acme --fixture-dir tests/fixtures
//
// Default tests stub fetch (or pass --fixture-dir). --live is the only path
// that talks to the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CompanySchema } from "../lib/ats/domain/campaign.js";
import { adapterFor } from "../lib/ats/sources/registry.js";
import {
  companiesToCrawl,
  publishDirectory,
} from "../lib/directory.js";
import { judgeSpainEmployable, postingTextFromJob } from "../lib/spain-employable.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PERIODS = new Set(["year", "month", "hour"]);

export const DEFAULT_OUT = join(ROOT, "data/jobs.json");
export const DEFAULT_DIRECTORY = join(ROOT, "data/directory.json");
export const DEFAULT_SEED = join(ROOT, "data/hand.json");

/** Pay the board publishes in its own fields, not a guess from the description. */
export function statedPay(compensation) {
  if (!compensation || compensation.source !== "ats-structured" || !PERIODS.has(compensation.period)) {
    return null;
  }
  const min = Number.isFinite(compensation.min) ? Math.round(compensation.min) : null;
  const max = Number.isFinite(compensation.max) ? Math.round(compensation.max) : null;
  if (min === null && max === null) return null;
  return { min, max, currency: compensation.currency, period: compensation.period };
}

function locationLabel(job) {
  const offices = job.locationsRaw
    .flatMap((value) => String(value).split(/\s*[;|]\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Map(offices.map((value) => [value.toLowerCase(), value])).values()].join("; ");
}

export function toRole(job) {
  return {
    id: `${job.ats}:${job.board}:${job.externalId}`,
    company: job.companyName,
    title: job.title,
    url: job.ats === "greenhouse" ? job.applyUrl || job.url : job.url || job.applyUrl,
    ats: job.ats,
    board: job.board,
    location: locationLabel(job),
    place_class: job.locationClass,
    stated_pay: statedPay(job.compensation),
  };
}

export function qualifyRole(job) {
  const role = toRole(job);
  const judged = judgeSpainEmployable({
    place_class: role.place_class,
    text: postingTextFromJob(job, role.location),
  });
  if (!judged) return null;
  return { ...role, eligibility_class: judged.eligibility_class, evidence: judged.evidence };
}

export async function listBoard(companyInput, capturedAt = new Date().toISOString()) {
  const company = CompanySchema.parse({ ...companyInput, active: true });
  const jobs = await adapterFor(company.ats).listJobs(company, capturedAt);
  return jobs.map(qualifyRole).filter(Boolean);
}

export async function crawlBoards(companies, capturedAt) {
  const roles = [];
  for (const company of companies) {
    roles.push(...await listBoard(company, capturedAt));
  }
  return roles;
}

export function writeJobs(roles, outPath = DEFAULT_OUT) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(roles, null, 2)}\n`);
}

export function writeDirectory(records, outPath = DEFAULT_DIRECTORY) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(records, null, 2)}\n`);
}

export function loadSeed(seedPath = DEFAULT_SEED) {
  const path = isAbsolute(seedPath) ? seedPath : join(ROOT, seedPath);
  return JSON.parse(readFileSync(path, "utf8"));
}

function fixtureFile(fixtureDir, company) {
  const dir = isAbsolute(fixtureDir) ? fixtureDir : join(ROOT, fixtureDir);
  return join(dir, `${company.ats}-${company.board}.json`);
}

export function companiesWithFixtures(fixtureDir, companies) {
  return companies.filter((company) => existsSync(fixtureFile(fixtureDir, company)));
}

/** Map adapter list URLs to recorded payloads so crawl can run without the network. */
export function installFixtureFetch(payloadByUrl) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const key = String(url);
    const body = payloadByUrl[key] ?? payloadByUrl[key.split("?")[0]];
    if (body === undefined) return new Response("not found", { status: 404 });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status: 200 });
  };
  return () => {
    globalThis.fetch = previous;
  };
}

export function loadFixturePayloads(fixtureDir, companies) {
  const dir = isAbsolute(fixtureDir) ? fixtureDir : join(ROOT, fixtureDir);
  const payloads = {};
  for (const company of companies) {
    const parsed = CompanySchema.parse({ ...company, active: true });
    const adapter = adapterFor(parsed.ats);
    const url = adapter.listUrl(parsed);
    const file = join(dir, `${parsed.ats}-${parsed.board}.json`);
    payloads[url] = JSON.parse(readFileSync(file, "utf8"));
    payloads[url.split("?")[0]] = payloads[url];
  }
  return payloads;
}

export function parseArgs(argv) {
  const args = {
    live: false,
    fixtureDir: null,
    out: DEFAULT_OUT,
    directoryOut: DEFAULT_DIRECTORY,
    seed: DEFAULT_SEED,
    hand: false,
    greenhouse: null,
    ashby: null,
    names: {},
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
    else if (token === "--out") args.out = next();
    else if (token === "--directory-out") args.directoryOut = next();
    else if (token === "--seed") args.seed = next();
    else if (token === "--hand") args.hand = true;
    else if (token === "--greenhouse") args.greenhouse = next();
    else if (token === "--ashby") args.ashby = next();
    else if (token === "--greenhouse-name") args.names.greenhouse = next();
    else if (token === "--ashby-name") args.names.ashby = next();
    else throw new Error(`unknown argument: ${token}`);
  }
  return args;
}

export function boardsFromArgs(args) {
  if (!args.greenhouse || !args.ashby) {
    throw new Error("need --greenhouse <board> and --ashby <board>");
  }
  return [
    { name: args.names.greenhouse || args.greenhouse, ats: "greenhouse", board: args.greenhouse },
    { name: args.names.ashby || args.ashby, ats: "ashby", board: args.ashby },
  ];
}

export async function crawlHandDirectory({
  seed,
  now = new Date(),
  lastCrawl = now.toISOString(),
  fixtureDir = null,
  live = false,
} = {}) {
  const eligible = companiesToCrawl(seed, now);
  const companies = fixtureDir ? companiesWithFixtures(fixtureDir, eligible) : eligible;
  let restore;
  if (fixtureDir) {
    process.env.ATS_MIN_INTERVAL_MS ??= "0";
    restore = installFixtureFetch(loadFixturePayloads(fixtureDir, companies));
  } else if (!live) {
    throw new Error("pass exactly one of --live or --fixture-dir");
  }
  try {
    const roles = companies.length ? await crawlBoards(companies, lastCrawl) : [];
    const directory = publishDirectory(seed, roles, {
      now,
      lastCrawl,
      crawledBoards: companies,
    });
    return { roles, directory, crawled: companies };
  } finally {
    restore?.();
  }
}

export async function runCrawl(args) {
  if (args.live === Boolean(args.fixtureDir)) {
    throw new Error("pass exactly one of --live or --fixture-dir");
  }
  const fromHand = args.hand || (!args.greenhouse && !args.ashby);
  if (fromHand) {
    const seed = Array.isArray(args.seed) ? args.seed : loadSeed(args.seed);
    const { roles, directory } = await crawlHandDirectory({
      seed,
      fixtureDir: args.fixtureDir,
      live: args.live,
    });
    writeJobs(roles, isAbsolute(args.out) ? args.out : join(ROOT, args.out));
    const directoryOut = args.directoryOut ?? DEFAULT_DIRECTORY;
    writeDirectory(directory, isAbsolute(directoryOut) ? directoryOut : join(ROOT, directoryOut));
    return roles;
  }
  const companies = boardsFromArgs(args);
  let restore;
  if (args.fixtureDir) {
    process.env.ATS_MIN_INTERVAL_MS ??= "0";
    restore = installFixtureFetch(loadFixturePayloads(args.fixtureDir, companies));
  }
  try {
    const roles = await crawlBoards(companies);
    writeJobs(roles, isAbsolute(args.out) ? args.out : join(ROOT, args.out));
    return roles;
  } finally {
    restore?.();
  }
}

function usage() {
  return `Usage:
  node scripts/crawl.mjs --hand --live
  node scripts/crawl.mjs --hand --fixture-dir tests/fixtures
  node scripts/crawl.mjs --greenhouse <slug> --ashby <slug> --live
  node scripts/crawl.mjs --greenhouse <slug> --ashby <slug> --fixture-dir tests/fixtures
`;
}

async function main(argv) {
  try {
    const roles = await runCrawl(parseArgs(argv));
    process.stderr.write(`wrote ${roles.length} roles\n`);
  } catch (error) {
    process.stderr.write(`${usage()}${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
