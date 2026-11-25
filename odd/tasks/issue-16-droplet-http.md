# Issue 16 — HTTP MCP on the shared droplet

Objective: `https://spain-remote-agent.nicofetter.com/mcp` serves the read-only MCP, and the droplet pulls new GHCR images. Actions only builds the image.
Branch: `issue-16-droplet-http` (cut from `main` before the first source edit).
Delivery: `ask-on-risk`. Test runner: `npm test` (`node --test`).
Risk: T1 none if compose, image workflow, and stdio tool list stay compatible. T2 high (item 5, droplet firewall and tunnel) — blocked on operator secrets.

## Specs

S1. Outcome from issue #16, verbatim: Bring up the empty droplet at `178.62.85.13` so `https://spain-remote-agent.nicofetter.com` serves the read-only MCP, and so a newly pushed GHCR image is pulled by the droplet. GitHub Actions keeps building the image only. It does not SSH, rsync, or crawl.

S2. Already true, verbatim: The operator already created the Cloudflare DNS record that holds the MCP registry public key for `nicofetter.com`. Leave that record and the apex alone. Do not add an A or AAAA for `spain-remote-agent`. Issue #14 owns registry publish. Do not recreate its TXT record.

S3. Contract, verbatim: `cloudflared` and Caddy stay outside this repo's compose file, so a later project on the same droplet does not get trapped inside this stack. The droplet firewall accepts no inbound 80, 443, or 22. Outbound 443 stays open.

S4. Work item 2, verbatim: Ask the operator, out of band, for a read-only GHCR credential (the package is still private), a tunnel token scoped to `spain-remote-agent.nicofetter.com`, Cloudflare Access for SSH, and `DATA_KEY`. Do not paste any of those into this issue, the repo, or Actions. Do not mint a replacement `DATA_KEY`. Stop on each one that is missing.

S5. Work item 4, verbatim: Add the smallest HTTP transport for the same read-only tools, on `/mcp`, reading the public JSON volume. No apply tools. No private-bundle mount. No host port. Point Caddy at it for that hostname only. Serve the static landing from `web/` on the same hostname if it is already what the ADR's static site is.

S6. Work item 5, verbatim: On the droplet, pull and recreate when GHCR has a new image (a timer or an equivalent pull). Do not add an Actions job that opens SSH.

S7. Proof, verbatim: `https://spain-remote-agent.nicofetter.com/mcp` answers and lists only `find_jobs` and `get_startup`. From the public internet, inbound 22, 80, and 443 on `178.62.85.13` are refused. `docker compose` still publishes no host ports. A newer image tag is running after a droplet-side pull, with no Actions SSH step. `npm test` still passes, including the check that compose does not mention `cloudflared` or Vercel.

S8. Assumption: one process serves `POST /mcp` (stateless streamable HTTP, reusing `respond` / `listedTools` in `mcp/index.js`) and the static files in `web/`. Crawl stays the existing image `CMD`. The mcp service overrides the command. `private_bundle` and any crawl env file stay on the crawl service only. Compose text must not contain `DATA_KEY`, `cloudflared`, or `vercel`. No new GitHub Actions variables.

## Tasks

- T1 | S5 S6 S7 | done | HTTP `/mcp` + static `web/` in the image, compose services with no host ports, host pull script, tests. Parent re-ran `node --test tests/http-mcp.test.js tests/daily-crawl.test.js tests/mcp.test.js`: 26 pass, 0 fail. Risk: none (`mcp/index.js` untouched). Full `npm test` still has one pre-existing failure: `empty layout places exist` expects `data/jobs.json` to be `[]`, and that file is unchanged from `main` with 114 roles.
- T2 | S1 S3 S4 S7 | blocked | Droplet Docker, tunnel, Caddy outside this compose, firewall, GHCR login, crawl env file. Stop until the operator supplies each secret in S4.

## Log

L1. 2026-11-25 user: "Vamos a implementar el ticket #16 usemos este agente como el main agent que delega implementaciones a otros agentes asi mantenemos el contexto limpio y minimo aca. Cualquier variable que tenga que agregar a github actions o record en dns indicame y lo hago. Lo mismo por si necesitas acceso a digital ocean para configurar el droplet."

L2. 2026-11-25: Issue #16 read from GitHub. Repo has stdio MCP only (`mcp/index.js` tools `find_jobs`, `get_startup`). `docker/compose.yml` is crawl-only, no ports. `.github/workflows/image.yml` builds and pushes, no deploy. No HTTP listener. `server.json` already points at `https://spain-remote-agent.nicofetter.com/mcp` type `streamable-http`. ADR 0002 forbids an A record and inbound 22/80/443.

L3. 2026-11-25: T1 verified. `mcp/http.mjs` serves POST /mcp via `respond` and GET / from `web/en.html`. Compose adds `mcp` on external network `edge`, no host ports, `private_bundle` only on crawl, crawl `env_file` `/etc/spain-remote-agent/crawl.env`. `docker/host-pull.sh` is `docker compose pull` then `up -d` from the `docker/` directory. Focused tests: 26 pass. `data/jobs.json` and `tests/layout.test.js` were not part of this diff.
