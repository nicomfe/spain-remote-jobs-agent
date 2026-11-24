# 08: find_jobs and get_startup

**What to build:** An agent can ask for open roles at the kept startups and can ask why a given startup is on the list.

**Blocked by:** 04: Hand-seeded startup directory

**Status:** ready-for-agent

- [ ] `find_jobs` filters by role, text, eligibility class, and stated pay when the posting has it
- [ ] An empty `find_jobs` result names the filter that removed every match
- [ ] `get_startup` returns why the company is on the list, with the evidence
- [ ] The server has its own name and version, and `server.json` carries that same version
