# Expose a story as an MCP tool

The tool behaviour: `yam tool serve` is an MCP server whose tools are the
project's stories. Each tool's input schema is derived from the story's
signature, and each call is a deterministic run with an audit record. A
complete sixty-line MCP client is in
[`examples/mcp-agent/`](../../examples/mcp-agent/README.md).

```bash
yam tool serve --expose "Book a slot,Cancel booking"
node examples/mcp-agent/call-a-tool.mjs evals/fixtures
```

## What the agent gets

A function: arguments validated against the signature before anything runs,
typed outputs, and a `runId` naming the directory with the step-by-step record.
It does not get the steps, the bindings or the plan. How the function gets its
work done is the determinism layer's business, and changing it must not change
the tool.

## What is not exposed, and why

`tool.requireIdempotent`, on by default in `production`, keeps a story that is
not marked `idempotent` out of the tool list entirely. Not refused on
invocation: not listed. An agent that can see a tool will eventually call it,
and an agent retries. The server prints which stories it refused and why on
stderr at start.

## No model, structurally

`tool` calls `workflow` calls `runtime`, and none of those may import the model
gateway. The boundary is linted and backed by a dependency-graph test, and the
tool server's tests run with every external connection refused. Whatever a
model decided, it decided at authoring time and it is in the files.

## The audit line

A person can be asked afterwards what they did; an agent cannot. So
`runs/<id>/audit.jsonl` records the invoker as `{ kind: "agent", id: <the MCP
client's name>, via: "mcp" }`, the inputs with secrets redacted, every surface
call with its reference and outcome, and the outputs. That record is the only
account of why the system changed.

## The raw surface

`yam mcp` exposes the operations and the raw surface, `snapshot`, `act`,
`read` and `check`, to an agent that wants to explore rather than call a
finished tool. Every call is recorded as a trajectory, and `yam trajectory
compile` turns an exploration into a proposal under `proposals/` for a person
to read. See [MCP](../mcp.md).
