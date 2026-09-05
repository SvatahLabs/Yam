# `svatah mcp`

Svatah's operations and its raw agent surface, over the Model Context Protocol,
so an external agent can drive a project and have its exploration captured
(REQ-AGT-2, REQ-BEH-4, LLD §15, §13.4).

```jsonc
// An MCP client's server list
{
  "mcpServers": {
    "svatah": {
      "command": "npx",
      "args": ["svatah", "mcp", "/path/to/the/project"]
    }
  }
}
```

Stdio: no port to collide, no token to leak, and the client owns the process.
The server's own output goes to stderr, because stdout is the protocol.

## The operation tools

They run **the same functions the command line runs**. An agent that compiles a
project through MCP and a person who compiles it on a terminal get the same
`plan.json` — the only way to guarantee that is for there to be one
implementation, which is the same rule the local service follows (LLD §13.5).

| Tool | |
|---|---|
| `svatah_compile` | Compile every flow into a plan, with the diagnostics `svatah compile` reports. `write: true` also writes `.svatah/plan.json` |
| `svatah_lint` | Everything `svatah lint` reports |
| `svatah_run` | Replay the plan, deterministically and with no model. Returns the run id, the totals and every step's status |
| `svatah_bindings` | The store: every element the project has recorded, and the phrases that name it |
| `svatah_results` | The summary and step results of a run under `runs/` |

`workflow` and `tool` are LLD §15's remaining operation tools and arrive with
T5.2 and T5.3; a server that offered them now would be offering something that
does not exist.

## The raw surface tools

These hand an agent the actual `AgentSurface` — `snapshot`, `act`, `read`,
`check` — with one addition: **every call requires an `intent`**.

| Tool | |
|---|---|
| `surface_snapshot` | The page as a semantic tree, with a stable `[ref=…]` per element |
| `surface_act` | One action, addressed by a reference |
| `surface_read` | Text, value, an attribute, the title, the URL |
| `surface_check` | Whether a predicate holds, and what it saw |
| `surface_trajectory` | Where this session's trajectory is, and how many calls it holds |

The session opens on the first surface call, not at start: an agent that only
compiles should not have started a browser.

Elements are addressed by reference and never by selector. The surface does not
expose one (REQ-SURF-5), which is what makes an agent's exploration compilable:
a reference points at an element a snapshot described, and a description is what
candidates and fingerprints are synthesised from.

## The trajectory

Every surface call is written to `runs/<session>/trajectory.jsonl`, one canonical
JSON object per line:

```json
{"at":"2026-09-03T20:31:04.211Z","call":"act","describe":{…},"intent":"go to the sign-in page","ref":"r3","seq":2,"snapshotHash":"9f2c…"}
```

| Field | |
|---|---|
| `seq` | 1-based, in the order the calls were made |
| `intent` | What the agent said it was doing. **Required** |
| `call` | `snapshot`, `act`, `read` or `check` |
| `snapshotHash` | The page's structural hash (LLD §6.2), so a compiler can tell one screen from the next |
| `ref`, `describe` | The element, and everything synthesis needs about it — read **at the time of the call** |
| `result`, `error` | What the call returned, or why it did not |

### Why `intent` is required

A trajectory of surface calls with no intents is a log. What makes it
*compilable* is that each call says what the agent was trying to do — "sign in as
the enterprise user", not "click r14" — because the sentence a step compiles from
is the intent and nothing else could be (LLD §13.4: "the intent becomes the
sentence after normalisation through the synonym vocabulary").

So an agent that cannot say what it is doing is an agent whose exploration cannot
become a deterministic tool, and the protocol says so rather than discovering it
later.

### Why the description is captured at the time of the call

A reference is stable within a snapshot and lost on navigation. An element
described an hour later is a different element or none at all, and candidates and
fingerprints are synthesised from the description with no model (LLD §13.4). So
`describe` is read when the call is made, which is the only moment it means
anything.

### A call that failed is recorded too

A trajectory is an account of what happened. An agent that drove the application
into a state nobody expected has produced the most interesting trajectory there
is, and a capture that recorded only the successes would be one nobody could
debug from.

## What happens to it next

`svatah trajectory compile` — T5.5 — turns the file into a story draft, a plan
fragment and `verified: false` bindings under `proposals/<date>/`, for review.
Phase 4 builds the capture; the shape above is what the compiler reads.

That is ADR-16 in practice: Svatah does not own an exploration agent. It owns the
surface an agent explores through, and the file that comes out.

## Options

| | |
|---|---|
| `svatah mcp [dir]` | the project; the current directory by default |
| `--trajectory <path.jsonl>` | where the trajectory goes; `runs/<session>/trajectory.jsonl` by default |
| `--session <id>` | fix the session id, so the trajectory's path is predictable |

The session opens where `config.app.baseUrl` says, subject to LLD §15's
precedence — the flag, then `SVATAH_BASE_URL`, then the config.
