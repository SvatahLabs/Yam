# The local model (Tier 2)

Tier 2 is a small instruct model on your own machine, asked about the sentences
the controlled grammar refused (REQ-COMP-3, LLD §4.3). It exists for two
reasons: so that a paraphrase does not have to become a compile error, and so
that no step text has to leave the machine to avoid one (REQ-NFR-3).

It is **off unless you ask for it**. `svatah compile` with no flags reaches no
network at all; `--tier2` reaches a server on localhost; only `--tier3` reaches a
remote one. See [privacy.md](privacy.md).

## Setting it up

```bash
# Ollama, which serves a JSON-Schema-constrained endpoint on localhost.
brew install ollama          # or: curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
ollama pull qwen2.5:3b

# The digest of the weights you just pulled. Pin it (see below).
curl -s http://127.0.0.1:11434/api/tags |
  python3 -c 'import json,sys; print(next(m["digest"] for m in json.load(sys.stdin)["models"] if m["name"]=="qwen2.5:3b"))'
```

```yaml
# svatah.config.yaml
compile:
  confidenceThreshold: 0.8
  tier2:
    provider: ollama                       # or llamacpp
    endpoint: "http://127.0.0.1:11434"     # llama.cpp: http://127.0.0.1:8080
    model: "qwen2.5:3b"
    digest: "357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b"
```

```bash
svatah compile --tier2            # the grammar, then the local model
svatah lint --tier2               # the same, reporting W_TIER2 per step
svatah eval compiler --only tier2 # the measurement below, on your machine
```

## Which model

REQ-COMP-3 asks for a 1.7B–4B instruct model. Two were measured against the
`tier: 2` subset of `evals/compiler/golden.jsonl` on this project's own hardware:

| Model | Size | Exact match | Notes |
|---|---|---|---|
| `qwen2.5:3b` | 3.1B | **90.2%** (37/41) | The default this document recommends |
| `llama3.2:3b` | 3.2B | 80.5% (33/41) | Clears the threshold; weaker on argument shapes |

Both clear REQ-COMP-3's 80%. The gap is almost entirely in how reliably each one
fills the *argument* fields, which is what the constrained schema is there to
help with and what a larger model does better without help.

Reproduce either with:

```bash
svatah eval compiler --only tier2 --report reports/eval-compiler.md
```

## Why it is deterministic

A model in a compiler is only tolerable if two compiles of one project produce
one plan (REQ-COMP-7). Four things make that true, and none of them is optional:

**Temperature 0 and a fixed seed.** Set by the gateway, not by the config: a
project that could turn the temperature up would be a project whose plans stopped
being reproducible, and that is not a knob worth having.

**A schema, not a plea for JSON.** Ollama's `format` parameter takes a JSON
Schema and constrains generation to it. The schema is generated from the same Zod
type the answer is validated against, so a model that could produce an invalid
action does not. It is a *closed* object down to the argument names — `url`,
`value`, `key`, `index` and the rest — which is why `{"url: ": …}`, a real answer
from a real 3B model, is now impossible rather than merely discouraged.

**A pinned digest.** `compile.tier2.digest` is the sha256 of the weights. Ollama
reports it on `/api/tags` — *not* on the generation response — so Svatah resolves
it once per session and compares before the first call. A mismatch **fails the
compile**:

```
qwen2.5:3b on http://127.0.0.1:11434 reports digest 357c53… and the project pins
0000…. Update the pin deliberately, or pull the pinned build.

  Nothing was compiled. A pinned digest is what lets a plan's provenance say
  which weights produced a step (REQ-COMP-3); pass --allow-model-drift to
  compile anyway.
```

`--allow-model-drift` suppresses the *check* and not the *record*: the digest the
server actually served still goes into every step's provenance, so a plan
compiled that way says so and a reviewer can see it.

llama.cpp has no digest — it serves a GGUF file and reports a path — so a project
on llama.cpp cannot pin. Saying so is better than pretending to.

**A stable timestamp under `--stable`.** Provenance carries the time of the call,
which differs on every compile. `--stable` fixes it, exactly as it fixes
`generatedAt`, and nothing else in provenance is touched: the model, the digest,
the prompt version, the tokens and the cost are facts about the *answer* rather
than about when it was asked for.

## What the model is actually asked

One sentence, and nothing else. Never a page, never a snapshot, never data — a
compile has none of those, which is why compiling is the cheapest place in the
system for a model to be.

The prompt is three parts:

1. **The job**, in six lines: which field means what.
2. **The conventions** (`packages/cli/src/tiers/conventions.ts`): which argument
   each action takes, and the handful of distinctions a model gets wrong when it
   is not told — that `should not be visible` is `{"kind":"visible","negate":
   true}` and not `{"kind":"hidden"}`, that `refresh` has no target, that
   `{data.a.b}` is a data reference and never an input. Every entry there was an
   actual failure on the golden subset before it was written down.
3. **Eight retrieved examples** from the Tier 1 golden entries — the nearest by
   word overlap, weighted towards the same action when the project's synonym
   vocabulary recognises a word in the sentence. A small model is far better at
   "like these" than at "here are the rules", and the examples are the corpus the
   grammar is already measured against rather than a second one that would drift
   away from it.

## What Tier 2 does *not* decide

The model answers with the same shape the grammar answers with — an action, a
target **phrase**, argument values — and the same `lower.ts` finishes both. It
never sees, and never chooses:

- **element ids**, which come from the project's target dictionary (REQ-COMP-5);
- **which values are secret**, which comes from `data.yaml`'s `secrets:` list
  (REQ-NFR-6);
- **timeouts**, which come from the config;
- **step ids**, which are positional.

So a Tier 2 step and a Tier 1 step differ in exactly one place in the finished
plan: `origin`. That is REQ-COMP-1's "every step records tier of origin" as a
property of the artifact rather than of a report beside it.

## Reviewing what it produced

Every Tier 2 step carries `origin.tier: 2`, `origin.confidence: 0.6` and full
provenance. The confidence is a **ceiling**, deliberately below the default
`compile.confidenceThreshold` of 0.8, so `svatah lint` reports every one of them
twice — once as `W_TIER2` and once as `W_LOW_CONFIDENCE`:

```
$ svatah lint --tier2
flows/sign-in.flow:4: warning W_TIER2: Compiled by the local model, not by the grammar: "Tap the sign in button".
flows/sign-in.flow:4: warning W_LOW_CONFIDENCE: Confidence 0.60 is below the configured 0.80: "Tap the sign in button".
```

A guess a small model made about what a person meant is a thing a person should
read before it is committed. A tier that reported 0.95 would be a tier that
quietly turned that off.

The plan is committed, so the diff is the review: a re-compile that changed a
step is a visible change to `plan.json` and not a silent one.
