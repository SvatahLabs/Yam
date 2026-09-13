# `@svatah/yam-mcp`

Yam's operations and its live surface, over the Model Context Protocol,
so an external agent can drive an application and optionally have its exploration
captured (REQ-AGT-2, REQ-BEH-4, LLD §15, §13.4).

```jsonc
// An MCP client's server list — surface tools only, no project needed
{
  "mcpServers": {
    "yam": {
      "command": "npx",
      "args": ["-y", "@svatah/yam-mcp"]
    }
  }
}
```

```jsonc
// With a project, for operation tools and trajectory capture
{
  "mcpServers": {
    "yam": {
      "command": "npx",
      "args": ["-y", "@svatah/yam-mcp", "/path/to/the/project"]
    }
  }
}
```

Stdio: no port to collide, no token to leak, and the client owns the process.
The server's own output goes to stderr, because stdout is the protocol.

## The surface tools

These drive a live target through session IDs. Call `surface_connect` first;
subsequent calls reference the session it returns. **No project needed.** Intent
is optional; when provided on snapshot/act/read/check, the call is recorded to
the trajectory so the exploration can be compiled into a flow.

| Tool | |
|---|---|
| `surface_targets` | Discover available targets and adapter readiness on this machine |
| `surface_connect` | Open a surface session against a target. Returns a session ID |
| `surface_snapshot` | The page as a semantic tree, with a stable `[ref=…]` per element |
| `surface_act` | One action, addressed by a reference |
| `surface_read` | Text, value, an attribute, the title, the URL |
| `surface_check` | Whether a predicate holds, and what it saw |
| `surface_close` | Close a session and release its resources |
| `surface_sessions` | List all active sessions |
| `surface_capabilities` | What the session's adapter can do |
| `surface_describe` | Describe a specific element by reference |
| `surface_events` | What this session did: its events, and the steps a proposal compiles from |
| `surface_control` | Take a target, give it up, or ask who holds it |
| `surface_request` | Send an HTTP request on an HTTP surface and return the response |
| `surface_screenshot` | Take a screenshot of the current surface |
| `surface_trajectory` | Where this session's trajectory is, and how many calls it holds (project only) |

Elements are addressed by reference and never by selector. The surface does not
expose one (REQ-SURF-5), which is what makes an agent's exploration compilable:
a reference points at an element a snapshot described, and a description is what
candidates and fingerprints are synthesised from.

## The operation tools

They run **the same functions the command line runs** and **require a project**.
An agent that compiles a project through MCP and a person who compiles it on a
terminal get the same `plan.json`.

| Tool | |
|---|---|
| `yam_compile` | Compile every flow into a plan, with the diagnostics `yam compile` reports. `write: true` also writes `.yam/plan.json` |
| `yam_lint` | Everything `yam lint` reports |
| `yam_run` | Replay the plan, deterministically and with no model. Returns the run id, the totals and every step's status |
| `yam_record` | Bind the targets of a flow that already exists, driving it through a model gateway. Each step is performed and verified before its binding is kept. Writes to the store |
| `yam_heal` | Relocalize the bindings a run could not resolve and report what can be repaired. Proposes; `apply: true` writes |
| `yam_bindings` | The store: every element the project has recorded, and the phrases that name it |
| `yam_results` | The summary and step results of a run under `runs/` |

`yam_record` is the **binding** half of recording — `yam record --flow <file>`.
The other half, a person driving the browser while Yam writes the flow, is what
`yam record` alone means since Draft 2.23, and it is not offered here because
there is nobody at an MCP session to drive. For the same reason `gateway` takes
`anthropic` or `fake` and not `human`: the human gateway waits for a click.

`yam_heal` proposes and does not write. `apply: true` writes, and a repair is
applied only after the story it came from replayed green.

`workflow` and `tool` are not here: a story called as a function has its own
server, [`yam tool serve`](behaviors.md), whose tools *are* the stories, with the
agent recorded as the invoker.

## The trajectory

When a project root is provided and `intent` is passed on a surface call, the
call is written to `runs/<session>/trajectory.jsonl`, one canonical JSON object
per line:

```json
{"at":"2026-09-03T20:31:04.211Z","call":"act","intent":"go to the sign-in page","ref":"r3","seq":2}
```

| Field | |
|---|---|
| `seq` | 1-based, in the order the calls were made |
| `intent` | What the agent said it was doing |
| `call` | `snapshot`, `act`, `read` or `check` |
| `ref` | The element the call acted on, when it acted on one |
| `result`, `error` | What the call returned, or why it did not |

### Why intent matters

A trajectory of surface calls with no intents is a log. What makes it
*compilable* is that each call says what the agent was trying to do — "sign in as
the enterprise user", not "click r14" — because the sentence a step compiles from
is the intent (LLD §13.4).

Intent is optional for direct control: an agent that just wants to drive a
surface doesn't need to say why. But an agent whose exploration should become a
deterministic flow needs to provide intents, so the trajectory compiler can turn
each call into a sentence.

### A call that failed is recorded too

A trajectory is an account of what happened. An agent that drove the application
into a state nobody expected has produced the most interesting trajectory there
is, and a capture that recorded only the successes would be one nobody could
debug from.

## What happens to it next

`yam trajectory compile` — T5.5 — turns the file into a story draft, a plan
fragment and `verified: false` bindings under `proposals/<date>/`, for review.
Phase 4 builds the capture; the shape above is what the compiler reads.

That is ADR-16 in practice: Yam does not own an exploration agent. It owns the
surface an agent explores through, and the file that comes out.

## Options

| | |
|---|---|
| `npx -y @svatah/yam-mcp [dir]` | the project; omit for surface-only mode |
| `--trajectory <path.jsonl>` | where the trajectory goes; `runs/<session>/trajectory.jsonl` by default |
| `--session <id>` | fix the session id, so the trajectory's path is predictable |

When a project is provided, the session opens where `config.app.baseUrl` says,
subject to LLD §15's precedence — the flag, then `YAM_BASE_URL`, then the
config.
