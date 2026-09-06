# The compiler tiers

A flow is compiled sentence by sentence, and each sentence is handled by the
lowest tier that can, so that the plan is deterministic wherever it can be and
every model decision is visible where it cannot.

| Tier | What it is | Model | Provenance |
|---|---|---|---|
| 0 | typed custom steps registered from the project's `steps/` directory, called by name and validated against their schema | none | none needed |
| 1 | a deterministic grammar over the enumerated sentence patterns; the same sentence always compiles to the same step | none | none needed |
| 2 | a small local model, pinned by digest, for sentences the grammar refuses; schema-constrained output | local, offline | required on the step |
| 3 | a frontier model through the gateway, for what Tier 2 cannot do | remote | required on the step |

## Why the grammar comes first

Tier 1 covers the patterns in [the flow language reference](../flow-language.md),
and the compiler eval holds it at 100 percent exact match over 250 golden
sentences. A sentence the grammar accepts never reaches a model, which is what
makes most plans reproducible from nothing but the flow file. A sentence it
refuses is reported with a suggestion, so the usual response is to rephrase
rather than to enable a model.

## What a model is asked

Only the residue, and only to produce a step in the same intermediate
representation the grammar produces, constrained by the schema. A Tier 2 step
carries the model, its digest, the prompt version and the confidence; `yam
compile` refuses to overwrite a committed plan whose Tier 2 steps came from a
different digest unless told `--allow-model-drift`. The whole published
compiler number, 98 percent exact match over 303 pairs, is the base model's:
the fine-tune missed its target and was withdrawn, and the report says so.

## Privacy

Tier 2 runs against a local model server and Tier 3 is off unless a gateway is
configured. In [privacy mode](../privacy.md) nothing leaves the machine and a
check proves it by refusing every outbound connection. Setting up the local
model is [its own page](../local-model.md).
