import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "web");
const MCP_URL = "https://spain-remote-agent.nicofetter.com/mcp";
const PAY_IN_HEADLINE =
  /[$€£¥]|usd|eur|\bsalary\b|\bsueldo\b|\bsalario\b|\bstated pay\b|\b\d[\d.,]*\s*(k|mil)/i;

function htmlFiles() {
  return readdirSync(web).filter((name) => name.endsWith(".html"));
}

function readPage(name) {
  return readFileSync(join(web, name), "utf8");
}

function headline(html) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  assert.ok(match, "page is missing an h1 headline");
  return match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("there is one landing page per language", () => {
  const files = htmlFiles().sort();
  assert.deepEqual(files, ["en.html", "es.html"]);
  const english = readPage("en.html");
  const spanish = readPage("es.html");
  assert.match(english, /<html\b[^>]*\blang="en"/i);
  assert.match(spanish, /<html\b[^>]*\blang="es"/i);
});

test("each page funnels the person into the MCP", () => {
  for (const name of htmlFiles()) {
    const html = readPage(name);
    assert.ok(html.includes(MCP_URL), `${name} is missing the MCP URL`);
    assert.match(
      html,
      new RegExp(`<a\\b[^>]*\\bhref="${MCP_URL.replace(/[./]/g, "\\$&")}"`, "i"),
      `${name} must link into the MCP`,
    );
  }
});

test("the headline carries no pay figures", () => {
  for (const name of htmlFiles()) {
    const text = headline(readPage(name));
    assert.equal(PAY_IN_HEADLINE.test(text), false, `${name} headline mentions pay: ${text}`);
  }
});

test("the copy is about startups that will employ someone remotely from Spain", () => {
  const english = readPage("en.html");
  assert.match(english, /startups/i);
  assert.match(english, /employ/i);
  assert.match(english, /remotely from Spain/i);

  const spanish = readPage("es.html");
  assert.match(spanish, /startups/i);
  assert.match(spanish, /emple/i);
  assert.match(spanish, /remoto/i);
  assert.match(spanish, /España/);
});
