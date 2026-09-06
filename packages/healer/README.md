# @svatah/yam-healer

Module (a)'s repair half (REQ-HEAL-1..6): failure selection, model-free
relocalization, verification, and a diff.

The healer is part of module (a), so it must not depend on the model gateway. The
model re-grounding step is therefore a plugin — `Regrounder`, LLD §10 — with a
no-op default. Module (b) registers the recorder's implementation at CLI start;
module (a) alone runs relocalization only and reports the rest as unrepaired
rather than pretending they were fixed.

## The healing eval (REQ-HEAL-5)

`src/eval.ts` measures what relocalization alone recovers over the twenty
deliberate UI changes in `apps/sample-web`. The method is part of the result and
is printed with it — a healing percentage without one is not a number:

- Bindings are recorded for every interactive element on every sample page at
  variant 0, **with test-id attributes disabled**. An application that carries a
  `data-testid` on every control barely needs healing; a binding anchored on one
  survives almost every front-end change, and measuring on that population would
  flatter the result into meaninglessness.
- Each variant is loaded on the pages it changes.
- A **candidate** has broken when it no longer identifies exactly one element.
- A **binding** is degraded when at least one of its candidates has broken. Those
  are the cases the number is about.
- **Recovered** means relocalization proposed an element *and* a candidate
  re-synthesised from that element resolves back to it. The score alone is never
  taken as proof: an unverified repair is how a healer quietly binds to the wrong
  thing (REQ-HEAL-3).

Three counts are reported, because the interesting result is not only the
percentage: how many individual locators broke, how many bindings stopped
resolving *entirely* (a synthesised bundle carries five to eight independent
candidates, so a single-property change rarely takes them all), and how many
degraded.

Run it through `yam eval healing --no-model`; the committed report is under
`reports/`.

## Licence

Apache-2.0.
