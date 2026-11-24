# Orchestrator session

This repo is implemented by an orchestrator that delegates [GitHub issues](https://github.com/nicomfe/spain-remote-jobs-agent/issues) and reports results. The orchestrator writes no product code. When an issue is done, the orchestrator merges that branch into main. Decisions below are closed. Do not reopen them.

## Quick path

1. Read this file, [GLOSSARY.md](../GLOSSARY.md), and the ADRs in [docs/adr](adr/).
2. Delegate [issue #1](https://github.com/nicomfe/spain-remote-jobs-agent/issues/1) only. One worktree, one agent.
3. Report the checklist, the test command and its result, and the files touched.
4. Merge the issue branch into main. The next wave waits for that merge. Do not push unless asked.

## How to delegate

- One agent per issue, each in its own git worktree.
- Parallel issues run only when every `Blocked by` is merged and the agents would not edit the same files.
- An agent that needs to change the shared `Role` or `Startup` shape stops and reports. One later agent makes that change.
- Parallel agents do not edit `package.json`. They report the script they need.
- The orchestrator does not edit product code, docs in `docs/adr/`, this file, or `GLOSSARY.md` to make an issue pass.

## Report

```
## Issue #NN — <title>
Checklist: <passed / failed items>
Tests: <command> — <pass / fail>
Files: <paths>
Contract change needed: none | <what>
Blocker: none | <what>
```

## Waves

| Wave | Issues | When |
|------|--------|------|
| 0 | [#1](https://github.com/nicomfe/spain-remote-jobs-agent/issues/1) skeleton | Now |
| 1 | [#2](https://github.com/nicomfe/spain-remote-jobs-agent/issues/2) ATS crawl | #1 merged |
| 2 | [#3](https://github.com/nicomfe/spain-remote-jobs-agent/issues/3) Spain-employable judge | #2 merged |
| 3 | [#4](https://github.com/nicomfe/spain-remote-jobs-agent/issues/4) hand directory | #3 merged |
| 4 | [#5](https://github.com/nicomfe/spain-remote-jobs-agent/issues/5) YC, [#8](https://github.com/nicomfe/spain-remote-jobs-agent/issues/8) `find_jobs` / `get_startup`, [#12](https://github.com/nicomfe/spain-remote-jobs-agent/issues/12) daily crawl | #4 merged, in parallel |
| 5 | [#6](https://github.com/nicomfe/spain-remote-jobs-agent/issues/6) Common Crawl, [#7](https://github.com/nicomfe/spain-remote-jobs-agent/issues/7) Wellfound | #5 merged, in parallel |
| 5b | [#9](https://github.com/nicomfe/spain-remote-jobs-agent/issues/9) apply | #8 merged |
| 6 | [#10](https://github.com/nicomfe/spain-remote-jobs-agent/issues/10) skill, [#11](https://github.com/nicomfe/spain-remote-jobs-agent/issues/11) landing, [#14](https://github.com/nicomfe/spain-remote-jobs-agent/issues/14) registry | #9 merged, in parallel |
| 7 | [#13](https://github.com/nicomfe/spain-remote-jobs-agent/issues/13) twice-monthly discovery | #6 and #7 merged |

[Issue #13](https://github.com/nicomfe/spain-remote-jobs-agent/issues/13) also fetches Wellfound. It waits for [#7](https://github.com/nicomfe/spain-remote-jobs-agent/issues/7) even though the issue text only names YC and Common Crawl.

## Decisions

| Topic | Decision |
|-------|----------|
| Language | Node ESM. Copy `lib/ats` from `../spanish-top-tech-companies` (MIT), including unused big-company adapters. The keep/drop decision stays outside the adapters. |
| Tests | `node --test` on fixtures. No network unless a flag says `--live`. |
| Dev apply | An outbox file. Nothing is sent. |
| Dev hosting | Nothing. No droplet, no tunnel, no `DATA_KEY`. |
| Startup gate | Evidence on the company: `hand`, `yc`, or `headcount` plus a URL. An exclusion list drops a consultancy, a bank, or a subsidiary. No model. |
| Headcount cap | 200. Unknown headcount stays out. A hand company needs no number. No paid people API. |
| Pay | Stated pay on the role only. The landing headline has no pay figures. |
| Apply | Email only after an explicit yes, through the person's SMTP. LinkedIn is a draft the person sends. Cap is 3 messages a day, both channels. |
| Public MCP | `find_jobs` and `get_startup` only. See [ADR 0003](adr/0003-public-mcp-is-read-only.md). |
| Data | `directory.json` and `jobs.json` are plaintext in this repo. The private bundle is AES-256. See [ADR 0001](adr/0001-public-directory-private-bundle.md). |
| Runtime | One shared DigitalOcean droplet, Docker, Cloudflare Tunnel. See [ADR 0002](adr/0002-droplet-docker-tunnel.md). |
| Site build | GitHub Actions builds the image and pushes it to GHCR. The droplet pulls. Actions does not crawl. |
| Landing | Spanish and English, funneling to `https://spain-remote-agent.nicofetter.com/mcp`. |

Terms live in [GLOSSARY.md](../GLOSSARY.md). Hosting details live in the ADRs. [Issue #1](https://github.com/nicomfe/spain-remote-jobs-agent/issues/1)'s README describes the product, and points here for implementation.

## Checklist before delegating an issue

- [ ] Every `Blocked by` is merged.
- [ ] No other in-flight agent owns the same files.
- [ ] The prompt tells the agent which directories it may create and which files it must not edit.
- [ ] The prompt tells the agent to run the tests and to stop on a contract change.