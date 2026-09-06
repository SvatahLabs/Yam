# Write a flow

A flow file is blocks of plain sentences. The grammar is small enough to hold
in your head; the sentence patterns are enumerated, with two examples each, in
[the flow language reference](../flow-language.md).

## Blocks

```
story (tags=smoke, onFailure=compensate:Cancel booking): Book a slot
inputs: location: string, when: string = "tomorrow"
outputs: booking: string
  Go to "/book"
  Type {input.location} into the location field
  Click the first suggestion
  Only if the confirm dialog is visible, Click the confirm button
  Remember the text of the booking summary as booking

scenario: Cancel booking
  Click the cancel booking button

compose: Booking stories
  Book a slot

test: Booking stories
```

- `story` is the unit of behaviour; `scenario` is a story that runs in file
  order when there is no run block; `compose` names a sequence of stories;
  `test` and `run` say what a run executes.
- `inputs:` and `outputs:` are the signature. Types are `string`, `number`,
  `boolean`, `secret`; defaults are allowed; a `secret` is redacted wherever it
  could be written.
- `Only if <predicate>, <sentence>` and `Unless …` guard a step. A guard that
  does not hold skips the step and never acts.
- `onFailure` is `stop`, `continue` or `compensate:<story>`, and `idempotent`
  is what lets a story be exposed as a tool in production.

## Sentences

Targets are phrases, never selectors: "the username field", "the sign in
button", "the first suggestion". The compiler normalises the phrase into an
element id and the recorder binds it. Values come from `{input.name}`,
`{data.path}`, `{name}` for a capture in this story, or `{Story.name}` for
another story's capture; captures never overwrite.

Expectations read as English: `The dashboard heading should be visible`,
`The URL should contain "/dashboard"`, `Every button on this screen should have
an id`. `Expect … to …`, `Verify …` and `Check that …` are accepted aliases.

## Lint before you compile

```bash
yam lint
```

Lint reports ambiguous targets, long sleeps, unused captures, a dialog step with
nothing armed, a side effect inside a story exposed as a tool, and a binding
file that declares no phrases. Each warning has a code you can look up in the
reference. `yam compile` refuses a flow with an unbound target, an undefined
variable or a type error: failures belong at authoring time, not at replay.

## Typed steps for logic

When a sentence is not enough, a Tier 0 step is a typed function you register
from the project's `steps/` directory and call by name; its arguments are
validated against its declared schema. The grammar, the local model and the
frontier model never see it. See [the compiler tiers](../concepts/compiler-tiers.md).
