/**
 * Common Crawl discovery: turn index hits into Greenhouse, Ashby, Lever, or
 * Teamtailor boards. Headcount and the directory keep/drop stay elsewhere.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { boardFromUrl } from "./ats/presets/spain.js";
import { domainFromWebsite } from "./yc.js";

export const CC_ATS = Object.freeze(["greenhouse", "ashby", "lever", "teamtailor"]);

const CC_ATS_SET = new Set(CC_ATS);

function decodeSlug(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Rebuild a hosted-board URL from a Common Crawl SURT key, for the four ATS kinds. */
export function urlFromSurt(surt) {
  const key = String(surt).split(/[\s"]/)[0];
  const greenhouse = /^(?:io,greenhouse,(job-)?boards)\)\/([^/?]+)/i.exec(key);
  if (greenhouse) {
    const host = greenhouse[1] ? "job-boards.greenhouse.io" : "boards.greenhouse.io";
    return `https://${host}/${decodeSlug(greenhouse[2])}`;
  }
  const ashby = /^com,ashbyhq,jobs\)\/([^/?]+)/i.exec(key);
  if (ashby) return `https://jobs.ashbyhq.com/${decodeSlug(ashby[1])}`;
  const leverEu = /^co,lever,eu,jobs\)\/([^/?]+)/i.exec(key);
  if (leverEu) return `https://jobs.eu.lever.co/${decodeSlug(leverEu[1])}`;
  const lever = /^co,lever,jobs\)\/([^/?]+)/i.exec(key);
  if (lever) return `https://jobs.lever.co/${decodeSlug(lever[1])}`;
  const teamtailor = /^com,teamtailor,([^,)/]+)/i.exec(key);
  if (teamtailor) return `https://${decodeSlug(teamtailor[1])}.teamtailor.com/`;
  return null;
}

export function urlFromHit(hit) {
  if (typeof hit === "string") {
    if (/^https?:\/\//i.test(hit)) return hit;
    return urlFromSurt(hit);
  }
  if (hit?.url) return hit.url;
  if (hit?.urlkey) return urlFromSurt(hit.urlkey);
  return null;
}

export function boardFromCcHit(hit) {
  const url = urlFromHit(hit);
  if (!url) return null;
  const found = boardFromUrl(url);
  if (!found || !CC_ATS_SET.has(found.ats)) return null;
  return { ats: found.ats, board: found.board, url };
}

function boardKey(board) {
  return `${board.ats}:${String(board.board).toLowerCase()}`;
}

export function boardsFromIndex(hits = []) {
  const seen = new Set();
  const boards = [];
  for (const hit of hits) {
    const board = boardFromCcHit(hit);
    if (!board) continue;
    const key = boardKey(board);
    if (seen.has(key)) continue;
    seen.add(key);
    boards.push(board);
  }
  return boards;
}

export function parseCcIndex(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) return JSON.parse(trimmed);
  return trimmed.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function loadCcIndex(path, root = process.cwd()) {
  const file = isAbsolute(path) ? path : join(root, path);
  return parseCcIndex(readFileSync(file, "utf8"));
}

export function loadCcCatalog(path, root = process.cwd()) {
  const file = isAbsolute(path) ? path : join(root, path);
  return JSON.parse(readFileSync(file, "utf8"));
}

export function catalogBoard(record) {
  if (record?.ats && record?.board) return { ats: record.ats, board: record.board };
  for (const candidate of [record?.careers, record?.website, record?.url]) {
    if (!candidate) continue;
    const found = boardFromUrl(candidate);
    if (found && CC_ATS_SET.has(found.ats)) return { ats: found.ats, board: found.board };
  }
  return null;
}

export function indexCatalog(records = []) {
  const map = new Map();
  for (const record of records) {
    const board = catalogBoard(record);
    if (!board) continue;
    map.set(boardKey(board), record);
  }
  return map;
}

export function toCcSeed(record, board, evidence = null) {
  const domain = record?.domain || domainFromWebsite(record?.website) || domainFromWebsite(record?.headcount_url);
  const company = {
    name: record?.name || board.board,
    domain,
    ats: board.ats,
    board: board.board,
    hq_country: typeof record?.hq_country === "string" ? record.hq_country : "",
    via: "headcount",
    startup_gate: evidence ?? {
      evidence: "headcount",
      url: record?.headcount_url || "",
    },
  };
  if (record?.kind) company.kind = record.kind;
  if (record?.headcount_url) company.headcount_url = record.headcount_url;
  if (record?.headcount_file) company.headcount_file = record.headcount_file;
  return company;
}
