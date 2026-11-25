import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/private_data.sh");

const contacts = {
  as_of: "2026-11-25",
  companies: {
    cabify: [{ kind: "recruiter", name: "Ada Example", email: "ada@example.com", jobs: [] }],
  },
};
const cursors = { greenhouse: { cabify: "2026-11-25T00:00:00Z" } };
const notes = { "cabify.com": "about page said 80, recheck 2026-12-01" };

function envFor(dir, repo, key = "test-key-not-a-secret") {
  return {
    PATH: process.env.PATH,
    HOME: dir,
    DATA_KEY: key,
    SRJ_PRIVATE_DIR: join(dir, "plain"),
    SRJ_PRIVATE_CLONE: join(dir, "clone"),
    SRJ_PRIVATE_REPO: repo,
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
}

function run(args, env) {
  return spawnSync("bash", [script, ...args], { env, encoding: "utf8" });
}

function initBare(dir) {
  const repo = join(dir, "origin.git");
  const made = spawnSync("git", ["init", "--bare", "-b", "main", repo], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return repo;
}

function writePlain(env) {
  const plain = env.SRJ_PRIVATE_DIR;
  spawnSync("mkdir", ["-p", plain]);
  writeFileSync(join(plain, "contacts.json"), `${JSON.stringify(contacts, null, 2)}\n`);
  writeFileSync(join(plain, "cursors.json"), `${JSON.stringify(cursors, null, 2)}\n`);
  writeFileSync(join(plain, "headcount-notes.json"), `${JSON.stringify(notes, null, 2)}\n`);
  writeFileSync(join(plain, "jobs.json"), "{\"public\":true}\n");
  writeFileSync(join(plain, "directory.json"), "{\"public\":true}\n");
}

test("push stores ciphertext the ADR cipher can open, and pull restores only the private files", () => {
  const dir = mkdtempSync(join(tmpdir(), "private-data-"));
  const repo = initBare(dir);
  const env = envFor(dir, repo);
  writePlain(env);

  const pushed = run(["push"], env);
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);

  const blob = join(env.SRJ_PRIVATE_CLONE, "data.tar.gz.enc");
  const cipher = readFileSync(blob);
  assert.equal(cipher.includes("ada@example.com"), false);
  assert.equal(cipher.includes("cabify.com"), false);

  const tarPath = join(dir, "bundle.tar.gz");
  const opened = spawnSync(
    "openssl",
    ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "600000", "-md", "sha256", "-pass", "env:DATA_KEY", "-in", blob, "-out", tarPath],
    { env, encoding: "utf8" },
  );
  assert.equal(opened.status, 0, opened.stderr);
  const names = spawnSync("tar", ["-tzf", tarPath], { encoding: "utf8" });
  assert.equal(names.status, 0, names.stderr);
  assert.deepEqual(names.stdout.trim().split("\n").sort(), [
    "contacts.json",
    "cursors.json",
    "headcount-notes.json",
  ]);

  const restored = join(dir, "restored");
  const pullEnv = { ...env, SRJ_PRIVATE_DIR: restored, SRJ_PRIVATE_CLONE: join(dir, "clone-pull") };
  const pulled = run(["pull"], pullEnv);
  assert.equal(pulled.status, 0, pulled.stderr || pulled.stdout);
  assert.equal(readFileSync(join(restored, "contacts.json"), "utf8"), readFileSync(join(env.SRJ_PRIVATE_DIR, "contacts.json"), "utf8"));
  assert.equal(readFileSync(join(restored, "cursors.json"), "utf8"), readFileSync(join(env.SRJ_PRIVATE_DIR, "cursors.json"), "utf8"));
  assert.equal(readFileSync(join(restored, "headcount-notes.json"), "utf8"), readFileSync(join(env.SRJ_PRIVATE_DIR, "headcount-notes.json"), "utf8"));
  assert.equal(spawnSync("test", ["!", "-e", join(restored, "jobs.json")]).status, 0);
  assert.equal(spawnSync("test", ["!", "-e", join(restored, "directory.json")]).status, 0);
  assert.equal(`${pushed.stdout}${pushed.stderr}`.includes(env.DATA_KEY), false);
});

test("a wrong key leaves the plaintext files untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "private-data-"));
  const repo = initBare(dir);
  const env = envFor(dir, repo);
  writePlain(env);
  const pushed = run(["push"], env);
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);

  const restored = join(dir, "restored");
  spawnSync("mkdir", ["-p", restored]);
  const sentinel = `${JSON.stringify({ companies: { kept: [{ email: "kept@example.com" }] } })}\n`;
  writeFileSync(join(restored, "contacts.json"), sentinel);
  const pullEnv = {
    ...env,
    DATA_KEY: "wrong-key",
    SRJ_PRIVATE_DIR: restored,
    SRJ_PRIVATE_CLONE: join(dir, "clone-pull"),
  };
  const pulled = run(["pull"], pullEnv);
  assert.notEqual(pulled.status, 0);
  assert.equal(readFileSync(join(restored, "contacts.json"), "utf8"), sentinel);
  assert.equal(`${pulled.stdout}${pulled.stderr}`.includes("wrong-key"), false);
  assert.equal(`${pulled.stdout}${pulled.stderr}`.includes("ada@example.com"), false);
});

test("push refuses when the private repo moved since the last pull", () => {
  const dir = mkdtempSync(join(tmpdir(), "private-data-"));
  const repo = initBare(dir);
  const env = envFor(dir, repo);
  writePlain(env);
  assert.equal(run(["push"], env).status, 0);

  const other = {
    ...env,
    SRJ_PRIVATE_DIR: join(dir, "other-plain"),
    SRJ_PRIVATE_CLONE: join(dir, "other-clone"),
  };
  assert.equal(run(["pull"], other).status, 0);
  const updated = JSON.parse(readFileSync(join(other.SRJ_PRIVATE_DIR, "contacts.json"), "utf8"));
  updated.companies.cabify[0].email = "boa@example.com";
  writeFileSync(join(other.SRJ_PRIVATE_DIR, "contacts.json"), `${JSON.stringify(updated, null, 2)}\n`);
  assert.equal(run(["push"], other).status, 0);

  const again = run(["push"], env);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /moved since the last pull/);

  const out = join(dir, "contacts-out.json");
  const extracted = run(["contacts", out], { ...env, SRJ_PRIVATE_CLONE: join(dir, "contacts-clone") });
  assert.equal(extracted.status, 0, extracted.stderr || extracted.stdout);
  assert.equal(JSON.parse(readFileSync(out, "utf8")).companies.cabify[0].email, "boa@example.com");
  assert.equal(spawnSync("test", ["!", "-e", join(dir, "cursors.json")]).status, 0);
});

test("without SRJ_PRIVATE_CLONE the ciphertext repo is the sibling spain-remote-jobs-agent-data", () => {
  const dir = mkdtempSync(join(tmpdir(), "private-data-"));
  const product = join(dir, "spain-remote-jobs-agent");
  spawnSync("mkdir", ["-p", product]);
  const repo = initBare(dir);
  const env = envFor(dir, repo);
  delete env.SRJ_PRIVATE_CLONE;
  env.SRJ_ROOT = product;
  writePlain(env);

  const pushed = run(["push"], env);
  assert.equal(pushed.status, 0, pushed.stderr || pushed.stdout);

  const clone = join(dir, "spain-remote-jobs-agent-data");
  assert.equal(spawnSync("test", ["-d", join(clone, ".git")]).status, 0);
  const cipher = readFileSync(join(clone, "data.tar.gz.enc"));
  assert.equal(cipher.includes("ada@example.com"), false);
  assert.equal(spawnSync("test", ["!", "-e", join(clone, "contacts.json")]).status, 0);
  assert.equal(spawnSync("test", ["!", "-e", join(clone, "jobs.json")]).status, 0);
});
