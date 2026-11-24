# 04: Hand-seeded startup directory

**What to build:** A reader can open the public directory and see a few dozen hand-seeded startups, why each one is on the list, and the qualifying roles from their boards.

**Blocked by:** 03: Spain-employable judge

**Status:** ready-for-agent

- [ ] The directory lists a few dozen hand-seeded startups
- [ ] Each record has name, domain, ATS board, HQ country, how it passed the startup gate, eligibility class plus evidence, last crawl, and open-role count
- [ ] Crawling those boards rewrites `jobs.json` to the qualifying roles only
- [ ] A strike-off of `"no"` removes a company for good, and a date means recheck later; the next run leaves a struck-off company off
- [ ] A company marked `"via": "hand"` stays on the list through a stretch with no qualifying role
- [ ] A consultancy, a bank, or a subsidiary is not on the list
