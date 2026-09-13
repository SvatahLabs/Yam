# @svatah/yam-mcp

The Yam MCP server: the surface tools an agent drives a browser, an application,
an API or a terminal with, and — where a project is open — the operation tools
that compile, lint, run, record and heal.

```json
{ "mcpServers": { "yam": { "command": "npx", "args": ["-y", "@svatah/yam-mcp"] } } }
```

`--http` serves the same tools over Streamable HTTP on loopback behind a bearer
token, for a client that cannot start a program.

It was `yam mcp`, a subcommand. The MCP SDK is six megabytes against six for
everything Yam wrote, so every CLI install paid a hundred per cent overhead for a
feature most never touch. The tools, the flags and the trajectory are unchanged.

An agent and a person share one broker, so a session either opens is one both can
see, and whoever holds a target is named.
