# Examples

Four runnable projects, each answering one question about how Yam is used.

| Example | The question |
|---|---|
| [`plain-playwright/`](plain-playwright/) | How does an existing Playwright project adopt the bindings and the model-free healer, with no flow language at all? (module (a), REQ-PKG-2) |
| [`ci/`](ci/) | How does a CI job replay a flow, and what does it do with the artifacts? (REQ-BEH-1) |
| [`cron/`](cron/) | How does a scheduled job run a story as a *function* and use its outputs? (REQ-BEH-2) |
| [`mcp-agent/`](mcp-agent/) | How does an agent call a story as a tool over MCP? (REQ-BEH-3) |

## Orchestration is external, and these are what that means

Yam has no scheduler, no queue, no dashboard and no human-in-the-loop UI
(REQ-AGT-4, HLD ADR-13). It is invoked — by a CI system, by cron, by an agent
over MCP — and it writes files. That is a deliberate boundary, not a gap:

- Every one of these is a few lines of somebody else's runner calling `yam`.
  There is no Yam-specific concept in any of them beyond the command.
- A run's whole account is `runs/<id>/` — results, summary, audit, checkpoints,
  screenshots. Nothing has to call back to a service to find out what happened,
  which is why a CI job can attach the directory as an artifact and a person can
  read it a month later.
- The exit code is the contract (LLD §15): `0` passed, `1` failed, `6` healed,
  `10` refused by the environment policy, `11` aborted under a compensation,
  `12` a resume whose plan or bindings moved. A runner branches on those and
  needs to know nothing else.

The thing Yam owns is what happens *between* being invoked and writing the
files: the plan, the bindings, the resolver, the guarantees. A scheduler would
be a second product with its own failure modes, and every organisation that
would use one already has one.

## One plan, three behaviors

The three examples below run **the same `plan.json` and the same bindings**
(REQ-BEH-5). Nothing is recompiled and nothing is re-recorded when the behavior
changes; what changes is who is asking and what they get back.

```
yam run                       → a pass/fail oracle, and runs/<id>/
yam workflow run "Book a slot"  → typed outputs on stdout, as JSON
yam tool serve --expose "…"     → an MCP tool an agent calls
```

That is the claim `packages/cli/test/workflow.test.ts` and
`packages/cli/test/tool-server.test.ts` check, and these examples are the same
claim written the way somebody would actually use it.
