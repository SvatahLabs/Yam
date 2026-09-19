# API reference

Yam has four ways in. Pick the one that matches what you are building.

| You are | Use | Page |
|---|---|---|
| a person at a terminal | the `yam` command | [CLI reference](reference/generated/cli.md) |
| an AI agent | the MCP server | [MCP tools](#mcp-tools) |
| a program on this machine | the local HTTP service | [HTTP API](reference/generated/http-api.md) |
| a TypeScript program | the SDK | [SDK](#sdk) |

All four call the same functions underneath. Nothing is implemented twice, so
they cannot disagree with each other.

## Command line

47 commands. The full reference, with every flag and exit code, is generated
from the code: [CLI reference](reference/generated/cli.md).

You can also read it without leaving the terminal:

```bash
yam help                    # one screen
yam <command> --help        # one command's flags and exit codes
yam help <topic>            # flows, bindings, exit-codes, session, adapters, agents
```

### The ones you use most

| Command | What it does |
|---|---|
| `yam init [dir]` | Start a project. |
| `yam` | Say where you are and what to do next. |
| `yam check` | Read, lint and compile the flows. Writes `.yam/plan.json`. |
| `yam record` | Record a flow from what you do. `--flow` binds one you wrote. |
| `yam run` | Replay the plan. The exit code is the verdict. |
| `yam heal` | Repair the bindings the interface moved. |
| `yam ui` | The terminal cockpit. `--tmux` opens the full workspace. |
| `yam serve` | The local service, for the app and other clients. |
| `yam explore` | Let an agent draft a flow. You get a proposal to review. |

### Driving something directly

The `surface` commands open a session and act on it. Each is one process. The
session lives in a shared broker, so the next command can see it.

```bash
yam surface connect --url https://example.com      # returns a session id
yam surface snapshot --session <id>                # the elements, with references
yam surface act --session <id> --ref r12 --action click
yam surface read --session <id> --kind title
yam surface check --session <id>                   # a postcondition
yam surface close --session <id>
```

`yam surface doctor` reports what each adapter can do on this machine.
`yam surface targets` lists what there is to connect to.

### Exit codes

The exit code is the answer. `yam help exit-codes` prints them all. The ones you
will see most:

| Code | Meaning |
|---|---|
| 0 | Everything passed. |
| 1 | A step failed, or a check found something wrong. |
| 2 | The flows had errors. Nothing ran. |
| 6 | It passed only because a binding was healed. Review the repair. |
| 11 | A flow stopped under its failure policy. A cleanup story may have run. |
| 64 | The command line itself was wrong. |

## MCP tools

Point an agent at `@svatah/yam-mcp` and it gets these tools.

```json
{ "mcpServers": { "yam": { "command": "npx", "args": ["-y", "@svatah/yam-mcp"] } } }
```

### Surface tools

These need no project. They are what an agent uses to drive something.

| Tool | What it does |
|---|---|
| `surface_targets` | What there is to connect to, and which adapters are ready. |
| `surface_connect` | Open a session on a URL, an app name, or an endpoint. |
| `surface_snapshot` | The elements on screen, each with a stable reference. |
| `surface_describe` | Everything known about one element. |
| `surface_act` | Click, type, press, navigate, and the rest. Name passwords in `secrets`. |
| `surface_read` | The title, the URL, an element's text or value. |
| `surface_check` | Test a postcondition. Returns what it observed. |
| `surface_screenshot` | A picture of the current surface, returned as an image. |
| `surface_capabilities` | What this adapter can and cannot do. |
| `surface_events` | What has happened in this session. |
| `surface_control` | Take a target or give it back. |
| `surface_request` | Send an HTTP request through an HTTP session. |
| `surface_sessions` | Every open session, whoever opened it. |
| `surface_close` | Close a session. |

### Project tools

These appear when you start the server with a project directory.

```json
{ "mcpServers": { "yam": { "command": "npx", "args": ["-y", "@svatah/yam-mcp", "/path/to/project"] } } }
```

| Tool | What it does |
|---|---|
| `yam_compile` | Compile the flows into a plan. |
| `yam_lint` | Read the flows and report problems. |
| `yam_run` | Run the plan, and report every step. |
| `yam_record` | Record or bind a flow. |
| `yam_heal` | Propose repairs for a failed run. |
| `yam_bindings` | Read the bindings store. |
| `yam_results` | Read a run's results. |

### How a session goes

```
surface_connect  →  surface_snapshot  →  surface_act  →  surface_read  →  surface_close
```

Every tool takes an optional `intent`, a short sentence saying why. Yam records
it. That is what makes a session compile into a proposal later.

### Sharing a session with a person

You and an agent share one broker, so a session either of you opens is one both
can see. `surface_control` decides who is driving. The agent drives under its
client's name and cannot force a handoff; the app shows who holds a target and
lets you take it back.

Read [Yam and MCP](mcp.md) for the profiles and the transport options.

## HTTP API

`yam serve` starts a local service. It binds to 127.0.0.1 and requires a bearer
token, which it prints on stdout when it starts.

```bash
yam serve --project .
# yam serve listening url=http://127.0.0.1:51234 token=abc123
```

Every endpoint calls the same function the CLI calls. The full list with request
and response shapes is generated from the code:
[HTTP API reference](reference/generated/http-api.md).

### The shape of it

| Area | Endpoints |
|---|---|
| Project | `GET /project`, `GET /plan`, `POST /compile` |
| Flows | `GET /flows/{file}`, `PUT /flows/{file}` |
| Runs | `POST /run`, `GET /runs`, `GET /runs/{id}`, `GET /runs/{id}/results`, `GET /runs/{id}/audit` |
| Bindings | `GET /bindings`, `GET /bindings/{id}`, `POST /bindings/verify` |
| Recording | `POST /record`, `POST /capture`, `POST /record/{id}/decision` |
| Healing | `POST /heal` |
| Sessions | `GET /targets`, `POST /sessions`, `GET /sessions`, `DELETE /sessions/{session}` |
| Data | `GET /data`, `PUT /data` |
| API requests | `GET /api`, `PUT /api/{name}`, `POST /api/request` |
| Agents | `GET /agents/clients`, `GET /tools` |

The service publishes an OpenAPI 3.1 document. The Python and Java clients under
[`clients/`](../clients) are generated from it, so they cannot drift.

### Events

Long operations stream. A run sends a step event as each step finishes.
Recording sends a decision event when it needs you. Subscribe over
server-sent events or a WebSocket.

## SDK

For TypeScript programs on the same machine.

```bash
npm install @svatah/yam-sdk
```

```ts
import { connect } from "@svatah/yam-sdk";

const yam = connect({ url: "http://127.0.0.1:51234", token: "abc123" });

const project = await yam.getProject();
const run = await yam.postRun({ story: "Sign in" });

for await (const event of yam.subscribe()) {
  if (event.kind === "step") console.log(event.status, event.text);
}
```

`YamClient` is generated from the same OpenAPI document the service publishes,
so every endpoint above has a typed method. `connect()` reads the URL and token
from the environment when you do not pass them.

## Schemas

Every artifact Yam writes has a published schema: the plan, the bindings store,
a run's results, the audit log, the configuration file.

- [Schema reference](reference/generated/schemas)
- As Zod and as JSON Schema in [`@svatah/yam-schema`](../packages/schema)

If you write a tool that reads Yam's output, read against the schema rather than
against an example.

## Which one should I use?

- Automating your own testing: **the command line**.
- Building an agent: **MCP**.
- Building a dashboard or an editor: **the HTTP API** or **the SDK**.
- Adding bindings to Playwright tests you already have: none of these. Use
  [`@svatah/yam-playwright-test`](getting-started/playwright-quick-start.md).
