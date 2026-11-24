/**
 * Stdio-only apply MCP. Never registered on the hosted/public server.
 * Tools: job_questions, application_guide, hiring_contact, send_message.
 */

import {
  ApplyError,
  applicationGuide,
  hiringContact,
  jobQuestions,
  loadApplyFiles,
  sendMessage,
} from "../lib/apply.js";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const OPEN = { readOnlyHint: false, openWorldHint: false };

export const SERVER = Object.freeze({
  name: "spain-remote-jobs-apply",
  title: "Spain remote jobs — apply (stdio)",
  version: "0.0.1",
});

export const INSTRUCTIONS =
  "Apply on this machine. Fill answers from the CV and ask for anything the " +
  "CV does not cover. Send a message only after an explicit yes. LinkedIn is " +
  "a draft the person sends. At most 3 messages a day, email and LinkedIn " +
  "together. Hiring contacts stay in the private contacts file.";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

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

const TOOLS = {
  job_questions: {
    define: () => ({
      title: "Application questions for a found job",
      description:
        "Questions for one posting already returned by find_jobs. No network. " +
        "When no form is on file, the posting URL is returned.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Job id from find_jobs." },
        },
      },
    }),
    run: (store, args) => jobQuestions(store, args),
  },
  application_guide: {
    define: () => ({
      title: "Fill the application from the CV",
      description:
        "Fills each question from the person's CV. Anything the CV does not " +
        "answer is listed under ask, never invented. Send only after a yes. " +
        "Cap is 3 messages a day.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Job id from find_jobs." },
        },
      },
    }),
    run: (store, args) => applicationGuide(store, args),
  },
  hiring_contact: {
    define: () => ({
      title: "Hiring contact for a found job",
      description:
        "People on file for this posting, from the private contacts file. " +
        "Never guess an address. At most 3 messages a day.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Job id from find_jobs." },
        },
      },
    }),
    run: (store, args) => hiringContact(store, args),
  },
  send_message: {
    define: () => ({
      title: "Send or draft a message after a yes",
      description:
        "Email is written to the local outbox (SMTP only if a mailer is " +
        "injected). LinkedIn is a draft the person sends. confirm must be yes. " +
        "The SMTP password is never recorded.",
      inputSchema: {
        type: "object",
        required: ["id", "channel", "confirm", "text"],
        properties: {
          id: { type: "string", description: "Job id from find_jobs." },
          channel: { type: "string", enum: ["email", "linkedin"] },
          confirm: { type: "string", description: "Must be yes to send." },
          text: { type: "string" },
          subject: { type: "string", description: "Email subject." },
        },
      },
    }),
    run: (store, args) => sendMessage(store, args, { smtpPassword: store.smtpPassword }),
  },
};

export function listedTools() {
  return Object.entries(TOOLS).map(([name, tool]) => {
    const defined = tool.define();
    return { name, ...defined, annotations: OPEN };
  });
}

export function loadApplyStore(paths) {
  return loadApplyFiles(paths);
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
    if (err instanceof ApplyError) return toolError(id, err.message);
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
