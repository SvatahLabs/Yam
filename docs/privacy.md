# Privacy mode

> Tier 3 can be disabled and Tier 2 local so no step text leaves the machine
> during compile (REQ-NFR-3).

Svatah's design puts every model call at *authoring* time and none at replay
(HLD ADR-1). Privacy mode is what makes that a setting rather than an
architecture diagram: a project can be configured so that nothing it does
reaches beyond the machine it runs on, and there is a command that proves it.

## The configuration

```yaml
# svatah.config.yaml
compile:
  confidenceThreshold: 0.8
  # A model on this machine, for the sentences the grammar refuses.
  tier2:
    provider: ollama
    endpoint: "http://127.0.0.1:11434"
    model: "qwen2.5:3b"
    digest: "357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b"
  # No `tier3:` section. Without one, `--tier3` is refused with the reason.

record:
  # Screenshots are a configured fallback only, never the primary input.
  visionFallback: false

heal:
  # Relocalization is model-free; this keeps the model half off.
  useModel: false
```

Two things are not in that file and matter as much:

- **`--tier2` and `--tier3` are flags.** A compile with neither reaches nothing
  at all. Privacy mode is not a mode you have to remember to turn on; it is what
  happens by default, and a model is what you have to ask for.
- **A credential is never written to the project.** `ANTHROPIC_API_KEY` or
  `ant auth login`, and nothing else (REQ-REC-7). A machine with no credential
  cannot make a remote call by accident.

## What reaches a remote model

| Command | | |
|---|---|---|
| `svatah compile` | **nothing** | The grammar and the custom steps. `--tier2` adds a server on localhost; only `--tier3` reaches out |
| `svatah lint` | **nothing** | Same |
| `svatah run` | **nothing but the application** | REQ-RUN-1: the executor makes no model calls, and `runtime` cannot import the gateway. Structural, not a promise |
| `svatah repl` | **the application, and grounding** | `--gateway none` for no grounding at all; `--gateway fake` for the committed answers |
| `svatah bindings`, `svatah results` | **nothing** | Files |
| `svatah surface conform` | **the application** | |
| **`svatah record`** | **a remote model**, unless `--gateway fake` | Grounding needs a model. `--gateway fake` records from the grounding eval's committed answers, which is a fixture and says so in its provenance |
| **`svatah heal --run`** | **a remote model**, unless `--no-model` or `heal.useModel: false` | Relocalization is model-free; the re-grounding step is not (REQ-HEAL-1) |
| **`svatah compile --tier3`** | **a remote model** | That is what Tier 3 is |
| `svatah eval grounding` | **a remote model**, unless `--gateway fake` | |
| `svatah eval healing` | **nothing**, unless a model regrounder is registered | |
| `svatah mcp` | **nothing** | The tools it exposes are the ones above; whichever of them the agent calls is what reaches out |

**Local-only recording is P2** (REQ-NFR-3's own caveat). Today, recording either
uses a remote model or uses the fake; there is no local-model grounding path.
That is the one gap between "no step text leaves the machine during compile",
which holds, and "no step text ever leaves the machine", which does not yet.

## Checking the claim

The argument that `svatah run` makes no model call is structural: `runtime`,
`bindings` and the replay path cannot import `@svatah/gateway`, the
import-boundary lint says so, and a dependency-graph test walks every
`package.json` to be sure. But a structural argument is a thing a reader has to
follow.

This is the thing a reader can run:

```bash
NODE_OPTIONS="--import=./scripts/block-external-network.mjs" \
  node packages/cli/dist/bin.js compile evals/fixtures --stable

NODE_OPTIONS="--import=./scripts/block-external-network.mjs" \
  node packages/cli/dist/bin.js run evals/fixtures --host none
```

`scripts/block-external-network.mjs` refuses every connection that is not to the
machine itself, through all four doors Node has — `fetch`, `http`/`https`,
`net` and `tls`. Patching only the top would leave a socket open for anything
that skipped it. Loopback is allowed, because that is where the application
under test is, and where a local model server is.

A command that passes under it has demonstrably reached for nothing. A command
that reached for a model fails with the host named:

```
Blocked a fetch connection to api.anthropic.com. This replay is running with
external network access disabled: the executor makes no model calls and needs no
network beyond the application under test (REQ-RUN-1, REQ-NFR-1).
```

Or as one command, which is what CI runs:

```bash
pnpm privacy:check
```

```
compile: reached nothing beyond this machine
lint: reached nothing beyond this machine
run: reached nothing beyond this machine

Privacy mode holds: no step text left the machine.
```

`packages/cli/test/privacy.test.ts` runs the same claims as a suite, including
the ones a shell script cannot make: the **negative control** — that the blocker
blocks something, without which every other assertion would also pass against a
blocker that blocked nothing — that a Tier 2 endpoint on localhost is let
through and one on a remote host is not, and that the plan a blocked compile
produces is byte-identical to the one an unblocked compile produces.

## What a model is sent, when one is used

Worth knowing even when privacy mode is off, because "a model is involved" and
"my application's data went to a model" are different claims.

| | What is sent |
|---|---|
| Tier 2 / Tier 3 (compile) | **One sentence.** No page, no snapshot, no data — a compile has none of those |
| Grounding (`record`, `repl`) | The accessibility **snapshot** of the page: roles, names and states. Not the HTML, not the values of secret fields |
| Vision fallback | A screenshot, and only when `record.visionFallback: true`. Off by default (REQ-REC-2) |
| Healing | The same snapshot, for one element, and only when `heal.useModel` allows it |

Secrets never appear in any of them. `data.yaml`'s `secrets:` list is redacted
**by value** rather than by name, so a password that reached a prompt by any path
is caught before the request is sent — and the gateway aborts the call rather
than sending it if a secret survived rendering (REQ-NFR-6).

## What is committed, and therefore reviewable

Everything a model produced is a file in the repository with provenance saying
which model, which prompt version, when, and what it cost (REQ-AGT-3):

- `plan.json` — `origin.tier` and `origin.provenance` per step
- `bindings/**.yaml` — `provenance` per entry
- `runs/<id>/record-report.json` — every grounding decision, its tokens and cost

So "which model saw what" is answerable from the repository rather than from a
vendor's logs, which is the property that makes the rest of this page checkable
by someone who does not trust it.
