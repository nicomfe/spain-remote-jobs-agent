---
status: accepted
---

# One shared droplet, Docker, and a Cloudflare Tunnel

The daily crawl in the sibling project runs about 45 minutes and up to 90. Discovery runs about an hour, with a three-hour cap. A Vercel function on Hobby dies at 5 minutes, and a Vercel build dies at 45. The crawl, the read-only MCP, and the static site therefore run on one DigitalOcean droplet (1 vCPU, 1 GB, Amsterdam, resized to 2 GB when a second project arrives). Docker is used because the droplet will host other projects. GitHub Actions only builds the image and pushes it to GHCR. The droplet pulls. Actions does not crawl.

`https://spain-remote-agent.nicofetter.com` is a Cloudflare Tunnel for that hostname only, not a wildcard and not an A record. `cloudflared` dials out. The droplet firewall accepts no inbound 80, 443, or 22. Caddy routes on the Docker network and publishes no host ports. TLS ends at Cloudflare. SSH for the operator goes through Cloudflare Access. Public JSON is a volume the crawl updates and git-commits, not a layer in the image. The crawl container has a memory cap so it cannot kill Caddy or the MCP. A failed crawl opens a GitHub issue.

## Considered options

- Vercel for the site and the MCP, droplet for the crawl. Two places to operate, and the sibling already showed the crawl does not fit in a function.
- A grey-cloud A record and Let's Encrypt on the droplet. The droplet IP is public.
- An orange-cloud record with a Cloudflare DNS token on the box. That token can rewrite `nicofetter.com`. A tunnel token can only attach this tunnel.
- DigitalOcean Container Registry. GHCR is free.
- Inbound SSH so Actions can rsync. The deploy is a pull instead, so port 22 stays closed.

## Consequences

- `nicofetter.com` is already on Cloudflare and the apex stays proxied. This tunnel must not capture the apex.
- Issues [#11](https://github.com/nicomfe/spain-remote-jobs-agent/issues/11), [#12](https://github.com/nicomfe/spain-remote-jobs-agent/issues/12), [#13](https://github.com/nicomfe/spain-remote-jobs-agent/issues/13), and [#14](https://github.com/nicomfe/spain-remote-jobs-agent/issues/14) implement this shape. They do not add a Vercel project, a Vercel cron, or a public port.
- Dev does not start the droplet or the tunnel.
