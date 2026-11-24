import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MESSAGES_A_DAY,
  applicationGuide,
  fillFromCv,
  hiringContact,
  jobQuestions,
  loadContacts,
  sendMessage,
} from "../lib/apply.js";
import { listedTools as publicListedTools } from "../mcp/index.js";
import { listedTools, loadApplyStore, respond } from "../mcp/apply.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures/apply");
const jobsPath = join(root, "tests/fixtures/mcp/jobs.json");
const contactsPath = join(fixtureDir, "contacts.json");
const cvPath = join(fixtureDir, "cv.json");
const questionsPath = join(fixtureDir, "questions.json");
const JOB_ID = "greenhouse:cabify:1001";
const SUPPORT_ID = "greenhouse:cabify:1003";
const ACME_ID = "ashby:acme:aaaa-1111";

const out = (reply) => reply.result?.structuredContent;
const tool = (name, args, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

function applyStore(paths = {}) {
  return loadApplyStore({
    jobsPath,
    contactsPath,
    cvPath,
    questionsPath,
    ...paths,
  });
}

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "apply-09-"));
  return {
    dir,
    outboxPath: join(dir, "outbox.jsonl"),
    sentPath: join(dir, "sent.json"),
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("the public MCP still lists find_jobs and get_startup only", () => {
  assert.deepEqual(publicListedTools().map((item) => item.name), ["find_jobs", "get_startup"]);
});

test("apply tools/list is stdio-only: questions, guide, contact, send", () => {
  assert.deepEqual(listedTools().map((item) => item.name), [
    "job_questions",
    "application_guide",
    "hiring_contact",
    "send_message",
  ]);
});

test("job_questions returns the application questions for a found job", () => {
  const store = applyStore();
  const result = jobQuestions(store, { id: JOB_ID });
  assert.equal(result.id, JOB_ID);
  assert.equal(result.title, "Backend Engineer");
  assert.equal(result.company, "Cabify");
  assert.equal(result.url, "https://job-boards.greenhouse.io/cabify/jobs/1001");
  assert.deepEqual(result.questions.map((item) => item.id), ["name", "email", "why", "salary"]);
  assert.equal(result.questions.some((item) => item.prompt === "Why do you want this role?"), true);
});

test("job_questions for a found job with no form on file names the posting URL", () => {
  const result = jobQuestions(applyStore(), { id: SUPPORT_ID });
  assert.equal(result.id, SUPPORT_ID);
  assert.deepEqual(result.questions, []);
  assert.match(result.note, /posting URL/i);
});

test("job_questions refuses an unknown job", () => {
  assert.throws(() => jobQuestions(applyStore(), { id: "greenhouse:nobody:1" }), /no posting/i);
});

test("the guide is filled from the CV and asks what the CV does not answer", () => {
  const store = applyStore();
  const cv = JSON.parse(readFileSync(cvPath, "utf8"));
  const questions = jobQuestions(store, { id: JOB_ID }).questions;
  const filled = fillFromCv(cv, questions);
  assert.deepEqual(filled.answers.map((item) => item.id), ["name", "email"]);
  assert.equal(filled.answers.find((item) => item.id === "name").answer, "Nico Fetter");
  assert.deepEqual(filled.ask.map((item) => item.id), ["why", "salary"]);
  assert.equal(filled.answers.some((item) => item.id === "why"), false);
  assert.equal(filled.answers.some((item) => item.id === "salary"), false);

  const guide = applicationGuide(store, { id: JOB_ID });
  assert.deepEqual(guide.filled.map((item) => item.answer), ["Nico Fetter", "nico@example.com"]);
  assert.deepEqual(guide.ask.map((item) => item.id), ["why", "salary"]);
  assert.equal(guide.rules.some((rule) => /never invented/i.test(rule)), true);
  assert.equal(JSON.stringify(guide).includes("€80,000"), false);
  assert.equal(JSON.stringify(guide).includes("I am passionate"), false);
});

test("hiring_contact comes from the private contacts file, keyed to the posting", () => {
  const store = applyStore();
  const forEngineer = hiringContact(store, { id: JOB_ID });
  assert.equal(forEngineer.contacts.length, 2);
  assert.equal(forEngineer.contacts[0].write_by, "email");
  assert.equal(forEngineer.contacts[0].email, "ada@example.com");
  assert.equal(forEngineer.contacts[1].write_by, "linkedin");
  assert.equal(forEngineer.contacts[1].linkedin, "https://www.linkedin.com/in/bo-example");
  assert.equal(forEngineer.messages_a_day, MESSAGES_A_DAY);
  assert.equal(MESSAGES_A_DAY, 3);
  assert.equal(forEngineer.rules.some((rule) => /At most 3 messages a day/i.test(rule)), true);

  const forSupport = hiringContact(store, { id: SUPPORT_ID });
  assert.equal(forSupport.contacts.length, 1);
  assert.equal(forSupport.contacts[0].kind, "recruiter");

  const none = hiringContact(store, { id: ACME_ID });
  assert.deepEqual(none.contacts, []);
  assert.match(none.reason, /do not guess/i);
});

test("the contacts fixture lives under tests/ and never under data/", () => {
  assert.equal(existsSync(join(root, "tests/fixtures/apply/contacts.json")), true);
  assert.equal(existsSync(join(root, "data/contacts.json")), false);
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.match(ignore, /^\/contacts\.json$/m);
  const loaded = loadContacts(contactsPath);
  assert.equal(loaded.companies.cabify[0].email, "ada@example.com");
});

test("a message is sent only after the person says yes, and what was sent is recorded", () => {
  const disk = scratch();
  const now = new Date("2026-11-24T12:00:00.000Z");
  const store = applyStore({ outboxPath: disk.outboxPath, sentPath: disk.sentPath });
  try {
    const refused = sendMessage(store, {
      id: JOB_ID,
      channel: "email",
      confirm: "later",
      text: "Hello Ada, I applied for Backend Engineer.",
      subject: "Backend Engineer",
    }, { now });
    assert.equal(refused.sent, false);
    assert.match(refused.reason, /yes/i);
    assert.equal(existsSync(disk.outboxPath), false);
    assert.equal(existsSync(disk.sentPath), false);

    const sent = sendMessage(store, {
      id: JOB_ID,
      channel: "email",
      confirm: "yes",
      text: "Hello Ada, I applied for Backend Engineer.",
      subject: "Backend Engineer",
    }, { now, smtpPassword: "secret-smtp" });
    assert.equal(sent.sent, true);
    assert.equal(sent.channel, "email");
    assert.equal(sent.status, "outbox");
    const outbox = readFileSync(disk.outboxPath, "utf8");
    const ledger = JSON.parse(readFileSync(disk.sentPath, "utf8"));
    assert.match(outbox, /Hello Ada, I applied for Backend Engineer/);
    assert.equal(outbox.includes("secret-smtp"), false);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].job_id, JOB_ID);
    assert.equal(ledger[0].channel, "email");
    assert.equal(ledger[0].text, "Hello Ada, I applied for Backend Engineer.");
    assert.equal(JSON.stringify(ledger).includes("ada@example.com"), false);
    assert.equal(JSON.stringify(ledger).includes("Ada Example"), false);
    assert.equal(JSON.stringify(ledger).includes("secret-smtp"), false);
  } finally {
    disk.close();
  }
});

test("LinkedIn is a draft the person sends, and the cap is 3 messages a day for both channels", () => {
  const disk = scratch();
  const now = new Date("2026-11-24T12:00:00.000Z");
  const store = applyStore({ outboxPath: disk.outboxPath, sentPath: disk.sentPath });
  try {
    const draft = sendMessage(store, {
      id: JOB_ID,
      channel: "linkedin",
      confirm: "yes",
      text: "Hi Bo, I applied for Backend Engineer.",
    }, { now });
    assert.equal(draft.sent, true);
    assert.equal(draft.status, "draft");
    assert.match(draft.note, /person sends/i);

    sendMessage(store, {
      id: JOB_ID,
      channel: "email",
      confirm: "yes",
      text: "Second",
      subject: "Second",
    }, { now });
    sendMessage(store, {
      id: JOB_ID,
      channel: "email",
      confirm: "yes",
      text: "Third",
      subject: "Third",
    }, { now });

    const fourth = sendMessage(store, {
      id: JOB_ID,
      channel: "email",
      confirm: "yes",
      text: "Fourth",
      subject: "Fourth",
    }, { now });
    assert.equal(fourth.sent, false);
    assert.match(fourth.reason, /3 messages a day/i);

    const nextDay = sendMessage(store, {
      id: JOB_ID,
      channel: "email",
      confirm: "yes",
      text: "Next day",
      subject: "Next day",
    }, { now: new Date("2026-11-25T00:00:00.000Z") });
    assert.equal(nextDay.sent, true);

    const ledger = JSON.parse(readFileSync(disk.sentPath, "utf8"));
    assert.equal(ledger.filter((row) => row.day === "2026-11-24").length, 3);
    assert.equal(ledger.filter((row) => row.channel === "linkedin").length, 1);
  } finally {
    disk.close();
  }
});

test("tools/call on the apply server returns structured apply results", async () => {
  const disk = scratch();
  const store = applyStore({ outboxPath: disk.outboxPath, sentPath: disk.sentPath });
  try {
    const questions = await respond(store, tool("job_questions", { id: JOB_ID }));
    assert.equal(out(questions).questions.length, 4);

    const guide = await respond(store, tool("application_guide", { id: JOB_ID }));
    assert.deepEqual(out(guide).ask.map((item) => item.id), ["why", "salary"]);

    const contact = await respond(store, tool("hiring_contact", { id: JOB_ID }));
    assert.equal(out(contact).contacts.length, 2);

    const no = await respond(store, tool("send_message", {
      id: JOB_ID,
      channel: "email",
      confirm: "no",
      text: "Nope",
      subject: "Nope",
    }));
    assert.equal(out(no).sent, false);

    const yes = await respond(store, tool("send_message", {
      id: JOB_ID,
      channel: "linkedin",
      confirm: "yes",
      text: "Draft for Bo",
    }));
    assert.equal(out(yes).status, "draft");
  } finally {
    disk.close();
  }
});

test("apply stdio serves the same answers from disk with no network", () => {
  const disk = scratch();
  try {
    const calls = [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      tool("job_questions", { id: JOB_ID }, 2),
      tool("application_guide", { id: JOB_ID }, 3),
      tool("hiring_contact", { id: JOB_ID }, 4),
      tool("send_message", {
        id: JOB_ID,
        channel: "linkedin",
        confirm: "yes",
        text: "Draft",
      }, 5),
    ];
    const stdout = execFileSync(
      "node",
      [join(root, "mcp/apply-stdio.mjs")],
      {
        input: `${calls.map((call) => JSON.stringify(call)).join("\n")}\n`,
        encoding: "utf8",
        env: {
          ...process.env,
          MCP_JOBS: jobsPath,
          APPLY_CONTACTS: contactsPath,
          APPLY_CV: cvPath,
          APPLY_QUESTIONS: questionsPath,
          APPLY_OUTBOX: disk.outboxPath,
          APPLY_SENT: disk.sentPath,
        },
      },
    );
    const replies = stdout.trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(replies[0].result.tools.map((item) => item.name), [
      "job_questions",
      "application_guide",
      "hiring_contact",
      "send_message",
    ]);
    assert.equal(out(replies[1]).questions.length, 4);
    assert.equal(out(replies[2]).ask.length, 2);
    assert.equal(out(replies[3]).contacts[0].email, "ada@example.com");
    assert.equal(out(replies[4]).status, "draft");
  } finally {
    disk.close();
  }
});
