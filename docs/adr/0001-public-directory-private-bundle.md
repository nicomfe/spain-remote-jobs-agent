---
status: accepted
---

# Public directory in git, private bundle encrypted

The product is a public directory, and the hiring contacts are people. `directory.json` and `jobs.json` stay plaintext in this repo. Contacts, crawl cursors, and headcount notes live in one AES-256 bundle (openssl `aes-256-cbc`, PBKDF2, 600000 iterations, SHA-256), the same shape as `private_data.sh` in `spanish-top-tech-companies`. The original sits on the droplet, mounted only into the crawl container. The ciphertext mirror is the private repo [nicomfe/spain-remote-jobs-agents-data](https://github.com/nicomfe/spain-remote-jobs-agents-data). `DATA_KEY` is on the droplet and in the operator's keychain. It is not in GitHub Actions, not in the web container, and not in Cloudflare.

## Considered options

- Encrypt the directory too. The public MCP would need the key to serve the list.
- Keep the private files only on the droplet. A lost disk loses the contacts.
- A private GitHub repo in plaintext. Anyone who ever gets read access sees the contacts. The sibling repo encrypts for that reason.

## Consequences

- A failed crawl must not print contacts, cursors, or the key into an issue or a log.
- Dev tests never need the key or the private repo.
