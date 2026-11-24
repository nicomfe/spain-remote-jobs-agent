// Discovery: YC companies with an ATS board and a qualifying role join
// the public directory. Startup gate, strike-off, and exclusion stay in
// lib/directory.js. Adapters stay generic.
//
//     node scripts/discover-yc.mjs --fixture-dir tests/fixtures/yc
//     node scripts/discover-yc.mjs --live --catalog path/to/yc.json
//
// Default tests stub fetch (or pass --fixture-dir). --live is the only path
// that talks to the network.

import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { companiesToCrawl, publishDirectory } from "../lib/directory.js";
import { hasAtsBoard, loadYcCatalog, mergeSeeds, toYcSeed } from "../lib/yc.js";
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
const YC_COMPANIES_URL = "https://yc-oss.github.io/api/companies.json";

export { writeDirectory, writeJobs };

export function parseArgs(argv) {
  const args = {
    live: false,
    fixtureDir: null,
    catalog: null,
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

export async function loadCatalog(args, root = ROOT) {
  if (args.catalog) return loadYcCatalog(args.catalog, root);
  if (args.fixtureDir) {
    const dir = isAbsolute(args.fixtureDir) ? args.fixtureDir : join(root, args.fixtureDir);
    return loadYcCatalog(join(dir, "companies.json"));
  }
  const response = await fetch(YC_COMPANIES_URL);
  if (!response.ok) throw new Error(`YC catalog fetch failed: ${response.status}`);
  return response.json();
}

export async function discoverYc({
  catalog,
  seed = [],
  now = new Date(),
  lastCrawl = now.toISOString(),
  fixtureDir = null,
  live = false,
} = {}) {
  const ycCompanies = catalog.map(toYcSeed).filter(hasAtsBoard);
  const merged = mergeSeeds(seed, ycCompanies);
  const ycEligible = companiesToCrawl(merged, now).filter((company) => company.via === "yc");
  const companies = fixtureDir ? companiesWithFixtures(fixtureDir, ycEligible) : ycEligible;
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

export async function runDiscoverYc(args, root = ROOT) {
  const catalog = await loadCatalog(args, root);
  const seed = Array.isArray(args.seed) ? args.seed : loadSeed(isAbsolute(args.seed) ? args.seed : join(root, args.seed));
  const { roles, directory } = await discoverYc({
    catalog,
    seed,
    fixtureDir: args.fixtureDir,
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
  node scripts/discover-yc.mjs --fixture-dir tests/fixtures/yc
  node scripts/discover-yc.mjs --live --catalog path/to/yc.json
`;
}

async function main(argv) {
  try {
    const { roles } = await runDiscoverYc(parseArgs(argv));
    process.stderr.write(`wrote ${roles.length} roles\n`);
  } catch (error) {
    process.stderr.write(`${usage()}${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
