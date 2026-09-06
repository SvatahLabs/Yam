# One plan, three ways to run it

A Yam project compiles to one `plan.json` and one bindings store. What changes
between a test, a workflow and a tool is who is asking and what they get back,
not the plan, the bindings, or what a step means.

```
                      plan.json + bindings/
                               │
     ┌─────────────────────────┼─────────────────────────┐
     ▼                         ▼                         ▼
  yam run              yam workflow run          yam tool serve
  a pass/fail oracle    a typed function           an MCP tool an agent calls
  and runs/<id>/        inputs → outputs as JSON   audited per invocation
```

## As a test

```bash
yam run --host playwright
```

Expectations pass or fail and the exit code says which. Use it from any CI
runner; see [Run in CI](../guides/run-in-ci.md).

## As a workflow

```bash
yam workflow run "Sign in" --input username=me@example.com | jq .
```

A story with a signature run as a function. Inputs are validated by type before
anything runs, outputs come back on stdout as JSON, checkpoints and audit are
always on, and a story that is not marked `idempotent` is refused against a
production configuration unless you say `--allow-side-effects`. See
[Run a story from cron](../guides/run-from-cron.md).

## As a tool

```bash
yam tool serve --expose "Sign in"
```

An MCP server whose tools are the stories. Each tool's input schema is derived
from the signature, each call is a workflow run with the agent recorded as the
invoker, and the audit line is the only account of why the system changed. See
[Expose a story as an MCP tool](../guides/expose-a-tool-over-mcp.md).

Switching behaviour never requires recompiling or re-recording, and the runtime
cannot call a model in any of the three: the import boundary is linted and the
tool server's tests run with every external connection refused. The longer
account is [Behaviors](../behaviors.md).
