# Grounding eval (REQ-REC-10, LLD §16)

198 cases. A case is a phrase, a page, and the element the phrase means.

```bash
pnpm eval:grounding                        # needs a credential; measures grounding
pnpm eval:grounding -- --gateway fake      # measures the harness, and says so
node scripts/grounding-cases.mjs           # rebuild cases.jsonl from the sample app
```

Against any deployment: `yam eval grounding --base-url <url> --report <path.md>`.

## What a case is

| Field | Meaning |
|---|---|
| `page`, `variant` | Where it is asked. A case with no `variant` is variant 0. |
| `phrase` | What a person would write in a flow: "the username field". |
| `expect` | `present` — the phrase names an element here. `absent` — it does not. |
| `element` | The ground-truth key (`data-yam-eval`) of the element meant. |
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

## The desktop set (T11.3, LLD §13.9)

`desktop-cases.jsonl` is the same idea for the app, and `pnpm
grounding:desktop-cases` rebuilds it from a real read of the real application:
launch the packaged app, record the welcome screen, open the fixtures project
through its own Recent button, walk the rail's eight screens and the palette's
four, and turn every control with a name and an id into a case.

Two things differ from the web set, and both follow from what a desktop
application is.

**The key is the window title**, not a URL path. LLD §3.3 has always said a
binding's context pattern is "a URL *or window-title* pattern"; a window has no
segments to generalise. So a case carries `window` where a web case carries
`page`, and the grounding question says `Window: Yam` where a web one
says `Page: …`.

**The ground truth is the `automationId`.** `apps/sample-web` stamps
`data-yam-eval` on every element for the web eval; the app needs no such
stamp, because LLD §13.7's accessibility contract already requires an id on
every button, link, tab, field and row action and the desktop snapshot case
fails a live gate when one is missing.

`desktop-answers.jsonl` is the desktop twin of `fixture-answers.jsonl`: the
phrases `evals/self`'s flows use that a *generated* case cannot cover. The
generated phrase comes from a control's accessible name — "the fixtures button"
for the Recent list's first entry, whose name is a directory on one machine, and
"the Flows heading" for a toolbar title named after whichever screen is open. A
flow says "the first recent project" and "the toolbar title", which are what the
control *is* rather than what it happens to say. Nothing scores these; the
recorder reads them so a self flow can be recorded with no credential.
