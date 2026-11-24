import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = readFileSync(join(root, "skills/SKILL.md"), "utf8");

test("the skill says when to call find_jobs, get_startup, and the apply tools", () => {
  assert.match(skill, /when to call/i);
  assert.match(skill, /find_jobs/);
  assert.match(skill, /get_startup/);
  assert.match(skill, /job_questions/);
  assert.match(skill, /application_guide/);
  assert.match(skill, /hiring_contact/);
  assert.match(skill, /send_message/);
  assert.match(skill, /Call when looking up qualifying roles/i);
  assert.match(skill, /Call when explaining why a startup is on the directory/i);
  assert.match(skill, /Call after `find_jobs` has returned a posting/i);
  assert.match(skill, /Call when filling the application/i);
  assert.match(skill, /Call when the person needs who to write to/i);
  assert.match(skill, /Call only to send or draft after the person has said yes/i);
});

test("the skill says invent nothing, fill from the CV, send only after a yes, and stop at 3 messages a day", () => {
  assert.match(skill, /Invent nothing/i);
  assert.match(skill, /Fill from the CV/i);
  assert.match(skill, /Send only after a yes/i);
  assert.match(skill, /Stop at 3 messages a day/i);
});

test("the skill keeps public MCP read-only and apply stdio-only", () => {
  assert.match(skill, /read-only/i);
  assert.match(skill, /stdio-only/);
  assert.match(skill, /find_jobs` and `get_startup` only/);
});
