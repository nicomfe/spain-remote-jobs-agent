// Discovery: Wellfound companies with an ATS board, a known headcount under
// the cap, and a qualifying role join the public directory. Startup gate,
// strike-off, and exclusion stay in lib/directory.js.
//
//     node scripts/discover-wellfound.mjs --fixture-dir tests/fixtures/wellfound
//     node scripts/discover-wellfound.mjs --live --catalog path/to/wellfound.json
//
// Default tests stub fetch (or pass --fixture-dir). --live is the only path
// that talks to the network. Issue #13 should call fetchWellfound from
// lib/wellfound.js (and discoverWellfound here) rather than re-fetching.

import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { companiesToCrawl, publishDirectory } from "../lib/directory.js";
import {
  fetchWellfound,
  hasAtsBoard,
  loadWellfoundCatalog,
  mergeWellfoundSeeds,
} from "../lib/wellfound.js";
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

export async function loadWellfoundRows(args, root = ROOT) {
  if (args.catalog) return loadWellfoundCatalog(args.catalog, root);
  if (args.fixtureDir) {
    const dir = isAbsolute(args.fixtureDir) ? args.fixtureDir : join(root, args.fixtureDir);
    return loadWellfoundCatalog(join(dir, "companies.json"));
  }
  if (!args.live) throw new Error("pass exactly one of --live or --fixture-dir");
  const source = process.env.WELLFOUND_CATALOG_URL;
  if (!source) throw new Error("pass --catalog or set WELLFOUND_CATALOG_URL");
  const response = await fetch(source);
  if (!response.ok) throw new Error(`Wellfound catalog fetch failed: ${response.status}`);
  return response.json();
}

export async function discoverWellfound({
  catalog,
  seed = [],
  now = new Date(),
  lastCrawl = now.toISOString(),
  fixtureDir = null,
  live = false,
} = {}) {
  const wellfoundCompanies = (await fetchWellfound({ records: catalog })).filter(hasAtsBoard);
  const merged = mergeWellfoundSeeds(seed, wellfoundCompanies);
  const wellfoundEligible = companiesToCrawl(merged, now).filter((company) => company.via === "wellfound");
  const companies = fixtureDir ? companiesWithFixtures(fixtureDir, wellfoundEligible) : wellfoundEligible;
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

export async function runDiscoverWellfound(args, root = ROOT) {
  const catalog = await loadWellfoundRows(args, root);
  const seed = Array.isArray(args.seed) ? args.seed : loadSeed(isAbsolute(args.seed) ? args.seed : join(root, args.seed));
  const { roles, directory } = await discoverWellfound({
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
  node scripts/discover-wellfound.mjs --fixture-dir tests/fixtures/wellfound
  node scripts/discover-wellfound.mjs --live --catalog path/to/wellfound.json
`;
}

async function main(argv) {
  try {
    const { roles } = await runDiscoverWellfound(parseArgs(argv));
    process.stderr.write(`wrote ${roles.length} roles\n`);
  } catch (error) {
    process.stderr.write(`${usage()}${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
