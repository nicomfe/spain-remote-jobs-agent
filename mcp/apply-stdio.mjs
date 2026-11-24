#!/usr/bin/env node
// Apply MCP over stdio. Not the hosted server.
//
//     node mcp/apply-stdio.mjs
//
// Reads jobs, a private contacts file, and a CV from disk. Dev writes an
// outbox. No network. SMTP password from SMTP_PASSWORD, never logged.
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadApplyStore, parseLine, respond } from "./apply.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = loadApplyStore({
  jobsPath: process.env.MCP_JOBS ?? join(root, "data/jobs.json"),
  contactsPath: process.env.APPLY_CONTACTS ?? join(root, "contacts.json"),
  cvPath: process.env.APPLY_CV ?? join(root, "cv.json"),
  questionsPath: process.env.APPLY_QUESTIONS ?? join(root, "questions.json"),
  outboxPath: process.env.APPLY_OUTBOX ?? join(root, "outbox.jsonl"),
  sentPath: process.env.APPLY_SENT ?? join(root, "sent.json"),
  smtpPassword: process.env.SMTP_PASSWORD ?? null,
});

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const reply = await respond(store, parseLine(line));
  if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
}
