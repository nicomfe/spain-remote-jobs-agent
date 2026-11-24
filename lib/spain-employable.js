/**
 * Spain-employable judge: keep a crawled role only when the posting shows
 * someone can be employed remotely from Spain. Adapters do not call this.
 */

const ELIGIBILITY_CLASSES = ["spain-named", "eu-eea", "worldwide", "contractor"];

const COUNTRY_NAMES = [
  "united kingdom",
  "united states",
  "czech republic",
  "south africa",
  "the netherlands",
  "netherlands",
  "germany",
  "france",
  "italy",
  "portugal",
  "ireland",
  "belgium",
  "sweden",
  "norway",
  "denmark",
  "finland",
  "poland",
  "austria",
  "switzerland",
  "greece",
  "romania",
  "hungary",
  "czechia",
  "slovakia",
  "slovenia",
  "croatia",
  "bulgaria",
  "estonia",
  "latvia",
  "lithuania",
  "luxembourg",
  "malta",
  "cyprus",
  "iceland",
  "canada",
  "mexico",
  "brazil",
  "argentina",
  "australia",
  "india",
  "japan",
  "singapore",
  "israel",
];

const SPAIN_RE = /\bspain\b|\bespaña\b|\bespana\b/i;
const EXCLUDES_SPAIN_RE = /\b(?:except(?:ing)?|excluding|not(?:\s+in)?)\s+spain\b|\bspain\s+is\s+not\b|\bunavailable\s+in\s+spain\b/i;
const US_ONLY_RE = /\b(?:us-only|u\.s\.a?\.?\s+only|united states(?:\s+only)?)\b/i;
const REMOTE_SPAIN_RE = /remote,?\s*spain|spain,?\s*remote|remotely from spain|remote(?:ly)?\s+(?:in|from)\s+spain/i;
const EUROPE_PLACE_RE = /remote\s*[-–—,]?\s*(?:europe|eu|eea|emea)|(?:europe|eu|eea|emea)\s*[-–—,]?\s*remote|\bremote - europe\b|\bacross europe\b|\beuropean country\b/i;
const WORLDWIDE_SPAIN_RE = /(?:worldwide|global|anywhere)[^\n.]{0,40}\bspain\b|\bspain\b[^\n.]{0,40}(?:worldwide|global|anywhere)|including spain/i;

function collapse(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function includesSpain(text) {
  return SPAIN_RE.test(text);
}

function listedCountries(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const name of COUNTRY_NAMES) {
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (pattern.test(lower)) found.push(name);
  }
  return found;
}

function leavesSpainOut(text) {
  if (EXCLUDES_SPAIN_RE.test(text)) return true;
  if (includesSpain(text)) return false;
  return listedCountries(text).length >= 2;
}

function contractorEvidence(text) {
  const deel = text.match(/\bDeel\b/i);
  if (deel) return deel[0];
  const remoteCom = text.match(/\bRemote\.com\b/i);
  if (remoteCom) return remoteCom[0];
  const autonomo = text.match(/\baut[oó]nomo\b/i);
  if (autonomo) return autonomo[0];
  return null;
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? collapse(match[0]) : null;
}

function placeClassOf(role) {
  return role.place_class || role.locationClass || "";
}

function isOnSiteSpain(placeClass) {
  return placeClass === "spain";
}

function isUsOnly(placeClass, text) {
  if (placeClass === "remote-us" || placeClass === "us-other") return true;
  return US_ONLY_RE.test(text) && !includesSpain(text);
}

/**
 * Concatenate the fields a board already parsed so the judge can quote them.
 */
export function postingTextFromJob(job, location = "") {
  return [job.title, location, ...(job.locationsRaw ?? []), job.descriptionText]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join("\n");
}

/**
 * @param {{ place_class?: string, locationClass?: string, text: string }} role
 * @returns {{ eligibility_class: string, evidence: string } | null}
 */
export function judgeSpainEmployable(role) {
  const placeClass = placeClassOf(role);
  const text = role.text ?? "";
  const contractor = contractorEvidence(text);

  if (isOnSiteSpain(placeClass)) return null;
  if (isUsOnly(placeClass, text)) return null;

  if (placeClass === "remote-spain" || REMOTE_SPAIN_RE.test(text)) {
    return {
      eligibility_class: "spain-named",
      evidence: firstMatch(text, REMOTE_SPAIN_RE) || firstMatch(text, SPAIN_RE) || "Spain",
    };
  }

  if (placeClass === "remote-europe" && !leavesSpainOut(text)) {
    return {
      eligibility_class: "eu-eea",
      evidence: firstMatch(text, EUROPE_PLACE_RE) || firstMatch(text, /\bEurope\b/) || "Europe",
    };
  }

  if (placeClass === "remote-global" && includesSpain(text) && !leavesSpainOut(text)) {
    return {
      eligibility_class: "worldwide",
      evidence: firstMatch(text, WORLDWIDE_SPAIN_RE) || firstMatch(text, SPAIN_RE) || "Spain",
    };
  }

  if (contractor && (placeClass.startsWith("remote-") || /\bremote\b/i.test(text))) {
    return { eligibility_class: "contractor", evidence: contractor };
  }

  return null;
}

export { ELIGIBILITY_CLASSES };
