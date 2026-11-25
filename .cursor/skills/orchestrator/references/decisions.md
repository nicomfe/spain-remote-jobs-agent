# Closed decisions

Do not reopen these. Replace this file when copying the orchestrator skill to another project.

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
| Public MCP | `find_jobs` and `get_startup` only. See [ADR 0003](../../../docs/adr/0003-public-mcp-is-read-only.md). |
| Data | `directory.json` and `jobs.json` are plaintext in this repo. The private bundle is AES-256. See [ADR 0001](../../../docs/adr/0001-public-directory-private-bundle.md). |
| Runtime | One shared DigitalOcean droplet, Docker, Cloudflare Tunnel. See [ADR 0002](../../../docs/adr/0002-droplet-docker-tunnel.md). |
| Site build | GitHub Actions builds the image and pushes it to GHCR. The droplet pulls. Actions does not crawl. |
| Landing | Spanish and English, funneling to `https://spain-remote-agent.nicofetter.com/mcp`. |
| Discovery order | Twice-monthly discovery also fetches Wellfound. It waits until the Wellfound crawl has merged, even when the task text only names YC and Common Crawl. |

Terms live in [GLOSSARY.md](../../../GLOSSARY.md). Hosting details live in the ADRs. The README describes the product and points here for implementation.
