# Grounding eval (REQ-REC-10, LLD §16)

198 cases. A case is a phrase, a page, and the element the phrase means.

```bash
pnpm eval:grounding                        # needs a credential; measures grounding
pnpm eval:grounding -- --gateway fake      # measures the harness, and says so
node scripts/grounding-cases.mjs           # rebuild cases.jsonl from the sample app
```

Against any deployment: `svatah eval grounding --base-url <url> --report <path.md>`.

## What a case is

| Field | Meaning |
|---|---|
| `page`, `variant` | Where it is asked. A case with no `variant` is variant 0. |
| `phrase` | What a person would write in a flow: "the username field". |
| `expect` | `present` — the phrase names an element here. `absent` — it does not. |
| `element` | The ground-truth key (`data-svatah-eval`) of the element meant. |
| `role`, `name`, `nth` | Enough to find the element's snapshot line without a model, which is how `--gateway fake` answers. |
| `source` | `fixtures` when the phrase came from a migrated flow rather than being generated. |

## Where the phrases come from

Generated from each element's own role and accessible name, across all ten sample
pages — so the set covers every control rather than the dozen someone thought of
— plus two cases on each of the twenty variants, because grounding is supposed to
be the part that survives a class rename or a login moved into a modal, and a set
drawn only from variant 0 would not test that.

The **absent** cases borrow a phrase that is real on another page. A model that
never answers null scores well on a set where every phrase names something;
answering one of these with a reference is a `false-positive`, which is the
failure that costs most in production.

Seventeen phrases come from `evals/fixtures/bindings` — the wording the four
migrated flows actually use, read from the store that holds it. Generated phrases
are regular by construction, and regular is not what a flow file looks like.

## What is deliberately not a case

- **An element with no ground-truth key.** `apps/sample-web` stamps interactive
  elements; the fixtures bind two headings, which are not. A case the eval cannot
  check could never be scored correct, so including it would put a permanently
  unreachable case in the threshold's denominator.
- **An element the snapshot does not contain.** `booking.indiranagar-suggestion`
  is an `<option>` inside a `<datalist>`, which the accessibility tree does not
  expose — the same limitation `evals/conformance/runtime/README.md` documents for
  clicking it. REQ-REC-2 measures grounding *from the snapshot*; that element is a
  case for the vision fallback, not for this suite.

## Reading the number

`reports/eval-grounding.md` says which gateway produced it, at the top, in bold.
A run against `--gateway fake` answers from these cases and therefore measures
the harness — that every page opens, every phrase is grounded and every answer is
checked against the ground-truth key — and nothing at all about a model. Only a
run against a real gateway is REQ-REC-10's number.
