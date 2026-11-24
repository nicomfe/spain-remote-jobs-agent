/**
 * Known headcount from a public page. No people API. The startup gate in
 * lib/directory.js applies the cap of 200; an unknown figure stays out.
 */

import { startupGate } from "./directory.js";

export const HEADCOUNT_CAP = 200;

const LD_JSON = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const COUNT_PATTERNS = [
  /(\d{1,4})\s+employees\b/i,
  /\bteam of\s+(\d{1,4})\b/i,
  /\bheadcount[:\s]+(\d{1,4})\b/i,
  /\b(?:we are|we're)\s+(\d{1,4})\s+people\b/i,
];

function asCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function employeesFromNode(node) {
  if (node == null) return null;
  if (typeof node === "number" || typeof node === "string") return asCount(node);
  if (typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = employeesFromNode(item);
      if (found != null) return found;
    }
    return null;
  }
  if (Object.hasOwn(node, "minValue") || Object.hasOwn(node, "maxValue")) return null;
  if (Object.hasOwn(node, "value")) return asCount(node.value);
  return null;
}

function walkJsonLd(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkJsonLd(item);
      if (found != null) return found;
    }
    return null;
  }
  if (Object.hasOwn(node, "numberOfEmployees")) {
    return employeesFromNode(node.numberOfEmployees);
  }
  if (node["@graph"]) return walkJsonLd(node["@graph"]);
  return null;
}

function fromJsonLd(html) {
  for (const match of html.matchAll(LD_JSON)) {
    try {
      const found = walkJsonLd(JSON.parse(match[1]));
      if (found != null) return found;
    } catch {
      // Unparseable JSON-LD is not a known headcount.
    }
  }
  return null;
}

/** A single known headcount, or null when the page does not name one. Ranges stay unknown. */
export function parseHeadcount(text) {
  if (typeof text !== "string" || text.trim() === "") return null;
  const fromLd = fromJsonLd(text);
  if (fromLd != null && fromLd >= 1) return fromLd;
  for (const pattern of COUNT_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count) && count >= 1) return count;
  }
  return null;
}

/** Gate evidence when the page named a number. Cap and URL checks stay in startupGate. */
export function headcountEvidence(url, text) {
  const headcount = parseHeadcount(text);
  if (headcount == null) return null;
  return startupGate({
    startup_gate: { evidence: "headcount", url, headcount },
  });
}
