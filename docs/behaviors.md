# Behaviors: one plan, three ways to run it

Status: T5.6 · Companion documents: [spec/requirements.md](spec/requirements.md) ·
[spec/hld.md](spec/hld.md) · [spec/lld.md](spec/lld.md)

A Yam project compiles to one `plan.json` and one bindings store. What
changes between a test, a workflow and a tool is **who is asking and what they
get back** — not the plan, not the bindings, and not what a step means
(REQ-BEH-5).

```
                          plan.json + bindings/
                                   │
     ┌─────────────────────────────┼─────────────────────────────┐
     ▼                             ▼                             ▼
  yam run                yam workflow run           yam tool serve
  a pass/fail oracle        a function: typed             an MCP tool an agent
  and runs/<id>/            inputs → typed outputs        calls; audited
  REQ-BEH-1                 REQ-BEH-2                     REQ-BEH-3
```

Switching behavior never requires recompiling or re-recording. That is the
claim, and it is checkable: `packages/cli/test/workflow.test.ts` and
`packages/cli/test/tool-server.test.ts` run the *same* story three ways against
the same store.

## Test (REQ-BEH-1)

```bash
yam run --host playwright        # inside Playwright Test: fixtures, sharding, traces
yam run --host none              # the standalone executor, for non-web adapters
```

An oracle. Expectations pass or fail, and the exit code is the answer: `0`, `1`
failed, `6` healed, `11` aborted under a compensation policy. The whole account
is `runs/<id>/` — results, summary, audit, checkpoints, screenshots, traces.

See [`examples/ci/`](../examples/ci/).

## Workflow (REQ-BEH-2)

```bash
yam workflow run "Book a slot" --input location=Indiranagar
# {"booking":"Slot booked.","place":"Indiranagar"}
```

A story with a signature, run as a function. Inputs are validated by type before
anything runs (REQ-AUTO-5); outputs come back on **stdout as JSON** so the
command composes with `jq`. Three things are the behavior's own:

- **The environment policy** (REQ-AUTO-7). A story that is not marked
  `idempotent` is refused against a `production` config with exit 10 unless the
  caller passes `--allow-side-effects`. A test against production is a smoke
  test; a non-idempotent workflow against production is an accident.
- **Checkpoints and audit are forced on** (LLD §13.2). A test that is not
  checkpointed can be re-run from the start; a workflow that booked three of
  four slots cannot. `--resume <runId> --from <stepId>` picks it up.
- **Outputs are returned as a value**, un-namespaced: the caller asked for
  `Book a slot`, so it gets `{ booking }` rather than
  `{ "Book a slot.booking": … }`.

See [`examples/cron/`](../examples/cron/).

## Tool (REQ-BEH-3)

```bash
yam tool serve --expose "Book a slot,Cancel booking"
```

An MCP server whose tools *are* the stories. Each tool's `inputSchema` is derived
from the signature rather than written beside it, so the declaration an agent
reads and the arguments the runtime validates are the same lines of the flow
file. Each call is a `runWorkflow` with `invoker: { kind: "agent", id: <the MCP
client's name>, via: "mcp" }`, and returns the outputs plus a `runId`.

- **No model, structurally.** `tool ─► workflow ─► runtime`, and none of those
  may import the gateway (LLD §1). The boundary is linted and backed by a
  dependency-graph test, and the tool-server suite runs with every external
  connection refused.
- **`requireIdempotent`** (default on in `production`) keeps a story that is not
  marked `idempotent` *out of the tool list* — not refused on invocation. An
  agent that can see a tool will eventually call it, and an agent retries
  (REQ-AUTO-8).
- **The audit line is the point.** A person can be asked afterwards what they
  did; an agent cannot. `runs/<id>/audit.jsonl` is the only account.

See [`examples/mcp-agent/`](../examples/mcp-agent/).

## Trajectory compile (REQ-BEH-4)

Not a fourth behavior — the other direction. An agent explores through the raw
surface (`npx -y @svatah/yam-mcp`, or the app's surface explorer), every call carrying what
it was trying to do, and `yam trajectory compile` turns the result into a
**proposal**: a `.flow` draft, a plan fragment and `verified: false` bindings
under `proposals/<date>/`, for a person to read.

Nothing is written outside `proposals/`. The exploration is unreviewed by
anyone, and a proposal is where it waits.

## Orchestration is external (REQ-AGT-4, HLD ADR-13)

Yam has no scheduler, no queue, no dashboard and no human-in-the-loop UI. It
is invoked and it writes files. The examples are CI, cron and an MCP client
because those are what people already have, and because the boundary is the
point rather than an omission:

- The **exit code** is the contract (LLD §15). A runner branches on it and needs
  to know nothing else.
- The **run directory** is the record. Nothing has to call back to a service to
  find out what happened.
- The **project directory** is the only source of truth (REQ-ADE-2). The app,
  the CLI, CI and an agent over MCP all see the same files.

A scheduler would be a second product with its own failure modes, and every
organisation that would want one already runs one.
