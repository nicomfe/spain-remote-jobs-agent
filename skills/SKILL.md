---
name: spain-remote-jobs
description: Look up Spain-employable open roles at startups on the public directory, explain why a startup is listed, and apply from the person's machine. Use when the person wants qualifying roles, why a company passed the startup gate, or to fill and send an application.
---

# Spain remote jobs

The public directory lists startups that will employ someone remotely from Spain. Load this skill before calling the tools.

Public MCP (`https://spain-remote-agent.nicofetter.com/mcp`) is read-only: `find_jobs` and `get_startup` only. Apply tools are stdio-only on the person's machine (`mcp/apply.js`). They are never on the hosted server.

## When to call each tool

### `find_jobs` (public MCP)

Call when looking up qualifying roles: open Spain-employable postings already on disk. Optional filters: `role` (title), `text` (title, company, location, or posting text), `eligibility_class` (`spain-named`, `eu-eea`, `worldwide`, `contractor`), `min_stated_pay` (stated pay on the posting; roles with no stated pay drop out of a pay filter).

Do not call it to explain why a company is listed, and do not treat it as apply.

### `get_startup` (public MCP)

Call when explaining why a startup is on the directory. Pass `name` or `domain`. The reply is the stored startup gate (hand company, YC batch, or known headcount under the cap) plus evidence. Hiring contacts are absent from the directory; do not look them up here.

### `job_questions` (stdio apply)

Call after `find_jobs` has returned a posting, when the person wants the application questions. Pass that job `id`. No network. If no form is on file, use the posting URL.

### `application_guide` (stdio apply)

Call when filling the application. Pass the same job `id`. Fill from the CV. Invent nothing. Anything the CV does not answer is listed under `ask`; ask the person, never invent experience, skills, titles, dates, pay, or a "why".

### `hiring_contact` (stdio apply)

Call when the person needs who to write to for a found job. Pass the job `id`. Contacts come from the private contacts file on this machine. Never guess an address. Never commit, publish, or write a hiring contact into an issue or a log.

### `send_message` (stdio apply)

Call only to send or draft after the person has said yes to that exact message. Required: `id`, `channel` (`email` or `linkedin`), `confirm` (must be `yes`), `text`. Email goes to the local outbox (SMTP only if a mailer is injected). LinkedIn is a draft the person sends; do not drive LinkedIn. The SMTP password is never recorded.

Do not call `send_message` before that yes. If `confirm` is not `yes`, do not send.

## Apply rules

- Invent nothing.
- Fill from the CV.
- Send only after a yes.
- Stop at 3 messages a day (email and LinkedIn together). A fourth waits for another day.

The person sees each message whole and says yes to that message. Nothing is sent before that yes.
