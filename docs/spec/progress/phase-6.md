# Phase 6 — progress and verification

Branch: `phase-6` (from `master` at `bd184e0`) · Date: 2026-09-04 · Scope: the
five Phase 5 corrections and T6.1 … T6.6 of [`../tasks.md`](../tasks.md).
Nothing beyond Phase 6 was started.

## Summary

| Item | Title | Status | Commit |
|---|---|---|---|
| F1 | A compensating story's steps keep their own statuses | done | `270a277` |
| F2 | The Record screen chooses the gateway | done | `53dcc6b` |
| F3 | `Step.guard.target` end to end | done | `c2f83fc` |
| F4 | The decision deadline, and the 409 documented | done | `7a42b08` |
| F5 | The verifier's results in `phase-5.md` | done (no code) | `dbfce7b` |
| T6.2 | macOS Accessibility adapter | done, **live gate blocked** | `ce3c087`, `bf29a5a` |
| T6.1 | Windows UIA adapter | done, **live gate blocked** | `a527184` |
| T6.3 | WebMCP candidate | done | `4e92f24` |
| T6.4 | Java conformance runtime | done, **zero mismatches** | `4d5f401` |
| T6.6 | Prototype data import | done | `56600ac` |
| T6.5 | Tier 2 fine-tune pipeline | done, **training run not completed** | `ae6f27b` |

The spec is untouched:
`git diff master..phase-6 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.

## The contract

Run in a **clean detached worktree of `phase-6`** (`/tmp/p6verify`), with
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `SVATAH_BASE_URL` unset.

```bash
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r test
```

| Command | Result |
|---|---|
| The contract, no credential, Node v25.6.1 | 33 packages built; **2,708 vitest + 241 Playwright Test = 2,949 passed, 0 failed** |
| The same on **Node v22.20.0 with `CI=true`** | **2,949 passed**, 0 failed |
| `pnpm lint` (includes the LLD §1 import boundaries) | 0 errors |
| `git diff master..phase-6 -- docs/spec/*.md` | empty |
| `cd runtimes/java && ./gradlew --no-daemon clean fatJar test` | BUILD SUCCESSFUL, JDK 17 |
| `node scripts/runtime-conformance.mjs` | **conformant — 40 step results, zero mismatches**, twice |
| `node packages/cli/dist/bin.js eval finetune export` | 83 pairs from `master`, 60 excluded as the test set |
| `node scripts/desktop-conformance.mjs --adapter ax` | **exit 2, host not ready**: `ax/accessibility denied (-25211)` |
| `node packages/cli/dist/bin.js surface doctor` | `ax/accessibility denied`, `uia/platform skipped (not Windows)`, exit 1 |

## Which environment fallback applied

| Task | Gate | What happened |
|---|---|---|
| T6.2 | AX conformance against the ADE | **Blocked.** macOS refuses assistive access to `osascript` here; `surface doctor` reports `denied` with the code. Tested against accessibility trees **recorded from the real ADE**. |
| T6.1 | UIA conformance against the ADE | **Blocked.** This host is not Windows. Same recorded trees, in the UIA vocabulary. |
| T6.4 | Runtime conformance | **Ran.** JDK 17 and Playwright for Java were available; zero mismatches. |
| T6.5 | LoRA training | **Started, not completed.** A stack installs and the run begins; a full pass is hours on this machine. No improvement is reported. |
| T6.6 | A prototype database | **Synthesised**, from the prototype's own source and the real legacy files. |
| — | Model credential | None. Every recording in the suite uses `--gateway fake`; the compiler eval's Tier 2 used the local Ollama the golden project pins. |

---

## F1 — A compensating story's steps keep their own statuses

**Reproduced first.** `svatah run --story "I want to book and then fail"` against
`apps/sample-web`:

```
cancel a booking | aborted | Click the cancel booking button    |
cancel a booking | aborted | The booking reference should say … |
```

while `audit.jsonl` showed `act click ok`, `locate ok` and `check ok` for the
same two steps. A cancellation that worked and one that failed produced
identical lines, so the only question a reader has about a compensation had no
answer in the file.

**Implemented** LLD §8.3 as amended: the compensating story's steps keep their
own statuses; the failing step carries `policyApplied`; the flow and the run are
`aborted`. After:

```
I want to book and then fail | failed | Click the pay button | {"compensate":"cancel a booking"}
cancel a booking             | passed | Click the cancel booking button
cancel a booking             | passed | The booking reference should say …
flow: aborted · exit 11 · totals.aborted: 0
```

Since no step is labelled `aborted` any more, the abort is read off the failing
step's `policyApplied`, which is an object exactly when the policy was a
compensation. `abortedByPolicy` states that as a function on `results.jsonl`
rather than as executor state, because the Playwright Test reporter, the runtime
conformance suite and a foreign runtime all have that file and nothing else.

`docs/flow-language.md` gains a policy table and says what `aborted` is a status
*of*. A new test runs a compensating story whose expectation cannot hold: before
this change it and the passing one wrote the same two lines.

## F2 — The Record screen chooses the gateway

`Record.tsx` posted `{ rebind: true }`, so with no credential the first press of
"Start recording" produced `record.failed` telling the person to "pass
`--gateway fake`" — a flag an Electron window cannot pass.

* `GET /project` reports `gateway.credential`, a boolean and never the key.
  `ServiceApi.hasModelCredential` is injected by `svatah serve` as
  `credentialInEnvironment` — the same function `gatewayForRecording` asks — so
  the screen offers what the recorder would pick.
* The screen has a gateway control defaulting to `anthropic` when the service
  reports a credential and `fake` when it does not, both labelled for what they
  are, sent in `POST /record`.
* `record.failed` is an alert whose advice names controls in the window.

Choosing `anthropic` explicitly with no credential used to surface the Anthropic
SDK's own sentence about "apiKey, authToken, credentials, config, or profile" —
the SDK resolves authentication at request time, so `GatewayUnavailable` was
never raised. It is now, which the CLI gets as well.

**Evidence:** `apps/ade/test/review.test.ts` — `GET /project` reports the boolean
both ways and the response contains no key; a session started the way the screen
now starts one reaches a decision; `anthropic` with no credential fails and
`adviseOnFailure` rewrites it with no `--flag` in it; a second session gets 409.
`apps/ade/test/screen-rule.test.ts` checks the control, the alert, and that no
string the advice returns names a flag.

## F3 — `Step.guard.target` end to end

`Step.guard` gains `target?: TargetRef` (LLD §3.2, Draft 2.7).

* **Grammar** already carried the phrase; `lower` turns it into a `TargetRef`
  through the same dictionary, and **omits it when it names the element the step
  already addresses** — `target` says it, and every plan compiled before Draft
  2.7 stays byte-identical (REQ-COMP-7).
* `E_GUARD_OTHER_TARGET` is gone. `E_GUARD_NO_TARGET` narrows to a target guard
  with no element anywhere; the grammar cannot write one, so it is tested
  through the model-tier path, which can.
* **Recorder** grounds the guard's element, and grounds it *first*, because that
  is the order the executor resolves them in.
* **Executor** resolves the guard's own target, so a step whose guard is false
  never touches the element it would have acted on.
* **Golden** `g-123` and `g-124` restored to the documented sentences;
  `docs/flow-language.md` pattern 28 rewritten with all three cases.

**Evidence:** `svatah eval compiler` — `ok g-123 tier 1 Only if the login error
is hidden, click the sign in button`. End to end against the sample application,
one true guard and one false, each about a different element from the one the
step acts on, with the audit showing no `act` for the skipped step and a `check`
against the guard's element.

## F4 — The decision deadline, and the 409

`record.decisionDeadlineMs` in the config schema (default 600000) and in the
service. A blocked session holds a browser open *and* answers 409 to everyone
else, so a reviewer who closed the ADE window left the service unusable until it
was restarted. On expiry the grounding is **rejected** — never accepted by
default — `record.decision.expired` goes to the stream, and the session stops
with a report.

The deadline is read from the project's own config: how long a review takes is a
property of the project being reviewed.

The 409 was already the behaviour and is now in the OpenAPI *description* rather
than only the response list, with the deadline and the two `gateway` values.

**Evidence:** `packages/service/test/contract.test.ts` — a second session gets
409 and starts nothing, then starts once the first is stopped; the expiry fires
and produces `{ accept: false, why: "… decisionDeadlineMs" }`; an answer in time
clears the timer.

---

## T6.2 — The macOS Accessibility adapter

`@svatah/adapter-ax` implements `AgentSurface` over `AXUIElement` per LLD §7.5:
`AXRole` → the ARIA vocabulary, `AXIdentifier` → `automationId`, `controlPath`
from the ancestor chain, `AXPress`/`AXSetValue` with a pointer fallback at the
element's box centre, `state`/`restore` on the window, screenshots through the
OS.

**Through System Events and `osascript`, not a native N-API module.** §7.5 says
"`AXUIElement` via a small native module"; a native module needs a compiler on
every machine that installs the package, and macOS already ships a client of the
same API. Recorded as a deviation (D1) with the cost stated.

### The live gate, blocked

```
$ node packages/cli/dist/bin.js surface doctor
ok    -/platform             darwin arm64, Node v25.6.1
FAIL  ax/accessibility       denied — execution error: Error: Error: osascript is
                             not allowed assistive access. (-25211)
      → The Accessibility permission was refused for the program running Svatah…
$ echo $?
1

$ node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
The host is not ready for the "ax" adapter, so the conformance suite was not run.
Nothing was written to reports/adapter-ax.md: a report from a run that could not
start would be a result nobody took.
$ echo $?
2
```

**No conformance result is claimed.** The command that produces one, on a host
where the permission is granted:

```bash
pnpm -r build
pnpm --filter @svatah/ade exec electron-forge package
node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

The probe was wrong at first and the correction matters (`bf29a5a`): it counted
`applicationProcesses`, which needs only Automation permission and succeeds on a
machine where the accessibility API is refused — so `doctor` said `granted`
while every `snapshot` failed. It now reads a process's `uiElements()`, which is
what the adapter does.

### What was tested instead

`scripts/record-desktop-tree.mjs` launches the **real ADE** with `SVATAH_A11Y=1`,
opens `evals/fixtures` **through the ADE's own Recent-project button**, clicks a
screen's tab, and reads Chromium's accessibility tree over the DevTools protocol
into the `AxNode` shape. Six screens are recorded. They are a real application's
real accessibility tree — not hand-authored — and they are **not** the output of
`AXUIElement`: they are the tree Chromium's macOS bridge serialises *from*.

74 tests: the role and subrole maps against every `AXRole` the ADE produces, the
`automationId` precedence, the snapshot shape, `controlPath` uniqueness, the
candidate bundle, the predicates, the whole surface, and **the published desktop
conformance suite run end to end** (`DESKTOP_CASES`, 7 cases, all passing).

`@svatah/conformance` gains `DESKTOP_CASES`: the five flows LLD §16 names against
the ADE, plus the snapshot shape and a case that a desktop adapter refuses
`navigate` rather than answering it with a no-op. `surface conform` picks the
suite by the surface's own `kind`.

**A defect the desktop adapters exposed:** the conformance runner opened the
surface outside its `try`, so a session that would not open crashed the command
with a stack trace and no report. Survivable while a session failure meant "the
browser did not launch"; a missing Accessibility permission is a normal,
user-fixable state, and the answer to it is a report a person can read.

## T6.1 — The Windows UI Automation adapter

The sibling of the AX adapter, over `UIAutomationClient` through PowerShell —
which §7.5 explicitly allows ("a wrapped driver with the same surface").
`ControlType` → the ARIA vocabulary, `AutomationId` → `automationId`,
`controlPath` from the ancestor chain, and `act` through UIA **patterns** with a
mouse fallback.

`click` tries `Invoke`, then `SelectionItem`, then `Toggle`: a tab has no
`Invoke`, because pressing one *selects* it, and without that a click on the
ADE's screen tabs would fall through to the mouse for no reason.

Both adapters now check the **host before the configuration**: telling someone
on macOS to set `app.processName` for the UIA adapter is the wrong advice.

### The live gate, blocked

```
$ node packages/cli/dist/bin.js surface doctor --adapter uia
ok    -/platform             darwin arm64, Node v25.6.1
skip  uia/platform           not Windows
```

On a Windows host:

```powershell
pnpm -r build
pnpm --filter @svatah/ade exec electron-forge package
node scripts/desktop-conformance.mjs --adapter uia --report reports/adapter-uia.md
```

CI runs exactly that on `windows-latest` (`desktop-conformance` in
`.github/workflows/ci.yml`), and gates on it.

### The parity test, and the two defects it found

`packages/adapter-uia/test/parity.test.ts` is the substance of REQ-SURF-4, which
was a claim nothing checked: each adapter's tests asserted against its own
fixtures, so both could drift in the same direction and stay green.

`scripts/record-desktop-tree.mjs` reads the ADE's window **once** and writes it
twice — as AX attributes and as UIA properties — so the two fixtures are the
same window. (They were two launches at first, and the ADE's ephemeral service
port and growing list of runs both showed up as parity failures that were really
recording noise.)

It found two real normalisation defects:

| element | macOS | Windows | outcome |
|---|---|---|---|
| a `<select>`'s `<option>` | `AXMenuItem` → `menuitem` | `ControlType.ListItem` → `option` | **fixed** — the AX adapter reads the pop-up ancestor |
| a `<td>` | `AXCell` → `cell` | `ControlType.DataItem` → `row` | **fixed** — the UIA adapter reads the row ancestor |
| a `<th>` | `AXCell` → `cell` | `ControlType.HeaderItem` → `columnheader` | **open**, see K3 |

Both fixes needed an adapter to read an element's *parent*, which the flat role
maps in `@svatah/surface` cannot express, and neither would have been noticed by
either adapter's own tests. 75 tests.

## T6.3 — The WebMCP candidate

The Playwright adapter reads a page's `navigator.modelContext` declaration and
claims the `webmcp` capability. The capability says the *adapter* can read one,
not that the page in front of it declares anything — that is
`locate({ by: "webmcp" })`, asked per resolution, and it is the fall-through.

`locate` mints a `wN` reference that names a **tool, not an element**;
`describe` refuses it and `act` calls the tool. The API is a draft, so the reader
tries the spellings that exist and a page offering none declares nothing — the
right answer, because a tool the adapter cannot call is one it must not prefer.

**Recording puts the tool in front of the locators, in one binding.** That order
is the feature. The first implementation took a tool-only path for an ordinary
sentence, which resolved perfectly while the declaration was there and had
nothing to fall through to when it went — quietly removing the property LLD §6.3
is about. The tool-only path is now pattern 30 alone, where there is no control.

A tool is matched to an ordinary target **by name only** — `book-the-slot`
matches `book-the-slot` or `book-the-slot-button` — because synthesis is
model-free (REQ-REC-3), and every candidate is confirmed against the live
declaration before it is written. `record` calls no model for a declared tool:
the report says `declared` with a zero-token `webmcp:declaration` provenance.

`apps/sample-web/site-tools` declares two tools over a form that works without
them; `?webmcp=off` removes the declaration and changes nothing else.

**Evidence** (`packages/cli/test/webmcp.test.ts`, against the real page):

| | |
|---|---|
| the binding | `webmcp` first, then five locators including `testid` |
| replay with the declaration | `matched: { by: "webmcp", candidateIndex: 0, ref: "w0" }` |
| replay with `?webmcp=off`, same binding, nothing re-recorded | `matched: { by: "testid", candidateIndex: 1 }`, store unchanged |
| pattern 30, a tool with no control | one candidate, `outcome: "declared"`, no model call |

## T6.4 — The Java conformance runtime

`runtimes/java` executes `plan.json` and bindings on Playwright for Java and
Jackson and writes `results.jsonl` and `summary.json` in the published schemas.

```
$ node scripts/runtime-conformance.mjs
plan.json matches the fixture — sha256 95ec8910a81b8655f109e62dd5dcf4c9d3d788acaaeca2fc42af7185430839cf
conformance: 21 passed, 4 failed, 15 skipped
java: conformant — 40 step results, zero mismatches → reports/runtime-java.md
```

Reproducible; run twice. `reports/runtime-java.md` lists every step with its
status and matched candidate.

The matched candidate is what makes the suite worth running: two runtimes can
produce identical statuses by finding the same elements different ways, and that
is a difference that bites the first time a page changes.

Three things had to be right, and each was wrong first:

1. **The context pattern.** One character of disagreement picks a different
   binding entry and resolves a *different element* — the run still passes and
   only the matched candidate differs. `ResolverTest` pins the rule.
2. **Story inputs.** A runtime ignoring `--input` typed the empty string into the
   login form and then reported every step after it as a locator failure, which
   read as a runtime that could not find the sidebar rather than one that never
   logged in.
3. **The matched candidate on a failure.** A step that resolves and then fails to
   act has a `matched`; dropping it made every such step differ while the status
   agreed.

An action or predicate it does not implement **fails the step by name**. A
conformance runtime that quietly skipped what it could not do would report a
green suite and prove nothing.

**The committed conformance fixture was stale.** Regenerating it on `master`
alone changes `plan.sha256` and adds the `bindingsHash` and `inputs` fields the
current executor writes — so no comparison against it had been meaningful. It is
refreshed here.

## T6.6 — The prototype data import

`svatah migrate <dest> --from-ade <electron-db dir>` maps LLD §13.5's columns.
Results and screenshots are not imported, and the review report says which
tables were left behind.

Two steps, deliberately: the prototype is not a second dialect, it kept the same
v2 files *in a database*. Extracting them turns it back into what `migrate`
already converts; a second flow rewriter here would drift from the first.

The tables and columns are the prototype's own, read from `src/js/dbclient.js`
in `github.com/a-t-u-l/svatahADE` — the only place that says a locator row's
keys are `"locator identifier"` and `"locator details"`, with spaces.

**No prototype database was available.** `evals/migrate/ade-db` is synthesised by
`scripts/build-ade-fixture.mjs` and says so in three places; what is synthetic is
the *packaging*, and the flows and locators are the real legacy files.

**T6.6's Validate:** the import compiles clean, and its 14 story names and step
counts are compared against the **legacy originals** rather than a number written
down.

**A defect this exposed:** `seedBinding` wrote `fingerprint.tag: ""`, which the
schema requires to be non-empty — so **no migrated project had ever compiled**,
including the committed `evals/migrate/expected`. It is `"unknown"` now: honest
for a binding describing an element nobody has seen, and correct, because
relocalization scores tag equality and `unknown` matches nothing.

The ADE's Project screen gains "Import prototype database…" over a new
`POST /migrate`, which writes into the **open** project — the service confines
every write to the directory it was opened on, and an import that could write
anywhere would be the one route around that.

## T6.5 — The Tier 2 fine-tune pipeline

Export, train, serve, measure — `docs/finetune.md` is the loop.

```
$ node packages/cli/dist/bin.js eval finetune export
exported 83 pair(s) from master (bd184e0b90ec) → evals/compiler/finetune/pairs.jsonl
  every pair is a grammar (tier 1) compile, in the shape a Tier 2 answer has
  excluded: 60 in the golden set, 49 duplicate, 0 unparsed
  the golden set is the test set and is never trained on
```

Two rules carry it, and both are tests:

* **Merged only** (ADR-4). Flows are read through `git show <ref>:<path>`. A
  draft in someone's editor is not evidence that anyone accepted a step.
* **The golden set is the test set**, excluded and counted. Nothing about a
  contaminated training set looks wrong, so it is a test rather than a rule in a
  document.

Every pair is in the shape a Tier 2 *answer* has, and requiring that found three
defects with nothing to do with training:

| | |
|---|---|
| `asExample` left a predicate's `value` in the IR's shape | `g-098` was a few-shot example in **every Tier 2 prompt** demonstrating a shape the parser rejects |
| `modelStepSchema` had `promptText`, not `text`, for a dialog | A Tier 2 answer could never carry a prompt's reply; `g-079` could not be shown at all |
| It had no `withSessionCookies` | `Call the "x" API with the session cookies` would compile to a request that sent none |

All 176 Tier 1 golden entries now convert to something the model can answer with.

### The training run, not completed

**No improvement is reported, because none was measured.**

A stack is available and the run starts:

```
$ python3 -m venv .venv && .venv/bin/pip install mlx-lm
$ SVATAH_FINETUNE_PYTHON=.venv/bin/python node scripts/finetune-tier2.mjs
Loading pretrained model
Fetching 9 files: 100%|██████████| 9/9 [01:49<00:00, 12.12s/it]
Trainable parameters: 0.216% (6.652M/3085.939M)
Starting training..., iters: 249
```

It downloads `mlx-community/Qwen2.5-3B-Instruct-4bit`, loads it, and begins. Each
validation pass takes about 100 s on this machine, so 249 iterations is hours,
and it was stopped. To finish it, and then measure:

```bash
SVATAH_FINETUNE_PYTHON=.venv/bin/python node scripts/finetune-tier2.mjs
ollama create qwen2-5-3b-svatah -f evals/compiler/finetune/tuned/Modelfile
node scripts/finetune-eval.mjs --tuned qwen2-5-3b-svatah
```

`finetune-eval.mjs` refuses to write a report without a tuned model:

```
No tuned model to compare against.
Nothing was written. Printing the base model's number twice, or estimating the
improvement, would be reporting something that was not measured (ADR-4).
```

T6.5's Validate — five points on `tier: 2` with no Tier 1 regression — is
therefore **not demonstrated**.

---

## Deviations

### D1 — The desktop adapters drive `osascript` and PowerShell, not native bindings (LLD §7.5)

§7.5 says "`AXUIElement` via a small native module" for macOS and, for Windows,
"a Node binding over the UI Automation COM API **or a wrapped driver with the
same surface**". The Windows wording allows what was built; the macOS wording
does not, and this is the deviation.

Both platforms already ship a client of the same API — System Events on macOS,
`UIAutomationClient` in the .NET Framework on Windows — reachable through a
process. A native module means `node-gyp`, a compiler on every machine that
installs the package, and a prebuild matrix, and REQ-PKG-3 keeps the dependency
tree permissive rather than merely licensed.

The cost is stated rather than hidden: one IPC round trip per attribute, so a
large window is measured in seconds where a native module would be measured in
milliseconds. It is not measured here, because neither live gate ran. The bridge
is one interface (`AxBridge`, `UiaBridge`) and a native implementation drops in
behind it without anything above changing.

### D2 — `automationId` on macOS also reads the DOM `id` (LLD §7.5)

§7.5 says the macOS `automationId` comes "from `aria-label` or `AXIdentifier`".
The DOM `id` (`AXDOMIdentifier`) sits between them, because the conformance
target is an Electron application: `<select id="record-gateway">` has an `id` and
no `AXIdentifier`, and an `id` is an identity where a label is wording. Both of
§7.5's sources are still read, in its order relative to each other.

### D3 — `POST /migrate` is not in LLD §13.5's endpoint table

T6.6's Do requires "an 'Import prototype database' action in the ADE project
screen", and REQ-ADE-2 makes the service the only integration point, so the
action needs an endpoint. §13.5's table predates T6.6 and does not list one. It
imports into the **open** project only, so the service's rule that every write is
confined to the directory it was opened on still holds.

### D4 — The desktop conformance suite is a second case list, not more cases in the first

LLD §14 describes one surface suite. Every web case begins
`act("navigate", …, { url })`, which a desktop adapter refuses by design, so a
desktop adapter running the web suite would skip every case and report itself
conformant having done nothing. `DESKTOP_CASES` is a second list with the same
`ConformanceCase` shape, the same runner and the same report; `surface conform`
picks by the surface's own `kind`.

### D5 — The Java runtime implements the fixture's feature set, not the whole IR

REQ-STD-3 asks a foreign runtime to execute `plan.json` and pass the runtime
conformance suite; it does that. It does not implement guards, checkpoints,
resume, abort policies, custom steps, `invoke`, the audit log, screenshots or
healing — each is either a behaviour the fixture does not exercise or a module
(b) concern. Everything outside the set fails the step **by name**, so a plan
that needed one could not be mistaken for a passing run.

### D6 — `evals/migrate/ade-db` is synthesised

REQ-ADE-9's Validate says "a captured prototype database". None was available.
The shape is read from the prototype's own source and the content is the real
legacy files; `scripts/build-ade-fixture.mjs` regenerates it and the README says
so.

---

## Known gaps

### K1 — Neither desktop adapter has been run against a live tree

The whole of both adapters above the bridge is a pure function of a recorded
tree, and all of that is tested. What is untested is `osascriptBridge` and
`powershellBridge` themselves: the JXA and PowerShell scripts are checked for
what they send, not for what a real System Events or `UIAutomationClient`
answers. The scripts are the most likely place for a defect, and they are the
part no test here touches. The two commands that close it are above.

### K2 — The recorded trees are Chromium's, not the platforms'

`scripts/record-desktop-tree.mjs` reads Chromium's accessibility tree over CDP
and maps it into each platform's vocabulary. That is the tree the platform
bridges serialise *from*, so the roles, names and identifiers are real — but the
mapping is this repository's, not Chromium's, and a place where Chromium
publishes something different from what the recorder assumes would be invisible
to every test here and would appear on the first live run.

### K3 — A `<th>` normalises differently on the two platforms

`AXCell` → `cell` on macOS and `ControlType.HeaderItem` → `columnheader` on
Windows. macOS has no header role and no ancestor distinguishes it, so the trick
that closed the other two does not apply. It is not an interactive control, so
it changes nothing a flow can name; `parity.test.ts` lists it, so a second
disagreement fails the test.

### K4 — The AX adapter's screenshots are neither masked nor scoped

`screencapture` writes the whole screen. REQ-NFR-6's masking is honoured by the
executor not screenshotting a secret-injecting step at all, rather than by this
adapter painting over one — which it cannot, because the file is written by
another process. A desktop run's screenshots therefore capture whatever else is
on the display.

### K5 — WebMCP is read through a draft API, and the sample page provides it

No browser ships `navigator.modelContext`. The sample page defines it, which is
what a site would do today behind a feature detect — so what T6.3 exercises is
the adapter's *reading* of the shapes the proposal describes, not any browser's
implementation. If the final API differs, the reader is where it changes.

### K6 — The Tier 2 fine-tune has never been trained or measured

See T6.5. The export is done and verified, the scripts run as far as the
environment allows, and the training run was started and stopped. 83 pairs is
also a small training set; whether it is enough for five points is exactly the
question the unrun measurement would answer.

### K7 — `dialog` steps disagree about `accept` between the grammar and the adapter

Noticed while fixing the model schema, and **not fixed** because it is outside
Phase 6. The grammar emits `args.action: "accept" | "dismiss"`; the Playwright
adapter reads `args["accept"]` as a boolean and defaults to `true` when it is
absent — so `Dismiss the dialog` accepts it. `g-078` compiles correctly and the
adapter does the wrong thing with the result.

### K8 — The record review has still not been driven through the ADE's buttons

Phase 5's K6, unchanged. The desktop adapters were to be the way to close it, and
neither has been run live. The ADE's screens are still exercised through the
same client they drive.

### K9 — `pnpm -r typecheck` fails in `@svatah/workflow`, and did before this phase

`test/policy.test.ts` builds a `Config` from `DEFAULT_CONFIG`, which is
`Omit<Config, "project">`, so `project` is missing. It reproduces on `master`
with `master`'s own `config.ts`, so it predates this phase. `typecheck` is not in
the verification contract, which is why it went unnoticed; it is left as it was
found rather than fixed under a Phase 6 heading.

### K10 — The desktop CI legs have never run

`desktop-conformance` is wired for `windows-latest` and `macos-latest`, and the
repository's only remote is Bitbucket (Phase 0's K1), so no GitHub workflow in
this repository has ever run. The macOS leg is `continue-on-error` because a
hosted runner cannot grant the Accessibility permission; the Windows leg should
pass on a runner and has not been observed to.
