# 02: Crawl Greenhouse and Ashby into jobs.json

**What to build:** Running the crawl against one Greenhouse board and one Ashby board writes a `jobs.json` of their open roles. Each role has a place class, and stated pay when the posting gives it.

**Blocked by:** 01: Project skeleton and README

**Status:** ready-for-agent

- [ ] One Greenhouse board and one Ashby board each produce roles in `jobs.json`
- [ ] Each role carries a place class from the location classifier
- [ ] Stated pay on a posting is stored on the role; a role with no stated pay is still written
- [ ] Greenhouse, Ashby, Lever, and Teamtailor adapters are usable; big-company adapters may be present and unused
- [ ] The ATS adapters stay generic, and the decision of which roles to keep sits outside them
