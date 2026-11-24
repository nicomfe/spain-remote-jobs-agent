# Spain remote jobs

The source of truth is the public directory of startups that will employ someone remotely from Spain. This repo publishes that Directory as JSON, crawls the boards of companies already kept, and later hosts a read-only agent surface.

## Quick path

1. Read this file for the product rules.
2. Open `data/directory.json` and `data/jobs.json` for the published Directory. The hand seed lives in `data/hand.json`.
3. Implementers continue in [docs/ORCHESTRATOR.md](docs/ORCHESTRATOR.md). Terms live in [GLOSSARY.md](GLOSSARY.md).

## Who gets on the Directory

Both gates must pass: the company is a startup, and at least one open role is remote and employable from Spain.

The **Startup gate** asks whether the company is a startup. A consultancy, a bank, or a subsidiary fails it. A Hand company, a YC batch, or a known headcount under the **Headcount cap** of 200 is how a company passes, and that reason is stored on the company. An unknown headcount fails the gate. A Hand company does not need a number.

The second gate is a **Qualifying role**: an open role that is **Spain-employable**. The **Eligibility class** on that role is one of `spain-named`, `eu-eea`, `worldwide`, and `contractor`. A bare "Remote", a US-only line, a country list that omits Spain, and an on-site Spain office leave the company off the list.

**Stated pay** is only what a posting states, attached to the job, never a company median.

## What this repo publishes

| Surface | What it is |
|---------|------------|
| Published Directory | `data/directory.json` and `data/jobs.json` in this repo. Hiring contacts are kept private. |
| Crawl | A pass over the boards of companies already kept on the Directory. |
| Agent | Find roles, see why a startup is listed, apply only after a yes, at most 3 messages a day, with hiring contacts kept private. Apply is not hosted on the public MCP. |

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
