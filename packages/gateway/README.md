# @svatah/yam-gateway

The only place in the workspace that talks to a model (T3.1, LLD §10).

Everything above it — the recorder, the healer's `Regrounder`, the compiler's
upper tiers, the evals — asks a question with a Zod shape and receives an answer
of that shape plus its provenance. Everything below the behaviour layer cannot
import it at all, which is what makes REQ-RUN-1 — "the executor makes no model
calls" — a build-time fact rather than a promise.

```ts
import { anthropicGateway, DiskCache } from "@svatah/yam-gateway";
import { z } from "zod";

const gateway = anthropicGateway({ cache: new DiskCache(".yam/model-cache") });

const { value, provenance, cached } = await gateway.ask({
  promptVersion: "g-1",
  system: INSTRUCTIONS,   // stable across calls, sent as one cached block
  user: snapshotText,     // volatile: this step, this page
  answer: z.object({ ref: z.string().nullable(), why: z.string() }),
});
```

## Backends

| Factory | What it is |
|---|---|
| `anthropicGateway` | Claude Opus 5 through `@anthropic-ai/sdk`, with adaptive thinking, a cached system block, and structured output from the answer schema. |
| `localGateway` | Ollama or llama.cpp on the machine, temperature 0 and a fixed seed, with a pinned digest that is refused rather than warned about when it moves (REQ-COMP-3). |
| `fakeGateway` | Answers from a function. Not a test stub bolted on: the whole contract runs green with no credential, and it reports `real: false` so an eval can say which gateway produced its numbers. |

## What it guarantees

- **Secrets never reach a model** (REQ-NFR-6, REQ-REC-7). `render()` is a pure
  function from a request to the bytes on the wire; it redacts by value, and then
  asserts the rendered body is clean. A value that survives stops the call.
- **A refusal is an answer, not an outage** (LLD §10). `stop_reason: "refusal"`
  raises `GatewayRefusal` with the category, is never retried, and is never
  cached.
- **A cache hit costs zero** (REQ-NFR-2). Answers are keyed on everything that
  could change them and on nothing else; a hit is re-validated against the
  caller's schema rather than trusted.
- **Provenance on everything** (REQ-AGT-3, REQ-STD-4): model, prompt version,
  timestamp, tokens, cache read, cost.

## Credentials

Never a parameter. The SDK resolves `ANTHROPIC_API_KEY`, then
`ANTHROPIC_AUTH_TOKEN`, then an `ant auth login` profile, so a zero-argument
client is both the simplest and the only correct thing to construct — a key this
code could name is a key this code could write somewhere.
`credentialInEnvironment()` reports whether one is set, for a caller that has to
choose a gateway before building one.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits and
[`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it must respect.
