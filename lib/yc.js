/**
 * YC discovery: turn a YC catalog into the same startup seed shape the
 * directory already uses. Strike-off and exclusion stay in lib/directory.js.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { boardFromUrl } from "./ats/presets/spain.js";
import { EXCLUDED_KINDS } from "./directory.js";

const EXCLUDED_KIND_SET = new Set(EXCLUDED_KINDS);
const BANK = /\bbank/i;
const CONSULT = /consult/i;
const SUBSIDIARY = /subsidiar/i;

export function loadYcCatalog(path, root = process.cwd()) {
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

export function excludedKindFromYc(record) {
  if (EXCLUDED_KIND_SET.has(record?.kind)) return record.kind;
  const hay = [record?.industry, record?.subindustry, ...(record?.tags ?? []), record?.name]
    .filter(Boolean)
    .join(" ");
  if (CONSULT.test(hay)) return "consultancy";
  if (BANK.test(hay)) return "bank";
  if (SUBSIDIARY.test(hay)) return "subsidiary";
  return null;
}

export function atsBoardFromYc(record) {
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

export function toYcSeed(record) {
  const domain = record?.domain || domainFromWebsite(record?.website);
  const board = atsBoardFromYc(record);
  const kind = excludedKindFromYc(record);
  const company = {
    name: record.name,
    domain,
    ats: board?.ats ?? null,
    board: board?.board ?? null,
    hq_country: hqCountry(record),
    via: "yc",
    startup_gate: { evidence: "yc" },
  };
  if (kind) company.kind = kind;
  return company;
}

function domainKey(company) {
  return String(company?.domain || "").toLowerCase();
}

export function withHandStrikeOffs(ycCompanies, handSeed = []) {
  const strikes = new Map();
  for (const company of handSeed) {
    if (company?.strike_off) strikes.set(domainKey(company), company.strike_off);
  }
  return ycCompanies.map((company) => {
    const strikeOff = strikes.get(domainKey(company));
    return strikeOff ? { ...company, strike_off: strikeOff } : company;
  });
}

export function mergeSeeds(handSeed = [], ycCompanies = []) {
  const seen = new Set(handSeed.map(domainKey).filter(Boolean));
  const merged = [...handSeed];
  for (const company of withHandStrikeOffs(ycCompanies, handSeed)) {
    const key = domainKey(company);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(company);
  }
  return merged;
}
