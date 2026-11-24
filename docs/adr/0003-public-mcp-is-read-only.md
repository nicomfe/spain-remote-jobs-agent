---
status: accepted
---

# The public MCP is read-only

The hosted MCP at `https://spain-remote-agent.nicofetter.com/mcp` exposes `find_jobs` and `get_startup`. The same code speaks stdio in dev and in tests. Apply runs on the person's machine: the questions, the guide filled from their CV, the yes, the SMTP password, and the contacts file. The web container does not mount the private bundle. The server sends nothing. LinkedIn is a draft the person sends. The cap of 3 messages a day is counted on that machine.

## Considered options

- Serve hiring contacts from the public function, as `spanish-top-tech-companies` does with `hiring_contact`. [Issue #9](https://github.com/nicomfe/spain-remote-jobs-agent/issues/9) says that file is never committed, published, or written into an issue or a log.
- Run apply on the droplet. SMTP credentials and contacts would sit next to the public process.

## Consequences

- Issue #9's tools are stdio-only. They are not registered on the hosted server.
- Issue #14's `server.json` remote is the read-only URL above.
