# @svatah/recorder

Grounding, the record session, and the record report (LLD §11).

The recorder turns a plan's `unbound` targets into bindings by driving the plan
on a real platform and asking a model — once, per element — which element a
phrase names. Everything after the model's answer is model-free.

```
ground(target, surface, options):
  refuse if environment is production and --force-production was not given
  snapshot() → prune to the token budget → prompt g-1 → ref | null
  ref === null → not-found, and the session stops
  describe(ref) → synthesise candidates → dry-check → BindingEntry
```

## The snapshot is the input; a screenshot is a fallback

REQ-REC-2 is explicit, and the ordering is what makes grounding work on a
headless adapter rather than only on a browser someone is watching: the
accessibility snapshot with references is the model's input, and a picture is
taken only when the tree answered null *and* `record.visionFallback` is on *and*
the adapter can take one.

## A model's answer is a hypothesis, not a binding

The model returns a reference into a snapshot, which stops meaning anything the
moment the page changes. What goes in the store is what synthesis makes of the
element it points at: candidates that each resolve to exactly one element, and to
*that* one (REQ-REC-3), confirmed by a dry-check that asks the question the
resolver will ask at replay.

The entry is written `verified: false`. Verification is REQ-REC-5's: the session
performs the step with the top candidate and checks the expectation. Calling a
binding verified because a model was confident about it would empty the word.

## The session, and what it writes

`record()` is a loop around `runStep` from `@svatah/runtime` — the same function
`svatah run` and the Playwright host call — with grounding added before each
step. That is REQ-REC-5 taken literally: recording verifies a binding by
*performing the step*, and the verification only means something if recording
performs a step the way replay will.

A binding reaches the store when a step performed through it and its expectation
held. Grounded-but-unproven entries are staged into the live store while the
session runs, because the resolver has to find them to perform the step at all,
and rolled back at the end. So a session that stops at step four writes the three
it proved and not the fourth, and an impossible expectation writes nothing.

## Two plugins for module (a)

`recorderRegrounder()` is the healer's model half (LLD §10), reached only after
relocalization could not place a fingerprint. `recorderBindGrounder()` is
`bind()`'s record mode (LLD §6.5), which module (a) otherwise answers by waiting
for a person to click. Both return `null` rather than failing, and `@svatah/cli`
registers them — LLD §10 puts that wiring at CLI start, and the CLI is the one
package allowed to import everything.

## Testing it

`scripts/record-snapshots.mjs` records `apps/sample-web` — the snapshot,
`describe(ref)` for every reference, and `locate(candidate)` for every candidate
synthesis proposes — into `test/fixtures/pages.json`. The tests replay that with
the fake gateway, so they need no browser and no credential, and nothing is
simulated: every answer the surface gives came off the real page once. The live
path is covered in `packages/cli`, which is allowed to import an adapter.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits and
[`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it must respect.
