# Heal bindings when the interface changes

Healing is model-free relocalization: when no candidate of a binding resolves,
every element now on the page is scored against the recorded fingerprint, and a
clear winner, above the threshold and clear of the runner-up, is proposed. A
run that only passed because a binding was healed is `healed`, never `passed`,
and a repair reaches the store only through a diff a person reads.

## Inline, in a Playwright project

```bash
YAM_MODE=heal npx playwright test
```

On a `LocatorError` the fixture relocalizes, retries the step once against the
proposal, annotates the test `healed`, and stages the repair in
`.yam/heal-proposals.jsonl`. The store is untouched.

## As a step, in a flow project

```bash
yam run --host playwright || yam heal --run "$(cat .yam/last-run)"
yam heal --from-bind-failures            # from a Playwright project's .yam/
yam heal --run <id> --apply              # write the accepted repairs
```

`yam heal` reads the failures of a run, relocalizes each, verifies the proposal
by resolving it live, and writes a diff and a report. `--apply` writes the
repairs to the store; without it nothing changes, which is the right default for
CI. `--no-model` is the default in every published number; a model may be
consulted for re-grounding when a gateway is configured, and then the repair
says so in its provenance.

## Reading the numbers

The healing claim is published with its method in
[`reports/eval-healing.md`](../../reports/eval-healing.md): over twenty
deliberate interface changes to the sample application, relocalization alone
recovers 92.3 percent of the bindings that degraded, with zero repairs onto the
wrong element. A repair counts only when the proposed element carries the same
ground-truth key as the one recorded, and that key is hidden from the healer.
Regenerate it with `pnpm eval:healing`.

## What healing does not do

It never invents an element. If nothing scores above `heal.relocalizeThreshold`
(default 0.72) with a margin of `heal.margin` (default 0.10) over the next
candidate, the failure stands and the report says why. A control that was
removed stays a failure, which is what a test is for.
