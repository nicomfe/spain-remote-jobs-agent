/**
 * Wellfound discovery: turn a Wellfound catalog into the same startup seed
 * shape the directory already uses. Strike-off, exclusion, and the startup
 * gate stay in lib/directory.js. A Wellfound listing is not gate evidence;
 * the company still needs a known headcount under the cap.
 *
 * Issue #13 should call fetchWellfound (and mergeWellfoundSeeds) rather than
 * scraping Wellfound itself.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { boardFromUrl } from "./ats/presets/spain.js";
import { EXCLUDED_KINDS } from "./directory.js";

const EXCLUDED_KIND_SET = new Set(EXCLUDED_KINDS);
const BANK = /\bbank/i;
const CONSULT = /consult/i;
const SUBSIDIARY = /subsidiar/i;
const RANGE = /^(\d+)\s*[-–—]\s*(\d+)$/;
const PLUS = /^(\d+)\+$/;

export function loadWellfoundCatalog(path, root = process.cwd()) {
  const file = isAbsolute(path) ? path : join(root, path);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function domainFromWebsite(website) {
  if (!website) return "";
  try {
    const host = new URL(String(website).includes("://") ? website : `https://${website}`).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function hqCountry(record) {
  if (typeof record?.hq_country === "string" && record.hq_country.trim()) return record.hq_country.trim();
  if (typeof record?.country === "string" && record.country.trim()) return record.country.trim();
  return "";
}

export function excludedKindFromWellfound(record) {
  if (EXCLUDED_KIND_SET.has(record?.kind)) return record.kind;
  const hay = [record?.industry, record?.subindustry, ...(record?.tags ?? []), record?.name]
    .filter(Boolean)
    .join(" ");
  if (CONSULT.test(hay)) return "consultancy";
  if (BANK.test(hay)) return "bank";
  if (SUBSIDIARY.test(hay)) return "subsidiary";
  return null;
}

export function atsBoardFromWellfound(record) {
  if (record?.ats && record?.board) return { ats: record.ats, board: record.board };
  for (const candidate of [record?.careers, record?.website]) {
    if (!candidate) continue;
    const found = boardFromUrl(candidate);
    if (found?.ats && found?.board) return { ats: found.ats, board: found.board };
  }
  return null;
}

export function hasAtsBoard(company) {
  return Boolean(company?.ats && company?.board);
}

export function parseHeadcount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const range = RANGE.exec(trimmed);
  if (range) return Number(range[2]);
  const plus = PLUS.exec(trimmed);
  if (plus) return Number(plus[1]);
  const asNumber = Number(trimmed);
  return Number.isFinite(asNumber) ? asNumber : null;
}

export function headcountFromWellfound(record) {
  return parseHeadcount(
    record?.headcount ?? record?.employee_count ?? record?.team_size ?? record?.size,
  );
}

export function wellfoundProfileUrl(record) {
  for (const candidate of [record?.startup_gate?.url, record?.url, record?.wellfound_url, record?.profile]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (typeof record?.slug === "string" && record.slug.trim()) {
    return `https://wellfound.com/company/${record.slug.trim()}`;
  }
  return "";
}

export function startupGateFromWellfound(record) {
  const headcount = headcountFromWellfound(record);
  const url = wellfoundProfileUrl(record);
  if (headcount == null || !url) return { evidence: "headcount", url, headcount };
  return { evidence: "headcount", url, headcount };
}

export function toWellfoundSeed(record) {
  const domain = record?.domain || domainFromWebsite(record?.website);
  const board = atsBoardFromWellfound(record);
  const kind = excludedKindFromWellfound(record);
  const company = {
    name: record.name,
    domain,
    ats: board?.ats ?? null,
    board: board?.board ?? null,
    hq_country: hqCountry(record),
    via: "wellfound",
    startup_gate: startupGateFromWellfound(record),
  };
  if (kind) company.kind = kind;
  return company;
}

function domainKey(company) {
  return String(company?.domain || "").toLowerCase();
}

export function withHandStrikeOffs(wellfoundCompanies, handSeed = []) {
  const strikes = new Map();
  for (const company of handSeed) {
    if (company?.strike_off) strikes.set(domainKey(company), company.strike_off);
  }
  return wellfoundCompanies.map((company) => {
    const strikeOff = strikes.get(domainKey(company));
    return strikeOff ? { ...company, strike_off: strikeOff } : company;
  });
}

/** Existing directory/seed companies win. Wellfound does not duplicate a domain. */
export function mergeWellfoundSeeds(existing = [], wellfoundCompanies = []) {
  const seen = new Set(existing.map(domainKey).filter(Boolean));
  const merged = [...existing];
  for (const company of withHandStrikeOffs(wellfoundCompanies, existing)) {
    const key = domainKey(company);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(company);
  }
  return merged;
}

/**
 * Read Wellfound into seed records. Tests pass `records` or `path`.
 * `--live` is the only path that talks to the network.
 */
export async function fetchWellfound({
  records,
  path,
  live = false,
  url,
  root = process.cwd(),
  fetch: fetchFn = globalThis.fetch,
} = {}) {
  let catalog = records;
  if (!catalog && path) catalog = loadWellfoundCatalog(path, root);
  if (!catalog) {
    if (!live) throw new Error("pass records, path, or --live with a catalog url");
    const source = url || process.env.WELLFOUND_CATALOG_URL;
    if (!source) throw new Error("pass --catalog or set WELLFOUND_CATALOG_URL");
    const response = await fetchFn(source);
    if (!response.ok) throw new Error(`Wellfound catalog fetch failed: ${response.status}`);
    catalog = await response.json();
  }
  return catalog.map(toWellfoundSeed);
}
