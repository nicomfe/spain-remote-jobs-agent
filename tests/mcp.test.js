import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SERVER,
  findJobs,
  getStartup,
  listedTools,
  loadStore,
  respond,
} from "../mcp/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures/mcp");
const directoryPath = join(fixtureDir, "directory.json");
const jobsPath = join(fixtureDir, "jobs.json");
const store = loadStore(directoryPath, jobsPath);
const jobs = store.jobs;
const directory = store.directory;
const out = (reply) => reply.result?.structuredContent;
const tool = (name, args, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

test("the server name and version match server.json", () => {
  const meta = JSON.parse(readFileSync(join(root, "server.json"), "utf8"));
  assert.equal(SERVER.name, "spain-remote-jobs-agent");
  assert.equal(SERVER.version, meta.version);
  assert.equal(typeof meta.version, "string");
  assert.ok(meta.version.length > 0);
  assert.equal(meta.name, "com.nicofetter/spain-remote-jobs-agent");
});

test("tools/list offers find_jobs and get_startup only", async () => {
  const names = listedTools().map((item) => item.name);
  assert.deepEqual(names, ["find_jobs", "get_startup"]);
  const reply = await respond(store, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(reply.result.tools.map((item) => item.name), ["find_jobs", "get_startup"]);
  assert.equal(names.includes("job_questions"), false);
  assert.equal(names.includes("application_guide"), false);
  assert.equal(names.includes("hiring_contact"), false);
});

test("initialize carries the server name and version", async () => {
  const reply = await respond(store, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25" },
  });
  assert.deepEqual(reply.result.serverInfo, SERVER);
  assert.equal(reply.result.protocolVersion, "2025-11-25");
});

test("find_jobs filters by role, text, eligibility class, and stated pay", () => {
  const byRole = findJobs(jobs, { role: "engineer" });
  assert.ok(byRole.jobs.every((job) => /engineer/i.test(job.title)));
  assert.ok(byRole.jobs.some((job) => job.id === "greenhouse:cabify:1001"));
  assert.equal(byRole.jobs.some((job) => job.title === "Support Specialist"), false);

  const byText = findJobs(jobs, { text: "cabify" });
  assert.ok(byText.jobs.length >= 2);
  assert.ok(byText.jobs.every((job) => job.company === "Cabify"));

  const byClass = findJobs(jobs, { eligibility_class: "eu-eea" });
  assert.deepEqual(byClass.jobs.map((job) => job.id), ["ashby:acme:aaaa-1111"]);

  const byPay = findJobs(jobs, { min_stated_pay: 85000 });
  assert.deepEqual(byPay.jobs.map((job) => job.id), ["ashby:acme:aaaa-1111"]);
  assert.equal(byPay.jobs.some((job) => job.stated_pay == null), false);
});

test("an empty find_jobs result names the filter that removed every match", () => {
  const byRole = findJobs(jobs, { role: "astronaut" });
  assert.equal(byRole.matches, 0);
  assert.equal(byRole.empty.filter, "role");
  assert.equal(byRole.empty.reason, "role removed every match");

  const byText = findJobs(jobs, { text: "no-such-place" });
  assert.equal(byText.empty.filter, "text");

  const byClass = findJobs(jobs, { role: "Support", eligibility_class: "contractor" });
  assert.equal(byClass.empty.filter, "eligibility_class");
  assert.equal(byClass.empty.reason, "eligibility_class removed every match");

  const byPay = findJobs(jobs, { eligibility_class: "spain-named", min_stated_pay: 200000 });
  assert.equal(byPay.empty.filter, "stated_pay");
  assert.equal(byPay.empty.reason, "stated_pay removed every match");

  const none = findJobs([], { role: "engineer" });
  assert.equal(none.empty.filter, null);
  assert.equal(none.empty.reason, "no open roles on disk");
});

test("get_startup returns why the company is on the list, with the evidence", () => {
  const hand = getStartup(directory, { name: "Cabify" });
  assert.equal(hand.via, "hand");
  assert.deepEqual(hand.startup_gate, { evidence: "hand" });
  assert.deepEqual(hand.gate_evidence, { evidence: "hand" });
  assert.match(hand.why, /hand/i);
  assert.equal(hand.domain, "cabify.com");

  const yc = getStartup(directory, { domain: "acme.example" });
  assert.deepEqual(yc.startup_gate, { evidence: "yc" });
  assert.match(yc.why, /YC/i);

  const headcount = getStartup(directory, { name: "Headcount Co" });
  assert.equal(headcount.startup_gate.evidence, "headcount");
  assert.equal(headcount.startup_gate.url, "https://headcount.example/about");
  assert.equal(headcount.startup_gate.headcount, 80);
  assert.deepEqual(headcount.gate_evidence, headcount.startup_gate);
  assert.match(headcount.why, /headcount/i);
});

test("tools/call returns structured find_jobs and get_startup results", async () => {
  const jobsReply = await respond(store, tool("find_jobs", { eligibility_class: "worldwide" }));
  assert.equal(out(jobsReply).matches, 1);
  assert.equal(out(jobsReply).jobs[0].company, "Factorial");

  const startupReply = await respond(store, tool("get_startup", { name: "Cabify" }));
  assert.equal(out(startupReply).name, "Cabify");
  assert.ok(out(startupReply).why);
});

test("unknown tools including apply names are refused", async () => {
  for (const name of ["job_questions", "application_guide", "hiring_contact", "constructor"]) {
    const reply = await respond(store, tool(name, {}));
    assert.equal(reply.error.code, -32602);
  }
});

test("stdio serves the same answers from disk with no network", () => {
  const calls = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25" } },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    tool("find_jobs", { role: "Support" }, 3),
    tool("find_jobs", { role: "astronaut" }, 4),
    tool("get_startup", { name: "Cabify" }, 5),
  ];
  const stdout = execFileSync(
    "node",
    [join(root, "mcp/stdio.mjs"), directoryPath, jobsPath],
    { input: `${calls.map((call) => JSON.stringify(call)).join("\n")}\n`, encoding: "utf8" },
  );
  const replies = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(replies.length, 5);
  assert.deepEqual(replies[0].result.serverInfo, SERVER);
  assert.deepEqual(replies[1].result.tools.map((item) => item.name), ["find_jobs", "get_startup"]);
  assert.equal(out(replies[2]).jobs[0].title, "Support Specialist");
  assert.equal(out(replies[3]).empty.filter, "role");
  assert.equal(out(replies[4]).startup_gate.evidence, "hand");
});
