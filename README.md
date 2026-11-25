# Spain remote jobs

The public directory lists startups that will employ someone remotely from Spain. A read-only MCP lets an agent search those roles and see why a startup is listed.

## Use the MCP

Connect a client that speaks [streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) to:

`https://spain-remote-agent.nicofetter.com/mcp`

The same host serves a short landing page at `https://spain-remote-agent.nicofetter.com/`. English and Spanish: `/en.html` and `/es.html`.

```json
{
  "mcpServers": {
    "spain-remote-jobs": {
      "url": "https://spain-remote-agent.nicofetter.com/mcp"
    }
  }
}
```

Two tools, both read-only:

| Tool | Ask with | You get |
|------|----------|---------|
| `find_jobs` | Optional `role` (words in the title), `text` (title, company, location, or posting text), `eligibility_class` (`spain-named`, `eu-eea`, `worldwide`, `contractor`), `min_stated_pay` | Open Spain-employable roles. A pay filter drops roles that do not state pay. |
| `get_startup` | `name` or `domain` | Why that startup is on the directory, with the stored evidence. |

Hiring contacts and apply tools are not on this server. Apply stays on the person's own machine.

## Quick path

1. Connect the MCP above to look up roles.
2. Open `data/directory.json` and `data/jobs.json` for the published Directory. The hand seed lives in `data/hand.json`.
3. Implementers continue in [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md). Terms live in [GLOSSARY.md](GLOSSARY.md).

## Who gets on the Directory

Both gates must pass: the company is a startup, and at least one open role is remote and employable from Spain.

The **Startup gate** asks whether the company is a startup. A consultancy, a bank, or a subsidiary fails it. A Hand company, a YC batch, or a known headcount under the **Headcount cap** of 200 is how a company passes, and that reason is stored on the company. An unknown headcount fails the gate. A Hand company does not need a number.

The second gate is a **Qualifying role**: an open role that is **Spain-employable**. The **Eligibility class** on that role is one of `spain-named`, `eu-eea`, `worldwide`, and `contractor`. A bare "Remote", a US-only line, a country list that omits Spain, and an on-site Spain office leave the company off the list.

**Stated pay** is only what a posting states, attached to the job, never a company median. The **posting text** is stored on the role, so a search can match a requirement the title does not name.

## What this repo publishes

| Surface | What it is |
|---------|------------|
| Published Directory | `data/directory.json` and `data/jobs.json` in this repo. Hiring contacts are kept private. |
| Crawl | A pass over the boards of companies already kept on the Directory. |
| Agent | Public MCP at `https://spain-remote-agent.nicofetter.com/mcp`: `find_jobs` and `get_startup` only. Apply stays on the person's machine. |

## Hand companies and strike-off

Discovery starts from a **hand list**. Companies kept with `"via": "hand"` stay on the Directory through a stretch with no qualifying role. A **Strike-off** is a hand decision that a company leaves: `"no"` for good, or a date to recheck.

## Where startups are found

**Discovery** looks for companies not yet on the Directory, in order: a hand list, then YC, then Common Crawl boards with a known headcount under a cap, then Wellfound. The cap is 200.

**Crawl** is a later pass over the boards of companies already on the Directory. It is not Discovery.

## Repo layout

| Place | Role |
|-------|------|
| `lib/ats/` | Generic ATS adapters (Greenhouse, Ashby, Lever, Teamtailor, and unused big-company adapters). Keep/drop of Spain-employable roles sits outside them. |
| `lib/spain-employable.js` | Spain-employable judge: keep a role with an eligibility class and evidence, or drop it. |
| `lib/directory.js` | Startup gate, strike-off, exclusion list, and published Directory records. |
| `scripts/crawl.mjs` | Crawl kept Directory boards into `data/jobs.json` (qualifying roles only) and refresh `data/directory.json`. |
| `scripts/private_data.sh` | Encrypt contacts, cursors, and headcount notes into the private repo. The local ciphertext checkout is the sibling directory `spain-remote-jobs-agent-data`. `jobs.json` and `directory.json` stay here. |
| `data/` | Published JSON (`directory.json`, `jobs.json`) and the hand seed (`hand.json`, no contacts). |
| `mcp/` | MCP server |
| `skills/` | Agent skill |
| `web/` | Landing page |
| `tests/` | Tests (`npm test` runs `node --test` on fixtures; no network) |

```bash
npm test
npm run crawl -- --hand --live
npm run crawl -- --hand --fixture-dir tests/fixtures
npm run crawl -- --greenhouse <slug> --ashby <slug> --live
npm run crawl -- --greenhouse <slug> --ashby <slug> --fixture-dir tests/fixtures
```

## Next step

Closed implementation decisions are in [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md). Do not reopen them here.
