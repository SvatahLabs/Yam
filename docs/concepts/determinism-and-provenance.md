# Determinism and provenance

Replay reads files only. That sentence is the whole design, and everything else
follows from it.

## What a model is allowed to do, and when

A model may compile a sentence the grammar refuses, ground a phrase to an
element at record time, re-ground during a heal, and compile an agent's
exploration into a proposal. Each of those happens at authoring time and
produces a file: a plan step, a binding, a heal diff, a proposal. Replay never
calls a model, and that is structural: the runtime packages cannot import the
gateway, the boundary is linted and backed by a dependency-graph test, and the
tool server's tests run with every external connection refused.

## What provenance records

Every artifact a model produced carries who produced it: the model and its
digest, the prompt version, the snapshot hash it saw, the cost, and the time.
A binding a person clicked says `provenance.model: "human"`. The schema refuses
a Tier 2 step, a non-human binding or a heal entry without provenance. A
reviewer reading a pull request can tell which lines a model chose.

## Byte-stable plans

`yam compile --stable` produces the same bytes from the same flow, so the plan
is committed and a compile in CI that differs from it is a real change. The
model's decisions become visible as a diff instead of being remade silently on
every run. A pinned model digest and a prompt version are what make the claim
hold across machines.

## Checkpoints, audit and the run directory

The executor writes a checkpoint after every step when configured, and always
for workflows and tools. `--resume <runId> --from <stepId>` verifies the plan
and bindings hashes before continuing and refuses if either moved. The audit
log records the invoker, the inputs with secrets redacted, every surface call
with its reference and outcome, every policy applied, and the outputs, with a
monotonic sequence number. `runs/<id>/` is the only account of a run and is
readable without any service.

## Healed is not passed

A run that passed only because a binding was relocalized is `healed`, with its
own exit code, and the repair is a staged diff. A green build that quietly
rewrote its own bindings would defeat the point of having them in a file.
