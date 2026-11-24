# Spain remote jobs

The public directory of startups that will employ someone remotely from Spain.

## Language

**Directory**:
The public list of companies that pass the startup gate and have a qualifying role.
_Avoid_: job board, company list

**Startup gate**:
The check that the company is a startup. A consultancy, a bank, or a subsidiary fails it. A hand decision, a YC batch, or a known headcount under the cap is how a company passes, and that reason is stored on the company.
_Avoid_: company filter, startup score

**Headcount cap**:
The maximum known headcount at which a discovered company still passes the startup gate: 200. An unknown headcount fails the gate. A hand company does not need a number.
_Avoid_: company size, employee bucket

**Spain-employable**:
A posting from which a person can be employed remotely from Spain.
_Avoid_: remote, Spain-based

**Eligibility class**:
The Spain-employable result: `spain-named`, `eu-eea`, `worldwide`, or `contractor`. A bare "Remote", a US-only line, a country list that omits Spain, and an on-site Spain office are none of these.
_Avoid_: place class, location class

**Place class**:
The location label on a posting, such as `remote-spain`, `remote-europe`, or `remote-global`. Input to the Spain-employable check.
_Avoid_: eligibility class

**Evidence**:
The words that decided an eligibility class, stored on the role.
_Avoid_: reason code, score

**Qualifying role**:
An open role that is Spain-employable.
_Avoid_: matching job, Spain job

**Stated pay**:
The pay figure a posting itself prints, stored on that role.
_Avoid_: salary, median, compensation band

**Hand company**:
A company a person put on the directory (`via: hand`). It stays through a stretch with no qualifying role.
_Avoid_: seed, manual entry

**Strike-off**:
A hand decision that a company leaves the directory: `no` for good, or a date after which it may be judged again.
_Avoid_: ban, block

**Crawl**:
A pass over the boards of companies already on the directory.
_Avoid_: discovery, scrape

**Discovery**:
A pass that looks for companies not yet on the directory, in order: the hand list, YC, Common Crawl, Wellfound.
_Avoid_: crawl

**Hiring contact**:
A person at the company who can receive an application. Absent from the directory.
_Avoid_: recruiter email, public contact
