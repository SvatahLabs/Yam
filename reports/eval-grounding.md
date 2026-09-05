# Svatah eval report — grounding

Generated: 2026-09-03T05:55:38.844Z

> **This run used `fake:grounding-cases`, which is not a model.** The answers came from the committed cases themselves, so the accuracy below measures the eval harness — that it opens every page, grounds every phrase and checks every answer against the ground-truth key — and measures nothing about grounding. It is not REQ-REC-10's number and must not be quoted as one.

**Accuracy: 100.0%** over 198 case(s), against REQ-REC-10's 95.0% threshold. Met.

Gateway: `fake:grounding-cases`, model `fake:grounding-cases` — **not a real model**.

## Method

Each case is a phrase, a page, and the element the phrase means. The eval opens the
page — variant 0 unless the case names one — takes one snapshot, and runs the same
`ground()` the recorder runs, with the same prompt (`g-1`) and the same token budget.

The answer is checked against a ground-truth key. `apps/sample-web` stamps every
interactive element with `data-svatah-eval`, identical across all twenty variants, and
`bindings.ignoreAttributes` makes the surface blind to it: the eval reads it with a page
script, around the surface rather than through it (LLD §16). "It resolved" is not the
question; "is it the element the phrase meant" is.

**present** cases name an element on the page. Correct means the key matches; a different
key is `wrong-element`; a null is `missed`.

**absent** cases use a phrase that is real on another page and names nothing here. Correct
means null. A reference is a `false-positive` — the failure that costs the most in
production, because an automation that binds the closest-looking control does so
confidently and every night.

Only a null counts as correct on an absent case. A refusal by the recorder's own
confidence floor is the recorder saving the day, not the grounding being right, and folding
the two together would hide a model that guesses.

## Outcomes

| Outcome | Cases | What it means |
|---|---:|---|
| `correct` | 198 | the element the phrase meant, or a null where nothing matched |
| `wrong-element` | 0 | grounded to a different element — the failure that matters most |
| `missed` | 0 | a phrase that named something on the page came back null |
| `false-positive` | 0 | a phrase that named nothing came back with a reference |
| `unchecked` | 0 | grounded, and the ground-truth key could not be read, so nothing was verified |
| `unverified` | 0 | the chosen element could not be synthesised into a unique candidate |
| `low-confidence` | 0 | the model said it was guessing, and the recorder refused it |
| `refused` | 0 | the model declined the request |

## By page

| Page | Cases | Correct | Rate |
|---|---:|---:|---:|
| `/` | 22 | 22 | 100.0% |
| `/booking` | 35 | 35 | 100.0% |
| `/checkout` | 25 | 25 | 100.0% |
| `/dashboard` | 23 | 23 | 100.0% |
| `/docs` | 7 | 7 | 100.0% |
| `/login` | 30 | 30 | 100.0% |
| `/logout` | 9 | 9 | 100.0% |
| `/schedule-build` | 21 | 21 | 100.0% |
| `/widgets` | 18 | 18 | 100.0% |
| `/widgets/frame` | 8 | 8 | 100.0% |

## Every case that was not correct (0)

None.

## Cost

198 model call(s), 0 answered from cache, 0 tokens in, 0 out, $0.0000.

