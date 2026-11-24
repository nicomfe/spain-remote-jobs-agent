// Discovery: Common Crawl boards of Greenhouse, Ashby, Lever, or Teamtailor
// join the public directory when headcount is known and under the cap and a
// role qualifies. Startup gate, strike-off, and exclusion stay in
// lib/directory.js. Adapters stay generic.
//
//     node scripts/discover-cc.mjs --fixture-dir tests/fixtures/cc
//     node scripts/discover-cc.mjs --live --catalog path/to/cc-companies.json
//
// Default tests stub fetch (or pass --fixture-dir). --live is the only path
// that talks to the network. There is no paid people API.

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  boardsFromIndex,
  catalogBoard,
  indexCatalog,
  loadCcCatalog,
  loadCcIndex,
  toCcSeed,
  urlFromHit,
} from "../lib/common-crawl.js";
import { companiesToCrawl, publishDirectory, startupGate } from "../lib/directory.js";
import { parseHeadcount } from "../lib/headcount.js";
import { mergeSeeds } from "../lib/yc.js";
import {
  companiesWithFixtures,
  crawlBoards,
  DEFAULT_DIRECTORY,
  DEFAULT_OUT,
  DEFAULT_SEED,
  installFixtureFetch,
  loadFixturePayloads,
  loadSeed,
  writeDirectory,
  writeJobs,
} from "./crawl.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CC_COLLINFO = "https://index.commoncrawl.org/collinfo.json";
const CC_HOST_QUERIES = [
  "boards.greenhouse.io/*",
  "job-boards.greenhouse.io/*",
  "jobs.ashbyhq.com/*",
  "jobs.lever.co/*",
  "jobs.eu.lever.co/*",
  "*.teamtailor.com/*",
];
const UA = "spain-remote-jobs-agent-cc/1 (+https://spain-remote-agent.nicofetter.com; finds ATS boards)";

export { writeDirectory, writeJobs };

function boardKey(company) {
  return `${company.ats}:${String(company.board).toLowerCase()}`;
}

export function parseArgs(argv) {
  const args = {
    live: false,
    fixtureDir: null,
    catalog: null,
    index: null,
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
    else if (token === "--catalog") args.catalog = next();
    else if (token === "--index") args.index = next();
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

export async function loadIndex(args, root = ROOT) {
  if (args.index) return loadCcIndex(args.index, root);
  if (args.fixtureDir) {
    return loadCcIndex(join(resolvePath(args.fixtureDir, root), "index.json"));
  }
  return fetchLiveIndex();
}

export async function loadCatalog(args, root = ROOT) {
  if (args.catalog) return loadCcCatalog(args.catalog, root);
  if (args.fixtureDir) {
    const file = join(resolvePath(args.fixtureDir, root), "companies.json");
    if (existsSync(file)) return loadCcCatalog(file);
  }
  return [];
}

async function fetchLiveIndex() {
  const response = await fetch(CC_COLLINFO, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`Common Crawl collinfo fetch failed: ${response.status}`);
  const collections = await response.json();
  const cdx = collections[0]?.["cdx-api"] || collections[0]?.cdx_api;
  if (!cdx) throw new Error("Common Crawl collinfo had no cdx-api");
  const hits = [];
  for (const url of CC_HOST_QUERIES) {
    const query = new URL(cdx);
    query.searchParams.set("url", url);
    query.searchParams.set("output", "json");
    query.searchParams.set("fl", "url,urlkey");
    query.searchParams.set("filter", "status:200");
    query.searchParams.set("limit", "400");
    const page = await fetch(query, { headers: { "User-Agent": UA } });
    if (!page.ok) throw new Error(`Common Crawl index fetch failed: ${page.status}`);
    const text = await page.text();
    for (const line of text.split("\n").filter(Boolean)) {
      hits.push(JSON.parse(line));
    }
  }
  return hits;
}

function headcountFile(fixtureDir, record) {
  if (record?.headcount_file) {
    return isAbsolute(record.headcount_file)
      ? record.headcount_file
      : join(fixtureDir, record.headcount_file);
  }
  const board = catalogBoard(record)?.board;
  if (!board) return null;
  const named = join(fixtureDir, `about-${board}.html`);
  return existsSync(named) ? named : null;
}

async function readHeadcountPage(record, { fixtureDir, live }) {
  const url = record?.headcount_url;
  if (fixtureDir) {
    const file = headcountFile(fixtureDir, record);
    if (file && existsSync(file)) return { url, text: readFileSync(file, "utf8") };
    return { url, text: "" };
  }
  if (!live) throw new Error("pass exactly one of --live or --fixture-dir");
  if (!url) return { url: "", text: "" };
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) return { url, text: "" };
  return { url, text: await response.text() };
}

export async function evidenceForRecord(record, options) {
  const page = await readHeadcountPage(record, options);
  const headcount = parseHeadcount(page.text);
  if (headcount == null || !page.url) return null;
  return startupGate({
    startup_gate: { evidence: "headcount", url: page.url, headcount },
  });
}

export async function discoverCc({
  hits,
  catalog = [],
  seed = [],
  now = new Date(),
  lastCrawl = now.toISOString(),
  fixtureDir = null,
  live = false,
} = {}) {
  const byBoard = indexCatalog(catalog);
  const evidenceByBoard = new Map();
  for (const board of boardsFromIndex(hits)) {
    const record = byBoard.get(boardKey(board));
    if (!record) continue;
    const evidence = await evidenceForRecord(record, { fixtureDir, live });
    if (evidence) evidenceByBoard.set(boardKey(board), evidence);
  }
  const ccCompanies = boardsFromIndex(hits).map((board) => {
    const record = byBoard.get(boardKey(board)) ?? { name: board.board, website: urlFromHit(board) || board.url };
    return toCcSeed(record, board, evidenceByBoard.get(boardKey(board)) ?? null);
  });
  const merged = mergeSeeds(seed, ccCompanies);
  const ccEligible = companiesToCrawl(merged, now).filter((company) => company.via === "headcount");
  const companies = fixtureDir ? companiesWithFixtures(fixtureDir, ccEligible) : ccEligible;
  let restore;
  if (fixtureDir) {
    process.env.ATS_MIN_INTERVAL_MS ??= "0";
    restore = companies.length
      ? installFixtureFetch(loadFixturePayloads(fixtureDir, companies))
      : installFixtureFetch({});
  } else if (!live) {
    throw new Error("pass exactly one of --live or --fixture-dir");
  }
  try {
    const roles = companies.length ? await crawlBoards(companies, lastCrawl) : [];
    const directory = publishDirectory(merged, roles, {
      now,
      lastCrawl,
      crawledBoards: companies,
    });
    return { roles, directory, crawled: companies };
  } finally {
    restore?.();
  }
}

export async function runDiscoverCc(args, root = ROOT) {
  const hits = await loadIndex(args, root);
  const catalog = await loadCatalog(args, root);
  const seed = Array.isArray(args.seed) ? args.seed : loadSeed(isAbsolute(args.seed) ? args.seed : join(root, args.seed));
  const { roles, directory } = await discoverCc({
    hits,
    catalog,
    seed,
    fixtureDir: args.fixtureDir ? resolvePath(args.fixtureDir, root) : null,
    live: args.live,
  });
  writeJobs(roles, isAbsolute(args.out) ? args.out : join(root, args.out));
  writeDirectory(
    directory,
    isAbsolute(args.directoryOut) ? args.directoryOut : join(root, args.directoryOut),
  );
  return { roles, directory };
}

function usage() {
  return `Usage:
  node scripts/discover-cc.mjs --fixture-dir tests/fixtures/cc
  node scripts/discover-cc.mjs --live --catalog path/to/cc-companies.json
`;
}

async function main(argv) {
  try {
    const { roles } = await runDiscoverCc(parseArgs(argv));
    process.stderr.write(`wrote ${roles.length} roles\n`);
  } catch (error) {
    process.stderr.write(`${usage()}${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
