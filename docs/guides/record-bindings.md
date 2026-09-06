# Record bindings

A binding is a file under `bindings/<app>/<page>/<element>.yaml` that names an
element by a ranked bundle of candidates and a structural fingerprint. Recording
is the only time an element is chosen; replay reads the file.

## In a plain Playwright project

```bash
YAM_MODE=record YAM_HEADED=1 npx playwright test
```

Each `bind(id, phrase)` whose id is unbound opens a picker in the headed browser:
click the element, and the binding is synthesised with `provenance.model:
"human"`. No model is involved.

In CI there is nobody to click, so `YAM_PICK` names the element per id:

```bash
YAM_MODE=record YAM_PICK='{"login.username-field":"username"}' npx playwright test
```

A bare word is a test id, anything else a CSS selector. It is a test affordance
for exercising the record path headless, not a way to write selectors again.

## In a flow project

```bash
yam record                               # you click: the default at a terminal with no credential
yam record --gateway anthropic           # a model grounds each phrase
yam record --flow flows/login.flow --story "Sign in" --rebind
```

The recorder drives the compiled plan on the configured adapter. For every
target phrase it takes a snapshot and grounds the phrase to a reference. With
the `human` gateway the browser that opened shows an overlay naming the phrase
and waits for your click; Escape stops the session. With a model gateway the
model reads the snapshot and proposes. Either way the recorder then calls
`describe()` on the element and synthesises candidates and a fingerprint. With a model, every proposal is
shown for review before anything is written, and the binding carries the model,
the prompt version and the snapshot hash as provenance.

`--rebind` re-records elements that already have a binding. `--input k=v`
supplies signature inputs; secrets come from `YAM_INPUT_<NAME>` in the
environment, never the command line.

## What a binding contains

```yaml
id: login.username-field
phrases: ["the username field"]
context: { hash: "…", role: form }
candidates:
  - { by: testId, value: username }
  - { by: role, role: textbox, name: Username }
  - { by: css, value: "form#login input[name=username]" }
fingerprint: { role: textbox, name: Username, neighbours: [...], box: [...] }
provenance: { model: human, at: "…" }
```

Candidates are tried in order at replay until exactly one element matches. The
fingerprint is what [healing](heal-bindings.md) scores against when none does.
The store format is LLD §3.3 and §6.1; `yam bindings list`, `show` and
`verify` read it from a terminal.
