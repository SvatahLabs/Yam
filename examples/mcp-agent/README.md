# An agent calling a story as a tool (REQ-BEH-3, REQ-AUTO-6, 8)

The tool behavior. `yam tool serve` is an MCP server whose tools *are* the
project's stories: each tool's schema is derived from the story's signature, and
each call is a deterministic run with an audit record.

```bash
yam tool serve --expose "Book a slot"
```

`call-a-tool.mjs` beside this file is a complete MCP client — the SDK, a stdio
transport, `listTools`, `callTool` — in sixty lines. Point any MCP client at the
same command and it sees the same tools.

```bash
node examples/mcp-agent/call-a-tool.mjs evals/fixtures
```

## What the agent gets, and what it does not

It gets a **function**: arguments validated against the signature before
anything runs, typed outputs, and a `runId` naming the directory with the
step-by-step record. It does not get the steps, the bindings or the plan — how
the function gets it done is the determinism layer's business, and changing it
must not change the tool (REQ-BEH-5, seen from outside).

**No model is involved in execution.** `tool ─► workflow ─► runtime`, and none
of those may import the gateway (LLD §1); the import boundary is linted and a
dependency-graph test backs it. Whatever a model decided, it decided at authoring
time and it is in the files. `packages/cli/test/tool-server.test.ts` runs the
whole thing with every external connection refused, which is that claim as a
fact about bytes rather than about imports.

## The audit line is the point

A person running a workflow can say afterwards what they did. An agent cannot be
asked. So `runs/<id>/audit.jsonl` records the invoker — `{ kind: "agent", id:
<the MCP client's own name>, via: "mcp" }` — the inputs with secrets redacted,
every surface call with its reference and outcome, and the outputs (REQ-AUTO-6).
That record is the only account of why the system changed.

## What is not exposed, and why

`tool.requireIdempotent` (default **on** in `production`) keeps a story that is
not marked `idempotent` out of the tool list entirely (REQ-AUTO-8). Not refused
on invocation — *not listed*: an agent that can see a tool will eventually call
it, and an agent retries. A story that books a slot, exposed to an agent that
retries on timeout, books two slots.

The server says which stories it refused and why, at start, on stderr. An
operator who asked for two tools and got one has to be told which, now, rather
than when the agent reports a tool it was told about does not exist.
