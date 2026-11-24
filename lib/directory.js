/**
 * Public directory of startups: startup gate, strike-off, and crawl bookkeeping.
 * Hiring contacts never belong on these records.
 */

import { ELIGIBILITY_CLASSES } from "./spain-employable.js";

export const EXCLUDED_KINDS = Object.freeze(["consultancy", "bank", "subsidiary"]);

const EXCLUDED_KIND_SET = new Set(EXCLUDED_KINDS);
const CLASS_RANK = new Map(ELIGIBILITY_CLASSES.map((value, index) => [value, index]));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const PUBLIC_FIELDS = [
  "name",
  "domain",
  "ats",
  "board",
  "hq_country",
  "via",
  "startup_gate",
  "eligibility_class",
  "evidence",
  "last_crawl",
  "open_role_count",
];

function calendarDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** `"no"` is permanent. A date is struck off until that day (recheck on or after). */
export function isStruckOff(strikeOff, now = new Date()) {
  if (strikeOff == null || strikeOff === "") return false;
  if (String(strikeOff).toLowerCase() === "no") return true;
  const day = String(strikeOff).slice(0, 10);
  if (!DAY.test(day)) throw new Error(`invalid strike-off: ${strikeOff}`);
  return calendarDay(now) < day;
}

export function excludedKind(company) {
  const kind = company?.kind;
  return EXCLUDED_KIND_SET.has(kind) ? kind : null;
}

function gateEvidence(company) {
  const gate = company?.startup_gate;
  if (typeof gate === "string") return gate;
  return gate?.evidence;
}

/**
 * Startup gate: hand, yc, or headcount plus a URL. An exclusion list drops
 * consultancy, bank, and subsidiary. A hand company needs no headcount.
 */
export function startupGate(company) {
  if (excludedKind(company)) return null;
  const evidence = gateEvidence(company);
  if (evidence === "hand" || company?.via === "hand") {
    return { evidence: "hand" };
  }
  if (evidence === "yc") {
    return { evidence: "yc" };
  }
  if (evidence === "headcount") {
    const url = company.startup_gate?.url;
    const headcount = company.startup_gate?.headcount;
    if (typeof url !== "string" || url.trim() === "") return null;
    if (!Number.isFinite(headcount) || headcount < 1 || headcount > 200) return null;
    return { evidence: "headcount", url, headcount };
  }
  return null;
}

export function eligibleForCrawl(company, now = new Date()) {
  if (isStruckOff(company?.strike_off, now)) return false;
  return startupGate(company) !== null;
}

export function keepAfterCrawl(company, openRoleCount, now = new Date()) {
  if (!eligibleForCrawl(company, now)) return false;
  if (company.via === "hand") return true;
  return openRoleCount > 0;
}

export function companiesToCrawl(seed, now = new Date()) {
  return seed.filter((company) => eligibleForCrawl(company, now));
}

export function rolesForCompany(company, roles) {
  return roles.filter((role) => role.ats === company.ats && role.board === company.board);
}

export function eligibilityFromRoles(roles) {
  if (!roles.length) return { eligibility_class: null, evidence: null };
  const ranked = [...roles].sort(
    (a, b) => (CLASS_RANK.get(a.eligibility_class) ?? 99) - (CLASS_RANK.get(b.eligibility_class) ?? 99),
  );
  const top = ranked[0];
  return { eligibility_class: top.eligibility_class, evidence: top.evidence };
}

function boardKey(company) {
  return `${company.ats}:${company.board}`;
}

export function toDirectoryRecord(company, roles = [], lastCrawl = null) {
  const gate = startupGate(company);
  if (!gate) return null;
  const matching = rolesForCompany(company, roles);
  const { eligibility_class, evidence } = eligibilityFromRoles(matching);
  return {
    name: company.name,
    domain: company.domain,
    ats: company.ats,
    board: company.board,
    hq_country: company.hq_country,
    via: company.via,
    startup_gate: gate,
    eligibility_class,
    evidence,
    last_crawl: lastCrawl,
    open_role_count: matching.length,
  };
}

/**
 * @param {object[]} seed
 * @param {object[]} roles
 * @param {{ now?: Date, lastCrawl?: string | null, crawledBoards?: Iterable<{ats: string, board: string}> | null }} [options]
 */
export function publishDirectory(seed, roles = [], { now = new Date(), lastCrawl = null, crawledBoards = null } = {}) {
  const crawled = crawledBoards
    ? new Set([...crawledBoards].map(boardKey))
    : null;
  const records = [];
  for (const company of seed) {
    const wasCrawled = crawled ? crawled.has(boardKey(company)) : Boolean(lastCrawl);
    const matching = wasCrawled ? rolesForCompany(company, roles) : [];
    if (!keepAfterCrawl(company, matching.length, now)) continue;
    const record = toDirectoryRecord(company, wasCrawled ? roles : [], wasCrawled ? lastCrawl : null);
    if (record) records.push(record);
  }
  return records;
}

export function assertPublicRecord(record) {
  for (const field of PUBLIC_FIELDS) {
    if (!Object.hasOwn(record, field)) throw new Error(`directory record missing ${field}`);
  }
}

export { PUBLIC_FIELDS };
