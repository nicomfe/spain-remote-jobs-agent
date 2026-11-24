# 03: Spain-employable judge

**What to build:** A crawled role is kept only when the posting shows the person can be employed remotely from Spain, and the evidence string is stored on the role.

**Blocked by:** 02: Crawl Greenhouse and Ashby into jobs.json

**Status:** ready-for-agent

- [ ] A role that names Spain as a remote place is kept as `spain-named`
- [ ] A role whose place class is `remote-europe` is kept as `eu-eea` when the text does not leave Spain out
- [ ] A role whose place class is `remote-global` is kept as `worldwide` only when the text still includes Spain
- [ ] A line about employment via Deel, Remote.com, or as autónomo is kept as `contractor`
- [ ] A posting that only says "Remote", a US-only line, a country list that omits Spain, and an on-site Spain office are dropped
- [ ] Tests use real posting strings, including ones classified as `remote-europe` and `remote-global`
- [ ] The evidence string that decided the class is stored with the role
