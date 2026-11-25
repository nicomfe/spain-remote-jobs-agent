/**
 * Read-only MCP tools: find_jobs and get_startup.
 * Apply tools are never registered. The same `respond` runs over stdio in
 * development and in tests. Directory and jobs are plaintext JSON on disk.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const META = JSON.parse(readFileSync(join(ROOT, "server.json"), "utf8"));

export const SERVER = Object.freeze({
  name: "spain-remote-jobs-agent",
  title: META.title,
  version: META.version,
});

export const INSTRUCTIONS =
  "This server lists Spain-employable open roles at startups on the public " +
  "directory (find_jobs) and explains why a startup is listed (get_startup). " +
  "It is read-only. Apply tools are not registered here.";

const ELIGIBILITY_CLASSES = Object.freeze(["spain-named", "eu-eea", "worldwide", "contractor"]);
const CLASS_SET = new Set(ELIGIBILITY_CLASSES);

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

class QueryError extends Error {}

const blank = (value) => value === undefined || value === null || String(value).trim() === "";
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function fold(value) {
  return String(value ?? "").toLowerCase();
}

function contains(haystack, needle) {
  return fold(haystack).includes(fold(needle));
}

function whole(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^\s*-?\d+\s*$/.test(value)) return Number.parseInt(value, 10);
  return null;
}

function error(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function ok(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function toolResult(id, out) {
  return ok(id, {
    content: [{ type: "text", text: JSON.stringify(out) }],
    structuredContent: out,
  });
}

function toolError(id, message) {
  return ok(id, { content: [{ type: "text", text: message }], isError: true });
}

export function loadStore(directoryPath, jobsPath) {
  return {
    directory: JSON.parse(readFileSync(directoryPath, "utf8")),
    jobs: JSON.parse(readFileSync(jobsPath, "utf8")),
  };
}

function whyOnList(company) {
  const gate = company?.startup_gate;
  const kind = typeof gate === "string" ? gate : gate?.evidence;
  if (kind === "hand" || company?.via === "hand") {
    return {
      why: "Hand company: a person put it on the directory. It stays through a stretch with no qualifying role.",
      evidence: gate ?? { evidence: "hand" },
    };
  }
  if (kind === "yc") {
    return {
      why: "YC batch: the company passes the startup gate as a YC company.",
      evidence: gate,
    };
  }
  if (kind === "headcount") {
    return {
      why: "Known headcount under the cap of 200, with a URL for that figure.",
      evidence: gate,
    };
  }
  return {
    why: "The company is on the directory because it passed the startup gate.",
    evidence: gate ?? null,
  };
}

function statedPayCeiling(pay) {
  if (!pay || typeof pay !== "object") return null;
  if (Number.isFinite(pay.max)) return pay.max;
  if (Number.isFinite(pay.min)) return pay.min;
  return null;
}

function roleFilter(job, role) {
  return contains(job.title, role);
}

function textFilter(job, text) {
  return contains(job.title, text)
    || contains(job.company, text)
    || contains(job.location, text)
    || contains(job.description, text);
}

function eligibilityFilter(job, eligibilityClass) {
  return job.eligibility_class === eligibilityClass;
}

function statedPayFilter(job, minStatedPay) {
  const ceiling = statedPayCeiling(job.stated_pay);
  return ceiling !== null && ceiling >= minStatedPay;
}

export function findJobs(jobs, args = {}) {
  const role = blank(args.role) ? null : String(args.role).trim();
  const text = blank(args.text) ? null : String(args.text).trim();
  const eligibilityClass = blank(args.eligibility_class) ? null : String(args.eligibility_class).trim();
  const minStatedPay = args.min_stated_pay === undefined || args.min_stated_pay === null
    ? null
    : whole(args.min_stated_pay);

  if (eligibilityClass !== null && !CLASS_SET.has(eligibilityClass)) {
    throw new QueryError(
      `eligibility_class must be one of ${ELIGIBILITY_CLASSES.join(", ")}`,
    );
  }
  if (args.min_stated_pay !== undefined && args.min_stated_pay !== null && minStatedPay === null) {
    throw new QueryError("min_stated_pay must be a whole number");
  }

  const steps = [];
  if (role !== null) steps.push(["role", (job) => roleFilter(job, role)]);
  if (text !== null) steps.push(["text", (job) => textFilter(job, text)]);
  if (eligibilityClass !== null) {
    steps.push(["eligibility_class", (job) => eligibilityFilter(job, eligibilityClass)]);
  }
  if (minStatedPay !== null) {
    steps.push(["stated_pay", (job) => statedPayFilter(job, minStatedPay)]);
  }

  let remaining = Array.isArray(jobs) ? [...jobs] : [];
  let emptiedBy = null;
  for (const [name, predicate] of steps) {
    const next = remaining.filter(predicate);
    if (remaining.length > 0 && next.length === 0) emptiedBy = name;
    remaining = next;
  }

  const filters = {
    ...(role !== null ? { role } : {}),
    ...(text !== null ? { text } : {}),
    ...(eligibilityClass !== null ? { eligibility_class: eligibilityClass } : {}),
    ...(minStatedPay !== null ? { min_stated_pay: minStatedPay } : {}),
  };

  if (remaining.length) {
    return { jobs: remaining, matches: remaining.length, filters };
  }

  let reason;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    reason = "no open roles on disk";
  } else if (emptiedBy) {
    reason = `${emptiedBy} removed every match`;
  } else {
    reason = "no posting matches";
  }

  return {
    jobs: [],
    matches: 0,
    filters,
    empty: { filter: emptiedBy, reason },
  };
}

export function getStartup(directory, args = {}) {
  const name = blank(args.name) ? null : String(args.name).trim();
  const domain = blank(args.domain) ? null : String(args.domain).trim();
  if (!name && !domain) throw new QueryError("name or domain is required");

  const records = Array.isArray(directory) ? directory : [];
  const matches = records.filter((company) => {
    const nameOk = !name || fold(company.name) === fold(name);
    const domainOk = !domain || fold(company.domain) === fold(domain);
    return nameOk && domainOk;
  });

  if (!matches.length) {
    const label = name ? `'${name}'` : `'${domain}'`;
    throw new QueryError(`no startup ${label} on the directory`);
  }
  if (matches.length > 1) {
    throw new QueryError(
      `several startups match: ${matches.map((company) => company.name).join(", ")}`,
    );
  }

  const company = matches[0];
  const listed = whyOnList(company);
  return {
    name: company.name,
    domain: company.domain,
    ats: company.ats,
    board: company.board,
    hq_country: company.hq_country,
    via: company.via,
    startup_gate: company.startup_gate,
    eligibility_class: company.eligibility_class,
    evidence: company.evidence,
    last_crawl: company.last_crawl,
    open_role_count: company.open_role_count,
    why: listed.why,
    gate_evidence: listed.evidence,
  };
}

const TOOLS = {
  find_jobs: {
    define: () => ({
      title: "Open roles at kept startups",
      description:
        "Open Spain-employable roles from jobs.json. Filter by role (title text), " +
        "text (title, company, location, or posting text), eligibility class " +
        `(${ELIGIBILITY_CLASSES.join(", ")}), and min_stated_pay when the posting ` +
        "states pay. Roles with no stated pay are left out of a pay filter. When " +
        "nothing matches, empty.filter names the filter that removed every match.",
      inputSchema: {
        type: "object",
        properties: {
          role: { type: "string", description: "Words to find in the role title." },
          text: {
            type: "string",
            description: "Words to find in the title, company, location, or posting text.",
          },
          eligibility_class: {
            type: "string",
            enum: [...ELIGIBILITY_CLASSES],
            description: "Spain-employable class on the role.",
          },
          min_stated_pay: {
            type: "integer",
            description:
              "Keep postings whose stated pay (max, or min when there is no max) " +
              "is at least this figure, in the posting's own currency and period. " +
              "Postings with no stated pay are dropped.",
          },
        },
      },
    }),
    run: (store, args) => findJobs(store.jobs, args),
  },
  get_startup: {
    define: () => ({
      title: "Why a startup is on the directory",
      description:
        "One company from directory.json: why it passed the startup gate, with " +
        "the stored evidence (hand, YC, or headcount plus a URL).",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Company name, e.g. Cabify." },
          domain: { type: "string", description: "Company domain, e.g. cabify.com." },
        },
      },
    }),
    run: (store, args) => getStartup(store.directory, args),
  },
};

export function listedTools() {
  return Object.entries(TOOLS).map(([name, tool]) => {
    const defined = tool.define();
    return { name, ...defined, annotations: READ_ONLY };
  });
}

function callTool(store, id, params) {
  const name = params.name;
  const sent = params.arguments ?? {};
  if (!isObject(sent)) return error(id, INVALID_PARAMS, "arguments must be an object");
  const tool = typeof name === "string" && Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) return error(id, INVALID_PARAMS, `unknown tool '${name}'`);
  try {
    return toolResult(id, tool.run(store, sent));
  } catch (err) {
    if (err instanceof QueryError) return toolError(id, err.message);
    throw err;
  }
}

function handle(store, msg) {
  if (!isObject(msg)) return error(null, INVALID_REQUEST, "invalid request: expected a JSON-RPC object");
  const { method, id } = msg;
  if (id === undefined || id === null) return null;
  if (typeof method !== "string") return error(id, INVALID_REQUEST, "invalid request: no method");
  if (msg.params != null && !isObject(msg.params)) {
    return error(id, INVALID_PARAMS, "params must be an object");
  }
  const params = isObject(msg.params) ? msg.params : {};
  try {
    if (method === "initialize") {
      const asked = params.protocolVersion;
      const protocolVersion = asked === "2025-06-18" || asked === "2025-03-26" || asked === "2024-11-05"
        ? asked
        : "2025-11-25";
      return ok(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    if (method === "ping") return ok(id, {});
    if (method === "tools/list") return ok(id, { tools: listedTools() });
    if (method === "tools/call") return callTool(store, id, params);
    return error(id, METHOD_NOT_FOUND, `method not found: ${method}`);
  } catch (err) {
    console.error(err);
    return error(id, INTERNAL_ERROR, "internal error");
  }
}

export function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return { parseError: true };
  }
}

export async function respond(store, msg) {
  if (msg?.parseError) return error(null, PARSE_ERROR, "parse error");
  if (!Array.isArray(msg)) return handle(store, msg);
  if (!msg.length) return error(null, INVALID_REQUEST, "invalid request: empty batch");
  const replies = [];
  for (const item of msg) {
    const reply = handle(store, item);
    if (reply) replies.push(reply);
  }
  return replies.length ? replies : null;
}
