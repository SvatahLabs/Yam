# @svatah/yam-service

The local HTTP and event-stream service (REQ-ADE-1, LLD §13.5) — the only
integration point for the Yam app and for any other client.

```bash
yam serve --project . --port 0
# yam serve listening url=http://127.0.0.1:51234 token=…
```

It binds to `127.0.0.1` and every route but `/health` and `/openapi.json` needs a
bearer token, generated per process and printed once on stdout. The app reads it
from the child process it spawned. A token in a file is a token that outlives the
process that needed it, so there is no file.

## No logic lives here

Every handler reads its arguments, calls one function from `@svatah/yam`, and
shapes the answer. LLD §1's import boundary is what enforces it — this package
may import `@svatah/yam` and `@svatah/yam-schema` and nothing else — and
`test/run.test.ts` is what proves it: it runs the same project through the
service and through the CLI and diffs `results.jsonl`. If a handler ever grew
logic of its own, the app would start showing something the CLI does not agree
with, and that test is what would notice.

## The endpoints

`openapi.json` is the contract, committed so the app's typed client is generated
from a file in the repository rather than from a running service. `GET
/openapi.json` serves the same document, and a test fails when the two disagree.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness, for the spawn handshake. No token. |
| `GET /openapi.json` | This contract. No token. |
| `GET /project` | Config, flows, stories, compositions, run blocks, API names |
| `GET`/`PUT /flows/*` | Read and write a flow file |
| `POST /compile` | Compile and lint |
| `POST /run` | Start a run; the id comes back immediately and the steps arrive on the stream |
| `GET /runs`, `/runs/:id`, `/runs/:id/results`, `/runs/:id/audit` | Summaries, results, audit |
| `GET /bindings`, `/bindings/:id` | The store |
| `GET /data` | Run data, **with secrets redacted** |
| `GET /api` | Named API requests |
| `GET /events` (WebSocket), `GET /events/sse` | `run.started`, `step.result`, `run.summary`, `run.failed`, `log` |

`POST /run` answers with the run id and streams the rest, because the app's Run
screen watches a run happen — a blocking call would make it a spinner.

## Not a server

REQ-ADE-7: loopback only, one developer, no users, no scheduler, no dashboard.
It holds no state: the event stream has no buffer, and a client that connects
mid-run sees the rest and reads the run directory for what it missed. The
project directory is the only source of truth (REQ-ADE-2).
