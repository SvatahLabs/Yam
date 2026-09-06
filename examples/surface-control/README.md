# Surface control quick start

Drive a browser from the command line — no project, no flow, no model.

## Install

```bash
npm install @svatah/yam
```

## Connect, inspect, act, verify, close

```bash
# Discover what this machine can drive
yam surface targets --json

# Connect to a URL
yam surface connect --url http://localhost:3000 --json
# Returns: { "result": { "sessionId": "s_...", "adapter": "playwright", ... } }

# Take a semantic snapshot
yam surface snapshot --session s_... --json

# Read the page title
yam surface read --session s_... --kind title --json

# Check a condition
echo '{"predicate":{"kind":"titleContains","value":"Home"},"subject":"page"}' > check.json
yam surface check --session s_... --input check.json --json

# Close the session
yam surface close --session s_... --json
```

## MCP (for agents)

```jsonc
{
  "mcpServers": {
    "yam": {
      "command": "npx",
      "args": ["@svatah/yam", "mcp"]
    }
  }
}
```

Call `surface_targets` to discover, `surface_connect` to open, `surface_snapshot`
to inspect, `surface_act` to do something, and `surface_close` when done.
