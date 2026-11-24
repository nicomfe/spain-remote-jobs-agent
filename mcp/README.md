# MCP server

Public tools: `find_jobs` and `get_startup` only. The same code speaks stdio in
development and in tests. Apply tools are not registered.

```bash
node mcp/stdio.mjs
node mcp/stdio.mjs path/to/directory.json path/to/jobs.json
```

Reads `data/directory.json` and `data/jobs.json` from disk as plaintext. No network.

Hosted URL later: `https://spain-remote-agent.nicofetter.com/mcp`
