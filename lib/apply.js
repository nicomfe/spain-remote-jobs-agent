/**
 * Apply on the person's machine: questions, a guide filled from their CV,
 * a message only after an explicit yes, recorded locally. Hiring contacts
 * come from a private file. The cap is 3 messages a day, email and LinkedIn
 * together. Dev writes an outbox; nothing goes on the network unless a test
 * injects a mailer.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const MESSAGES_A_DAY = 3;
export const CONTACTS_FILENAME = "contacts.json";

export class ApplyError extends Error {}

const blank = (value) => value === undefined || value === null || String(value).trim() === "";
const fold = (value) => String(value ?? "").toLowerCase();
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function calendarDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

export function loadJson(path, fallback) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new ApplyError(`missing file ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadContacts(path) {
  const data = loadJson(path);
  if (!isObject(data) || !isObject(data.companies)) {
    throw new ApplyError("contacts file must be { companies: { slug: [contact] } }");
  }
  return data;
}

function findJob(jobs, id) {
  if (blank(id)) throw new ApplyError("id is required: a job id from find_jobs");
  const job = (Array.isArray(jobs) ? jobs : []).find((item) => item?.id === String(id).trim());
  if (!job) throw new ApplyError(`no posting '${id}' among found jobs`);
  return job;
}

function companyKey(job) {
  return fold(job.board || job.company);
}

function contactsFor(contacts, job) {
  const all = contacts?.companies?.[companyKey(job)]
    ?? contacts?.companies?.[fold(job.company)];
  if (!Array.isArray(all)) return [];
  return all.filter((person) => isObject(person) && (person.email || person.linkedin) && (
    !Array.isArray(person.jobs) || !person.jobs.length || person.jobs.includes(job.id)
  ));
}

function present(contact) {
  return {
    kind: contact.kind ?? "recruiter",
    name: contact.name ?? null,
    role: contact.role ?? null,
    write_by: contact.email ? "email" : "linkedin",
    email: contact.email ?? null,
    linkedin: contact.linkedin ?? null,
  };
}

export const MESSAGE_RULES = [
  `At most ${MESSAGES_A_DAY} messages a day for one person, emails and LinkedIn messages together. A fourth waits for another day.`,
  "An email only to the address from the private contacts file. A contact with no email is written to on LinkedIn: the agent drafts, the person sends. Do not drive LinkedIn yourself.",
  "Answers and the message come from the CV or what the person said. Experience, skills, titles, dates, pay and a 'why' are never invented; when the CV does not answer, ask.",
  "The person sees each message whole and says yes to that message. Nothing is sent before that yes.",
  "An email leaves through the person's own SMTP. The SMTP password stays with the person. LinkedIn is a draft the person sends.",
  "The hiring contact stays on the person's machine. It is never committed, published, or written into an issue or a log.",
];

export function jobQuestions(store, args = {}) {
  const job = findJob(store.jobs, args.id);
  const listed = store.questions?.[job.id];
  const questions = Array.isArray(listed) ? listed : [];
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    url: job.url,
    questions,
    ...(questions.length ? {} : { note: "No application form on file; use the posting URL." }),
  };
}

export function fillFromCv(cv, questions) {
  const answers = [];
  const ask = [];
  for (const question of questions) {
    const key = question.cv_key;
    const value = key && isObject(cv) ? cv[key] : undefined;
    if (!blank(value)) {
      answers.push({
        id: question.id,
        prompt: question.prompt,
        answer: Array.isArray(value) ? value.join(", ") : String(value),
      });
    } else {
      ask.push({
        id: question.id,
        prompt: question.prompt,
        required: question.required === true,
        cv_key: key ?? null,
      });
    }
  }
  return { answers, ask };
}

export function applicationGuide(store, args = {}) {
  const form = jobQuestions(store, args);
  const filled = fillFromCv(store.cv, form.questions);
  return {
    id: form.id,
    title: form.title,
    company: form.company,
    url: form.url,
    questions: form.questions,
    filled: filled.answers,
    ask: filled.ask,
    rules: MESSAGE_RULES,
    messages_a_day: MESSAGES_A_DAY,
  };
}

export function hiringContact(store, args = {}) {
  const job = findJob(store.jobs, args.id);
  const found = contactsFor(store.contacts, job);
  const base = {
    company: job.company,
    posting: { id: job.id, title: job.title, url: job.url },
  };
  if (!found.length) {
    return {
      ...base,
      contacts: [],
      reason: "Nobody at this company is on file for this posting. Apply on its board; do not guess an address or build one from a pattern.",
    };
  }
  return {
    ...base,
    contacts: found.map(present),
    checked: store.contacts?.as_of ?? null,
    messages_a_day: MESSAGES_A_DAY,
    rules: MESSAGE_RULES,
  };
}

function readLedger(path) {
  if (!path || !existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(data) ? data : [];
}

function writeLedger(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
}

function appendOutbox(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

export function messagesToday(ledger, now) {
  const day = calendarDay(now);
  return ledger.filter((row) => row.day === day).length;
}

function saidYes(value) {
  return fold(value) === "yes";
}

function pickRecipient(store, job, channel) {
  const people = contactsFor(store.contacts, job);
  if (channel === "email") {
    const person = people.find((item) => item.email);
    if (!person) throw new ApplyError("no email hiring contact on file for this posting");
    return { to: person.email, write_by: "email" };
  }
  if (channel === "linkedin") {
    const person = people.find((item) => item.linkedin && !item.email)
      ?? people.find((item) => item.linkedin);
    if (!person) throw new ApplyError("no LinkedIn hiring contact on file for this posting");
    return { to: person.linkedin, write_by: "linkedin" };
  }
  throw new ApplyError("channel must be email or linkedin");
}

/**
 * Send only after confirm is "yes". Dev/default mailer appends the outbox.
 * Tests may pass `mailer`. The SMTP password is handed to the mailer only.
 */
export function sendMessage(store, args = {}, options = {}) {
  const now = options.now ?? new Date();
  const job = findJob(store.jobs, args.id);
  const channel = fold(args.channel);
  if (channel !== "email" && channel !== "linkedin") {
    throw new ApplyError("channel must be email or linkedin");
  }
  if (blank(args.text)) throw new ApplyError("text is required");
  if (!saidYes(args.confirm)) {
    return { sent: false, reason: "A message is sent only after the person says yes." };
  }

  const ledger = readLedger(store.sentPath);
  if (messagesToday(ledger, now) >= MESSAGES_A_DAY) {
    return {
      sent: false,
      reason: `At most ${MESSAGES_A_DAY} messages a day, email and LinkedIn together.`,
    };
  }

  const recipient = pickRecipient(store, job, channel);
  const at = new Date(now).toISOString();
  const day = calendarDay(now);
  const status = channel === "linkedin" ? "draft" : "outbox";
  const text = String(args.text);
  const subject = blank(args.subject) ? null : String(args.subject);

  const payload = {
    at,
    channel,
    job_id: job.id,
    company: job.company,
    title: job.title,
    to: recipient.to,
    subject,
    text,
    status,
  };

  const mailer = options.mailer ?? ((row) => {
    if (!store.outboxPath) throw new ApplyError("outbox path is required");
    appendOutbox(store.outboxPath, row);
  });
  mailer(payload, { smtpPassword: options.smtpPassword ?? store.smtpPassword ?? null });

  const recorded = {
    at,
    day,
    job_id: job.id,
    company: job.company,
    title: job.title,
    channel,
    subject,
    text,
    status,
  };
  writeLedger(store.sentPath, [...ledger, recorded]);

  return {
    sent: true,
    channel,
    status,
    job_id: job.id,
    day,
    ...(status === "draft" ? { note: "LinkedIn is a draft the person sends." } : {}),
  };
}

export function loadApplyFiles({
  jobsPath,
  contactsPath,
  cvPath,
  questionsPath,
  outboxPath,
  sentPath,
  smtpPassword,
} = {}) {
  return {
    jobs: jobsPath ? loadJson(jobsPath, []) : [],
    contacts: contactsPath && existsSync(contactsPath) ? loadContacts(contactsPath) : { companies: {} },
    cv: cvPath && existsSync(cvPath) ? loadJson(cvPath, {}) : {},
    questions: questionsPath && existsSync(questionsPath) ? loadJson(questionsPath, {}) : {},
    outboxPath: outboxPath ?? null,
    sentPath: sentPath ?? null,
    smtpPassword: smtpPassword ?? null,
  };
}
