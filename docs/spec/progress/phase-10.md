# Phase 10 — builder surfaces, complete

Branch `phase-10` from `master` (`6c11c0c`, Draft 2.12) · Date: 2026-09-05
Subject: the seven corrections the Phase 9 adversarial verification required
(P9-F1..F7), then T10.1–T10.4.

Every claim below names the command that makes it and what that command
answered on this host. Where a command could not be run, the section says so,
gives the command a verifier should run instead, and says what *was* measured in
its place. Nothing here reports a number nobody took.

`git diff master..phase-10 -- docs/spec/{requirements,hld,lld,tasks}.md` is
empty. The only change under `docs/spec/design/` is four **added** artboards
(T10.2, below); nothing existing there is edited.

## The results, stated up front

- **All twelve screens of LLD §13.7 render in both renderers.** The packaged ADE
  drives every one of them through its own controls under Playwright — 34 cases,
  including one per screen asserting that *every* interactive control on it has
  an accessible name and an id — and `svatah ui` draws every one of them in a
  real pseudo-terminal against a real service, one case each.
- **The eleven legacy screens are gone.** `apps/ade/src/renderer/screens/` and
  `app.css` are deleted with the Legacy rail item; the desktop conformance cases
  and the nine recorded trees are re-taken against the new structure; the
  **id** half of §13.7's accessibility contract, which Phase 9 could not turn on
  because those screens had named controls with no ids, is on.
- **A run can be stopped from the screen that started it.**
  `POST /runs/:id/stop` cancels between steps, the summary says `stopped`, and
  `audit.jsonl` names the last step that ran. Driven end to end on the packaged
  application.
- **All seven Phase 9 corrections are made, each with the failure reproduced
  first.** The fixture check no longer depends on a directory it does not own;
  axe-core is fetched at test time and agrees with the in-house audit at zero;
  the state carries instants and the cockpit fits the terminal; the Run screen's
  toolbar, heading and audit line are fixed; `ax/session` exists and the gate
  names it.
- **What this host could not do is say whether the live macOS gate passes.** It
  got further than Phase 9's — a window in 4972 ms and the project screen in
  8179 ms — and then stopped producing windows at all. Recorded as K1, with
  everything tried.

## The host, and what it could and could not do

- macOS 15 (`darwin arm64`), Node v25.6.1 (the current LTS line's successor on
  this machine) and Node 22 for the second leg of the contract; JDK 17.
- The Accessibility permission is **granted** to the terminal running Svatah:
  `svatah surface doctor --adapter ax` answers `ok ax/accessibility granted`.
- The display was **unlocked** for this implementation, and
  `svatah surface doctor --adapter ax` answers
  `ok ax/session 9 application(s) own a window: …` — the check P9-F7 adds. What
  that check is *for* is the opposite case, and this is the first phase in which
  a reader can tell the two apart.
- Screen Recording is **not** granted, so `screencapture` refuses and the
  desktop gate's screenshots are empty. `doctor` reports it as `warn` and the
  accessibility tree is unaffected (T8.2's decision, unchanged).
- No model credential. Every recording in this phase uses `--gateway fake`.

## The verification contract

Everything below is runnable from a clean checkout with
`pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`,
with no credential.

| Command | Result on this host |
|---|---|
| `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r typecheck && pnpm lint`, no credential, Node v25.6.1 | all exit 0 |
| `pnpm -r test` | exit 0 — 3,424 vitest tests passed, 0 failed, plus the Playwright suites (34 in the packaged ADE, 13 and 9 in the adapter and host packages) |
| `git diff master..phase-10 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty |
| `git diff master..phase-10 --name-status -- docs/spec/design` | four added artboards, nothing else |
| `node scripts/record-screen-fixtures.mjs --check`, with three unrelated runs in `evals/fixtures/runs` | passes: 7 flows, 22 stories, 30 bindings, run `comp` exit 11 |
| `node scripts/audit-sheet.mjs --axe "$(node scripts/fetch-axe.mjs)"` | axe-core 4.10.3: 0 violations; the audit: 0 violations, 27 distinctly named landmarks |
| `node scripts/generate-clients.mjs --check` | 3 clients match: 37 routes, 16 event kinds |
| `pnpm --filter @svatah/ade package && pnpm --filter @svatah/ade exec playwright test` | 34 passed, three consecutive runs |
| `pnpm --filter @svatah/repo-checks exec vitest run test/tui-pty.test.ts` | 26 passed |
| `pnpm --filter @svatah/adapter-ax test` / `--filter @svatah/adapter-uia test` | 91 passed, 1 skipped / 91 passed |
| `node scripts/ade-smoke.mjs` | `smoke ok … packaged=yes runtime: /opt/homebrew/bin/node` |
| `node packages/cli/dist/bin.js surface doctor --adapter ax` | `ok ax/session — 9 application(s) own a window` |
| `node scripts/desktop-conformance.mjs --adapter ax` | exit 2; see T10.3 and K1 |
| `pnpm ade:shoot` | twelve screenshots; no AX screenshot (Screen Recording not granted) |
| `pnpm ui:capture` | four captures: 160×40 and 100×30, each screen |

**One flake, and what it was.** `packages/adapter-bidi/test/surface.test.ts ›
returns tag, attributes, text, neighbours, role path, box and index` failed once
with `TimeoutError: The BiDi command session.new did not answer in time`, on a
run made while the desktop gate and the screenshot script were driving Electron
on the same machine. It passes alone (`pnpm --filter @svatah/adapter-bidi test`:
52 passed) and it passes in a suite run with nothing else going. It is a
wall-clock race on a busy host — Firefox's remote agent not answering
`session.new` — and it is recorded rather than dismissed.

**Two defects the suite found in this phase's own work, and what they were.**
Both were in the ADE's Playwright cases and both turned out to be real:

1. **A finished run pulled you off the screen you had walked to.** The shell
   re-loads the Run screen when `run.summary` arrives, so a live run and a
   historical one are the same object — and it did that whatever screen was
   showing. Phase 9 had two screens and nowhere to walk to; with twelve it is
   the first thing a second click finds. Guarded by a ref on the showing screen.
2. **A one-second run is not a window anyone can press a button in.** The stop
   case ran `guards-and-compensation.flow`: on a fast machine the run ended
   before the Run screen rendered and Stop was never live, and on a loaded one
   the wait for it outlived the test. It runs `execution.flow`'s thirty-one
   steps now. Running *every* flow would be longer still and is not available —
   several of the project's stories declare inputs and `POST /run` refuses the
   whole run with a 400 before it starts (REQ-AUTO-5), which is the right
   answer.

And three in the tests only, each of which had cost a green run somewhere:
`goTo` waited on `getByRole("heading", …)`, which the Runs screen's inspector
satisfies with its own `<h3>Run 00mt…</h3>` while the workspace shows something
else; the filter case's "click back to `all`" loop was unbounded and raced the
re-render; and `stopLeftovers` sent a signal without waiting for the process to
go, so a launch could attach to an ADE that was on its way out — the same thing
the desktop gate learned in Phase 8 (P8-F1). All three are fixed and the
packaged spec runs three times in a row with no manual cleanup.

## The Phase 9 corrections (P9-F1..F7, together T10.4's first half)

### P9-F1 — the screen fixtures are recorded on a copy of the project

**The defect.** `scripts/record-screen-fixtures.mjs` ran `comp` inside
`evals/fixtures` and recorded `GET /runs`, which answers with *every* run in
that directory. The suite leaves runs there, `scripts/smoke-clients.mjs` leaves
one, and so does anyone who runs a flow — so `--check` failed twice during the
Phase 9 verification without anyone having edited anything.

**Reproduced first**, as the phase asked:

```console
$ mkdir -p evals/fixtures/runs/unrelated-{a,b,c}   # three summaries
$ git show master:scripts/record-screen-fixtures.mjs > scripts/.old.mjs
$ node scripts/.old.mjs --check
The committed screen fixtures differ from what the service answers now.
Run `node scripts/record-screen-fixtures.mjs` and read the diff.
```

**The fix** (Draft 2.12 §13.7). The recording is taken against a copy of the
project in a temporary directory — without `runs/`, `node_modules/` or
`.svatah/` — and the temporary path is normalised back to
`<repo>/evals/fixtures` so the committed fixture still says what it is about.
`realpathSync` on the copy, because macOS's `mkdtemp` answers `/var/folders/…`
and everything that resolves it answers `/private/var/folders/…`; a fixture
normalised against one spelling would keep the other, which is an absolute path
from this machine in a committed file.

**Validate — "the fixture check passes with three unrelated runs in
`evals/fixtures/runs`":**

```console
$ node scripts/record-screen-fixtures.mjs --check       # with the three runs present
…/fixtures-project.json matches the service: 7 flow(s), 22 stories, 30 bindings, run comp exit 11
$ pnpm --filter @svatah/repo-checks exec vitest run test/screen-fixtures.test.ts
✓ test/screen-fixtures.test.ts (3 tests) 2734ms
```

`tools/repo-checks/test/screen-fixtures.test.ts` writes the three runs itself,
asserts the check passes, asserts it read the *committed* project (7 flows, 22
stories, `comp` exit 11 — so a recorder that had stopped looking at
`evals/fixtures` would not pass by accident), and asserts the directory is as it
was found, with no `comp` written into it.

### P9-F2 — the generated Python client's byte-code cache is untracked

`clients/python/svatah_sdk/__pycache__/*.pyc` were tracked and rewritten on
every smoke run, so a check that had done nothing wrong left a dirty tree.
`__pycache__/` and `*.pyc` are ignored; the two files are untracked.

**Validate:**

```console
$ git ls-files | grep -E '__pycache__|\.pyc$'      # nothing
$ pnpm --filter @svatah/repo-checks exec vitest run test/client-drift.test.ts
✓ test/client-drift.test.ts (10 tests)
```

The two new cases in `client-drift.test.ts` assert that `git ls-files` names
neither and that `git check-ignore` claims them — so the next smoke run cannot
add them back unnoticed.

### P9-F3 — the sheet's landmarks are distinct, and axe-core runs beside the audit

**Reproduced first.** axe-core 4.10.3, fetched for the reproduction:

```console
$ node scripts/audit-sheet.mjs --axe /tmp/axe.min.js
axe-core 4.10.3: 1 violation(s)
  axe:landmark-unique  Landmarks should have a unique role or role/label/title … (11 node(s))
```

The eleven are the component sheet's eleven `InspectorSection`s, each drawn
twice — once per theme — with the same role (`region`) and the same accessible
name. Two landmarks with one name are two destinations landmark navigation
cannot tell apart.

**Three changes**, which are Draft 2.12 §13.7's sentence:

1. The sheet's section headings say which half they belong to
   (`Buttons — Dark`, `Buttons — Light`), so every landmark's *visible* label is
   its unique accessible name — LLD §13.7's rule kept, not worked around.
2. `scripts/audit-sheet.mjs` implements `a11y-landmark-unique`, computing each
   landmark's role and accessible name the way axe does, skipping an unnamed
   `<section>` or `<form>` (which is not a landmark at all), and reporting the
   count of distinctly named landmarks it checked.
3. `scripts/fetch-axe.mjs` downloads one **pinned** axe-core (4.10.3, checked by
   SHA-256 `880970c0…`) into the system temporary directory at test time —
   never into the repository and never into `node_modules`, because axe-core is
   MPL-2.0 and REQ-PKG-3 admits MIT, Apache-2.0 and BSD. Both CI files run
   `node scripts/audit-sheet.mjs --axe "$(node scripts/fetch-axe.mjs)"`.

**Validate — "the audit and a real axe run agreeing", zero violations:**

```console
$ node scripts/audit-sheet.mjs --axe "$(node scripts/fetch-axe.mjs)"
axe-core 4.10.3: 0 violation(s)
…/sheet/index.html: 0 violations — 28 interactive elements named and id'd, 89 unique ids,
20 status pills each with a word, 27 distinctly named landmarks, 30 contrast pairs across both themes.
$ pnpm --filter @svatah/repo-checks exec vitest run test/sheet-audit.test.ts
✓ 18 passed
```

The last case is the one the correction is really about: on a page that breaks
`landmark-unique` and nothing else, it asserts that **both** sides report it. A
rule axe reports and the audit does not now fails a test rather than waiting for
a verifier.

### P9-F4 — the state carries instants, and the cockpit fits the terminal

**The Flows state carried `"run 20 s ago"` as text.** Two loads of a project
nothing had happened to were therefore different values, which made
`svatah ui --json` unequal to a second evaluation of the same screen and flaked
`tui-pty.test.ts › prints the Flows screen the same way` on Node 22.

`FlowRow` carries `lastRunAt`, an ISO instant from the summary; `ago()` moved to
`@svatah/screens`'s `format.ts` and is called by *both* renderers, so they still
print the same words.

**The cockpit clipped its inspector.** The three columns were 34, "grow" and 40
— 74 columns of furniture before a character of content — so on anything under
about 130 columns the inspector ran off the right edge, which is what the Phase 9
capture shows. `packages/tui/src/layout.ts` computes the widths and the row
budgets from the terminal; below 120 columns the inspector is **collapsed**
(three whole panes, the reason in the header, and pane `3` opens it full width
under the main pane); the header prints `100×30`, so a capture records its size.

`scripts/capture-tui.mjs` and the pseudo-terminal test set the pty's size with
`stty` — a `script(1)` with no controlling terminal allocates a `0×0` pty, which
is how the Phase 9 capture came to be taken at a width nobody chose.

**Validate:**

```console
$ pnpm --filter @svatah/repo-checks exec vitest run test/tui-pty.test.ts
✓ test/tui-pty.test.ts (14 tests) 35502ms
   ✓ at 100 columns: three whole panes, no clipped fourth, and the size (T10.4)
   ✓ at 160 columns: four panes, and that size
   ✓ prints the same Flows state ten times running (T10.4, P9-F4)
   ✓ carries the last run as a timestamp, not as words (P9-F4)
$ pnpm ui:capture
wrote reports/ui-flows.txt at 160×40 (37 lines)
wrote reports/ui-run.txt at 160×40 (28 lines)
wrote reports/ui-flows-100.txt at 100×30 (27 lines)
wrote reports/ui-run-100.txt at 100×30 (23 lines)
```

`reports/ui-run-100.txt` opens with

```
svatah ui 100×30 · inspector collapsed at 100 cols (120 to sit beside); 3 opens it  …
```

and holds three whole boxes, none wider than 100 characters. The ten-round
`--json` comparison compares each round with round one *and* with the model
loaded in the test's own process at that instant, which is the comparison that
actually flaked.

### P9-F5 — the three Run screen defects

**The toolbar wrapped its buttons.** `.sv-btn` is `flex: none; white-space:
nowrap`; the toolbar is `flex-wrap: nowrap` with `overflow: hidden`; the title
and subtitle are the flex items that shrink, with `min-width: 0` — without
which `text-overflow: ellipsis` does nothing inside a flex item.

**The "Candidates tried" heading rendered twice.** A `<table>`'s `<caption>` is
its accessible name and is visible (LLD §13.7), so a caption repeating the
section heading above it puts the same words on screen twice. The Run
inspector's table is captioned `Resolver order`, as the Flows inspector's
already was.

**The audit pane showed a kind and an outcome and little else.** Every surface
line read `surface | locate · ok` — the same word in the kind column twenty
times, and no way to tell which of the failing step's five candidates a line was
about, because `surface.locate(candidate)` is never told which element the
candidate belongs to.

So the executor lends the auditor the one fact it has:
`StepContext.resolving` names the element around every resolution,
`resolveTarget` in `step.ts` is the single place resolutions go through, and the
audit proxy records the element as the call's `ref`, the candidate reduced to
what identifies it, and how many elements it matched. The Run screen's `kind`
column is the call's method now, and a line reads

```
locate | checkout.pay-button · testid "pay" · matched nothing · ok · 1 ms
```

which is the `Run` artboard's own line.

**Validate**, on the packaged ADE:

```console
$ pnpm --filter @svatah/ade package && pnpm --filter @svatah/ade exec playwright test
11 passed (8.0s)
   ✓ the Run toolbar keeps its buttons on one line, however long the title
   ✓ the inspector says each of its headings once
   ✓ the audit pane renders the call detail the model carries
$ pnpm --filter @svatah/screens test          # 32 passed
```

The toolbar is crowded with a `<style>` appended to `<head>` rather than by
rewriting the title's text: React owns those text nodes and assigning to
`textContent` under it takes the renderer down on the next reconcile, which is a
test that breaks the application to look at it. It is measured twice — at the
window's own width, where every button is inside the bar, and at 420 px, where
the bar is still one 40 px row of one-line unshrinkable buttons and the title is
the thing that gives.

### P9-F7 — `ax/session`, and the gate names a locked display

`AxBridge.session()` asks `NSWorkspace.runningApplications` for each regular or
accessory application's `AXWindows` in one `osascript` invocation — the same
shape and for the same reason as the window read. It never throws: a check that
exists to explain an exit code and answered with an exception would replace one
unexplained failure with another, so a refusal reads "could not tell".

`doctor` reports it as **advisory**: nothing is misconfigured on a locked
display, so the exit code is unchanged (LLD §15's severities). What it changes is
what the desktop gate can do, and `scripts/desktop-conformance.mjs` asks again at
the moment of a launch failure — a display can lock while a gate is running,
which is exactly how it happened to both the Phase 9 implementer and its
verifier.

**Validate — live on this host:**

```console
$ node packages/cli/dist/bin.js surface doctor --adapter ax
ok    -/platform             darwin arm64, Node v25.6.1
ok    ade/node-runtime       runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)
ok    ax/accessibility       granted
ok    ax/session             9 application(s) own a window: Notification Center, Notes, Finder, …
warn  ax/screen-recording    refused — could not create image from rect
$ pnpm --filter @svatah/adapter-ax test            # 91 passed, 1 skipped
$ pnpm --filter @svatah/repo-checks exec vitest run test/desktop-gate.test.ts   # 19 passed
```

The locked-display *answer* is exercised through the bridge's fake `run`
(`only loginwindow owns a window — the display is locked`), because this host's
display is unlocked and a check that could only be seen on a locked one would be
a check nobody ever ran.

### P9-F6 — the Phase 9 progress file carries the verification's results

`docs/spec/progress/phase-9.md` gains a **Post-verification corrections**
section: see that file.

## T10.2's designs, before they are built

The four secondary screens were **wireframes** in `docs/spec/design/artboards/Secondary.html`.
T10.2 says "the Secondary wireframes become full designs first, added to
`docs/spec/design/` for the owner's review before they are built". Four full
artboards are added, in the same system, with the fixtures project's own data:

| Added | Screen | Endpoints it renders |
|---|---|---|
| `docs/spec/design/artboards/Api.html` | API | `GET/PUT /api/:name`, `POST /api/request` |
| `docs/spec/design/artboards/Data.html` | Data | `GET/PUT /data` |
| `docs/spec/design/artboards/Explorer.html` | Surface explorer | `POST /surface/:session/*`, `trajectory.jsonl` |
| `docs/spec/design/artboards/Import.html` | Import prototype database | `POST /migrate` |

Nothing else under `docs/spec/design/` is touched: not `base.css`, not
`README.md`, not `canvas.json`, not an existing artboard. **The owner reviews
these four at verification**; they are built to as they stand.

## T10.1 — the authoring loop screens

**Do:** `record`, `runs`, `heal`, `bindings` on the model in both renderers, to
the mockups.

### The model

`packages/screens/src/screens/rest.ts` — ten screens sketched thinly enough for
T9.1's "every screen loads against the fake service" — became
`screens/authoring.ts` (these four) and `screens/secondary.ts` (T10.2's six).
Each now carries what its artboard shows:

| Screen | What it loads | What its inspector is about |
|---|---|---|
| `runs` | `GET /runs`, then `GET /runs/:id/results` for the selected one | the failing step, its class, its screenshot, the plan and bindings hashes |
| `bindings` | `GET /bindings` and every `GET /bindings/:id` | the resolver order, REQ-REC-4's fingerprint, the provenance |
| `record` | `GET /project` for the gateway; the rest from the stream | the snapshot excerpt with the line the model chose, the candidates, the fingerprint, the deadline |
| `heal` | `GET /runs` for the runs worth healing; proposals from the stream | before, after, scores, confidence, whether it re-ran green |

The three filters on `runs` are applied to the *summaries*, before anything is
read per run: a screen that filtered rows it had already paid to build would read
thirty results files to show three.

`record` and `heal` have no `GET` — they are about a session, and inventing one
would put state in the service the CLI cannot produce (§13.5's rule read from the
other side). They load their static half and fold `record.decision`,
`record.candidates`, `record.decided`, `record.failed` and `heal.proposal`
through `applyRecordEvent` and `applyHealEvent`. Both renderers subscribe;
neither decides what an event means.

### Validate — "each screen driven end to end through its own controls in the ADE under Playwright"

```console
$ pnpm --filter @svatah/ade package && pnpm --filter @svatah/ade exec playwright test
34 passed (16.2s)
```

Twelve of those cases open a screen and assert that **every interactive control
on it has an accessible name and an id**; the rest drive each screen through its
own controls: the Runs screen's three filter chips cycled and its inspector
filled by choosing a row, the Bindings table's resolver order and fingerprint,
the Heal review's candidate list and its "nothing is written until you apply"
sentence, the Record review's gateway chooser and its fake-gateway label, the API
screen's headers, the Data screen showing `SVATAH_SAMPLE_PASSWORD` and never a
value, the explorer refusing a call with no intent, the Import screen's
confinement, the Settings screen's project.

### Validate — "and in `svatah ui` under a pseudo-terminal"

```console
$ pnpm --filter @svatah/repo-checks exec vitest run test/tui-pty.test.ts
✓ test/tui-pty.test.ts (26 tests)
   ✓ draws the flows screen in a real terminal (T10.1, T10.2)      … and eleven more
$ pnpm --filter @svatah/tui test
Tests  50 passed (50)
```

One pseudo-terminal case per screen, against a real service on the fixtures
project: its own title, its four numbered panes, the footer's keys. And in
`cockpit.test.tsx`, against the recorded fixtures: every pane titled, every empty
pane saying what would fill it, **no status colour drawn without its word**, and
nothing drawn past the right edge at either width.

`packages/tui/src/rows.ts` is what made twelve screens possible in one renderer:
which of the model's rows go in which pane, as data — a title, lines of cells, a
footer, and what `Enter` on a row re-loads with. `panes.tsx` draws one shape and
knows nothing about which screen it is showing.

### Validate — "the palette lists every action of the four screens"

`tools/repo-checks/test/action-parity.test.ts` and `palette-parity.test.ts` pass
against a registry that now has 38 actions — 26 in the `Actions` group and one
`Go to` per screen. Three of the four own actions;
`runs` owns none, and that is right rather than missing — its two keys are
`go.run`, which the palette's second group carries, and `heal.run`, which belongs
to the Run screen (Draft 2.12's D6). An action invented so a screen would have
one would be a palette row nothing answers.

## T10.2 — Agents and tools, API, Data, Explorer, Import, Settings

**Do:** the remaining screens on the model in both renderers; the Secondary
wireframes become full designs first.

The four artboards are added and recorded above; the screens are built to them.
`shell/Secondary.tsx` holds the six because they are one *kind* of screen — a
list or a table, an editor, an inspector — and six files with the same three
shapes in them would be five chances for them to drift.

### Validate — "the explorer requires an intent per call"

The model refuses it: `explorer.snapshot` and `explorer.act` answer
`{ ok: false, message: "Say what you are looking for: every surface call records
an intent." }` when the intent is empty, and the screen draws the alert while it
is. The Playwright case fills the field and watches the alert go.

### Validate — "the import writes only into the open project"

Unchanged and re-stated on the screen: `POST /migrate` writes under the directory
the service was opened on and refuses anything else (T6.6), the inspector says
so, and it prints the equivalent `svatah migrate` command beside it. The
Playwright case asserts both sentences.

### A service change this needed

`GET /data` gains `secretSources`: per secret, the **name** of the environment
variable it is read from and whether this service can read it. The value is
redacted before it leaves, so a screen that inferred the name from `«redacted»`
was guessing — and did: the Data screen showed `reads ${?}` against a real
service. The name is what `data.yaml` says on its face; `set` is a boolean the
service computed, exactly as `GET /project`'s `gateway.credential` is
(REQ-NFR-6).

## T10.3 — retire the old screens, re-validate the target

**Do:** delete the legacy screens and `app.css`; update the desktop conformance
cases to the new structure and the recorded trees; rebuild installers.

### The deletion

`apps/ade/src/renderer/screens/` (eleven files) and `app.css` are gone, and with
them the Legacy rail item and the eleven tabs. `shell/Welcome.tsx` is the one
thing the ADE draws that is not a screen — a rail over a window with no project
would be eight rows that all say "open a project first" — and the Project
screen's other job is the Settings screen's now.

`apps/ade/test/screen-rule.test.ts` asserts the deletion and, more usefully, the
stronger rule the new structure allows: no screen reaches the network at all, no
screen holds a client, every screen's props are a state type from the model,
every screen id has a body and an inspector in the shell, and every endpoint LLD
§13.6's table names is reached — by the model, which covers both renderers at
once.

### The conformance cases

Rewritten to the rail, the palette and the inspector:

- `ade.project` — all eight rail rows addressable by id, each named as §13.7's
  rail names it, and no legacy tab anywhere;
- `ade.flow` — the flow list, the editor/plan/history tabs, the file's own lines;
- `ade.run` — Record and Run on the Flows toolbar (Draft 2.12 §13.7), and the Run
  screen reached through the palette;
- `ade.result` — the runs table and its three filter chips;
- `ade.api-client` — the request list, the headers, Send;
- `ade.inspector` — **new**: the right inspector is a stack of landmarks, which is
  what keeps `controlPath` short (§13.6);
- `ade.snapshot` — and the **id** half of §13.7's accessibility contract, which
  Phase 9 left out with a reason (the legacy screens had named controls with no
  ids) and T10.3 turns on.

Navigation is by `automationId` throughout, never by name: variant 1 renames a
rail item, and a case that navigated by a label would fail at variant 1 for the
reason the variant exists.

The healing cases follow: variant 1 is `rail-flows` renamed (it was a screen tab
and the Project screen's button, both gone), variant 2 is `record-gateway` moved
out of the toolbar into the workspace.

### The recorded trees

Nine screens and two variants, re-recorded from the new application in matched
AX/UIA pairs. `scripts/record-desktop-tree.mjs` navigates by rail id and palette
id, and three things about it were wrong before:

1. it set `SVATAH_ADE_RECORD_PROJECT`, which nothing reads — **every tree until
   now was of an ADE with no project open**. Invisible while the Project screen
   drew its "Open a project…" button either way; not invisible with a rail;
2. it slept two seconds after navigating, which produced trees of the chrome with
   an empty middle. It waits for the workspace *and the inspector* to fill now;
3. it found a palette row by text, and `Go to Run` is a substring of
   `Go to Runs` — so two screens were recorded under one name.

### Four defects the parity check found

Each is a real one, and each is what that check exists for:

| Defect | Effect |
|---|---|
| `GET /bindings/:id` answers `text/yaml` and was described as `application/json` | all three generated clients ran `JSON.parse` over a YAML file and threw on every call — the Bindings inspector was **empty against a real service and full against the recorded fixtures** |
| `AXApplicationAlert` and `AXApplicationStatus` had no entry in the AX subrole map | a `role="alert"` was `group` on macOS and `alert` on Windows |
| a `role="option"` inside a listbox | `menuitem` on macOS, `option` on Windows — every row of the command palette |
| a `<select>` option's label text run | `option` on macOS (the adapter promotes it), `text` on Windows |

Both client generators treat any `text/*` response as text now; the two role
rules are mirrored in both adapters, each narrowed to the case it is about — a
first attempt that promoted every text run inside any list made every line of the
Settings screen's diagnostics an unnamed `option`, which the new id check caught
immediately.

```console
$ pnpm --filter @svatah/adapter-ax test    # 91 passed, 1 skipped
$ pnpm --filter @svatah/adapter-uia test   # 91 passed
```

The parity suite's only remaining difference is the documented one:
`cell → columnheader`.

### Validate — the ADE smoke on the packaged application

```console
$ node scripts/ade-smoke.mjs
svatah-ade smoke target=packaged (…/apps/ade/out/Svatah ADE-darwin-arm64/Svatah ADE.app/…)
svatah-ade smoke ok project=…/evals/fixtures flows=7 stories=22 window=open packaged=yes
runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)
```

The three-OS matrix definition is unchanged and still asserted by
`tools/repo-checks/test/ci.test.ts`.

### Validate — the live macOS gate: attempted, and further than Phase 9 got

**The display is unlocked and the session is usable**, which is the first thing
`ax/session` is for and the first phase in which it can be said:

```console
$ node packages/cli/dist/bin.js surface doctor --adapter ax
ok    ax/accessibility       granted
ok    ax/session             9 application(s) own a window: Notification Center, Notes, Finder, …
warn  ax/screen-recording    refused — could not create image from rect
```

**The first attempt launched the ADE and opened the project**, which Phase 9's
never did:

```console
$ node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
variant 0: the ADE's window appeared after 4972 ms
variant 0: the project screen was open after 8179 ms (…/evals/fixtures)
the previous launch was gone after 17033 ms
the previous launch was gone after 15504 ms
The ADE was launched at variant 1 but showed no window within 60000 ms.
```

That is worth stating precisely, because it is evidence about *this phase's own
work*: the rebuilt ADE launches through LaunchServices, attaches to the
WindowServer, opens the fixtures project without a dialog, and the gate's new
`hasProject()` probe — which looks for `rail-flows`, T10.3's replacement for the
deleted `screen-project` tab — saw it. Phase 9 and its verification both stopped
at "no window within 60 s".

**Every later launch produced a windowless process.** The application starts, its
renderer runs — Playwright drives it over CDP in the same minute, 34 cases green
— and `AXWindows` for it is empty while System Events reports the process
visible. Tried with `open -n -F`, with a plain `open -a`, after killing every
leftover and every `svatah serve`, and after a twenty-second pause: zero windows
every time, on a session that `ax/session` calls usable. The preferences file
holds nothing unusual (1280×860, no position).

Nothing was written to `reports/adapter-ax.md`: a report from a run that could
not start would be a result nobody took. The command a verifier should run, on a
host that gives a launched application a window, three times and once beside
`pnpm -r test`:

```console
$ node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

It is K1 under Known gaps.

### The screenshots

```console
$ pnpm ade:shoot
wrote reports/ade-flows.png … reports/ade-settings.png     # twelve, one per screen
$ pnpm ui:capture
wrote reports/ui-flows.txt at 160×40 … reports/ui-run-100.txt at 100×30
```

## T10.4 — the corrections, and the run-stop route

P9-F1..F7 are the first half and are recorded above. This is the second.

**`POST /runs/:id/stop` cancels a run between steps** (Draft 2.12 §13.5). Phase 9
had no Stop button because the service published no such route, and a screen may
only ask for one that exists (its K3 and D9).

*Between steps, never during one.* A step that has clicked has already changed
the application, and a runtime that tore the session down mid-action would leave
a state no result describes. `runStory` asks before it starts the next step; the
rest are recorded `skipped`, exactly as a policy's are. What says a **person**
did it is a `stop` audit line naming the last step that ran, and
`summary.stopped`.

`stopped` is a field on the summary rather than a sixth `FLOW_STATUSES` member:
stopping is a fact about the run, not about how a flow ended, and a foreign
runtime that does not implement it simply never writes it (REQ-STD-3). A run
asked to stop *after* its last step is not marked — that would be a summary about
the button. A flow the stop arrives before never opens a session, which is the
one thing a stop is unambiguously supposed to prevent.

### Validate — "a run started from the Run screen is stopped from it and its summary says `stopped`"

```console
$ pnpm --filter @svatah/ade exec playwright test
✓ a run started from the Run screen can be stopped from it (T10.4)
$ pnpm --filter @svatah/service test    # 51 passed
$ pnpm --filter @svatah/runtime test    # 57 passed
```

On the packaged application: Run on the Flows screen, then Stop on the Run
screen's own button the moment it is enabled — `run.stop`'s `availableWhen` is
the model's `live`, so an enabled Stop *is* the screen saying there is something
to stop. The status bar reads "Stopping run …", the toolbar's pill reads
**stopped**, the Stop button disables itself, and steps are skipped.

The service's own behaviour is checked against a fake executor that waits to be
aborted: the signal it is handed is the one the route aborts, and a run that has
finished is a 404 (`not-running`) rather than a success that did nothing. The
executor's four properties are checked against the stub surface: the step under
way finishes, the rest are skipped, one `stop` audit line names the last step
that ran, and a flow the stop arrives before never opens a session.

### The rest of T10.4's Validate

| Item | Where |
|---|---|
| the fixture check passes with three unrelated runs | P9-F1 above; `tools/repo-checks/test/screen-fixtures.test.ts` |
| the `--json` equality test runs ten times without a diff | P9-F4 above; `tui-pty.test.ts › prints the same Flows state ten times running` |
| a 100-column capture shows three panes and says its size | P9-F4 above; `reports/ui-run-100.txt`, and `tui-pty.test.ts › at 100 columns` |
| the audit and a real axe run agree on the sheet with zero violations | P9-F3 above; `sheet-audit.test.ts` fetches axe-core at test time |
| a run stopped from the Run screen, summary `stopped` | this section |
| `doctor` names the locked display when only `loginwindow` owns a window | P9-F7 above; the four `session()` answers in `packages/adapter-ax/test/bridge.test.ts` |

## Deviations

Where a mockup and the LLD disagreed, the LLD won and the disagreement is here,
with its section and its artboard.

**D1 — the audit line's candidate is written the artboard's way, not the
prompt's.** The phase's brief gives `locate · booking.book-now-button · testid #0
· ok` as the line to render; the `Run` artboard writes
`checkout.pay-button · testid "pay" · matched nothing 1 ms`. The candidate's
*index* is not known at the surface call — `surface.locate(candidate)` is handed
one candidate and not a list — so the artboard's form is what ships, plus the
match count, which carries the same information and is what the artboard shows.
LLD §13.7, the `Run` artboard.

**D2 — the Runs screen owns no action.** T10.1 asks for "the palette lists every
action of the four screens"; `runs` has none. Its two keys are navigation
(`go.run`, which the palette's `Go to` group carries) and `heal.run`, which
Draft 2.12's D6 puts on the Run screen. An action invented so the screen would
have one would be a palette row nothing answers. LLD §13.7.

**D3 — the six secondary screens are one file.** `shell/Secondary.tsx`, because
they are one kind of screen and six files with the same three shapes in them
would be five chances to drift. Every screen *id* still has its own body and
inspector in the shell, which is what `screen-rule.test.ts` checks. LLD §13.7.

**D4 — `ade-project.json` records the Settings screen.** The fixture names are
read by the adapter tests and renaming them would be renaming files for no
reason; the ADE has no Project screen any more, and "what this project is" is the
Settings screen's. LLD §13.7, §16.

**D5 — the cockpit's inspector, when collapsed, scrolls rather than growing.** At
a hundred columns it opens under the main pane with the audit pane's row budget,
because the terminal has no more rows to give it; `j`/`k` walk it. Draft 2.12
§13.7 asks that it not be clipped, and it is not. LLD §13.7.

**D6 — a fake-gateway session is labelled with a note, not an `Alert`.**
REQ-ADE-4 and Draft 2.7 ask the screen to label it; `Alert` is `role="alert"`,
and a screen reader announcing "this session uses the fake gateway" on every
render is noise. It is a card with a pill. LLD §13.6, the `RecordReview`
artboard.

**D7 — the crumb separators are hidden from the accessibility tree.** Two sibling
nodes both named `/` gave two elements the same `controlPath`, which the resolver
drops as ambiguous — so a binding on either was unresolvable. They are decoration
and are `aria-hidden` now. LLD §3.3, §7.5.

## Known gaps

**K1 — the live macOS AX gate did not complete on this host.** Not for Phase 9's
reason: the display is unlocked and `ax/session` says nine applications own a
window. The gate's first attempt got the ADE's window in 4972 ms and its project
screen in 8179 ms at variant 0 — further than Phase 9 or its verification ever
reached — and every launch after that produced a process with no `AXWindows` at
all, while Playwright drove the same build over CDP in the same minute. The
transcript and everything tried are in the T10.3 section above. The command that
closes it, on a host that gives a launched application a window:
`node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md`,
three times, once beside `pnpm -r test`. Screen Recording is a second, separate
grant this terminal also lacks, so that host needs both.

**K2 — no AX screenshot.** Same grant. `pnpm ade:shoot` takes the twelve renderer
screenshots and says why the thirteenth is missing rather than fabricating one.

**K3 — Node 22 has not been run here.** This host has one Node (v25.6.1). The
contract's second leg is a verifier's: `pnpm -r typecheck && pnpm -r test` with
`CI=true` on Node 22.

**K4 — the Windows UIA gate is unrun.** Inherited; Phase 11's T11.6. The UIA
adapter's recorded trees and its parity with the AX adapter are re-checked here
against the rebuilt ADE, which is what this phase could do without a Windows
host.

**K5 — the compiler golden set is 222 against REQ-COMP-9's 300.** Inherited,
untouched by this phase, Phase 11's T11.2.

**K6 — the flow editor is still a view.** `PUT /flows/:file` and `flows.save` are
in the model and the ADE renders the file rather than editing it. T10.1's Do
names the four authoring screens and not the editor, and a half-built editor that
silently dropped a keystroke would be worse than a view that says it is a view.
Phase 11.

**K7 — the API screen sends the saved request and does not edit it.** The
artboard draws the URL as text and the method as a pill; `POST /api/request`
takes an ad-hoc request and the model's `api.send` passes one. Editing a request
in place needs `PUT /api/:name` wired to a form, which is Phase 11's.

---

## Post-verification corrections (Phase 11, T11.1)

The Phase 10 verification (`phase-10-verification.md`) accepted this phase at
8.3 / 10 with nine findings. They are fixed on `phase-11`; what follows is where
each one went, so a reader of *this* file is not left with a list of open
defects that are closed elsewhere. The evidence is in
`docs/spec/progress/phase-11.md`.

| Finding | Where it went | Commit |
|---|---|---|
| **F1** the packaged ADE runs without a window | The window was made every time. The display was locked, and macOS hides every application's windows from an accessibility client in that state — TextEdit and Notes included. `ax/session` reads `CGSSessionScreenIsLocked` now, the ADE logs its window lifecycle under `SVATAH_ADE_DEBUG=1`, and the gate stops it through a graceful quit route. | `P10-F1` |
| **F2** three live failures | Window chrome is exempt from the id rule; the palette no longer changes the accessibility tree's shape when it is first opened, which is what stopped `rail-flows` relocalizing; every list screen already opened on its first row and now says so in a test. The live gate is conformant. | `P10-F2` |
| **F3** the Record toolbar | The title keeps twelve characters, the bar sheds secondary actions into the palette before it gives way, a field in a toolbar is one row, and `availableWhen` is rendered — everywhere, because Flows and Run use the shared toolbar now instead of their own. | `P10-F3` |
| **F4** the artboards | The Explorer toolbar does not wrap and the Data inspector says `set` alone with a "Read by" list that fits. `pnpm artboards` renders every artboard and measures it, and found three more of the same overflow on artboards approved earlier. | `P10-F4` |
| **F5** a slow probe misattributed | `ax/session` answers a *state* — `usable`, `locked`, `no-session`, `unknown` — and the gate may name a cause for the middle two only. | `P10-F1` |
| **F6** `ade:shoot` rewrites the tree | It writes to a temporary directory and says where; `--update` refreshes the committed set. | `P10-F6` |
| **F7** the suite owns the machine's ADE | `node scripts/package-ade.mjs --test` builds `Svatah ADE Test` into `apps/ade/out-test` with its own bundle id. The suite passes with a product-build ADE open throughout. | `P10-F6, P10-F7` |
| **F8** spec drift absorbed | Nothing to do: Draft 2.13 recorded it and Draft 2.14 is on `master`. |  |
| **F9** the cockpit draws past the right edge | The width budget covers every cell, `test/layout.test.ts` states the invariant over ten thousand generated lines, and the flaky screen test polls. | `P10-F9` |

And the two known gaps a release could not ship with:

**K6 — the flow editor edits now.** Read is the annotated view; Edit is a text
area holding exactly what `GET /flows/:file` answered; Save writes it through
`PUT /flows/:file` and the screen re-loads, which re-lints. In `svatah ui`, `e`
opens the file in `$EDITOR` and saves what comes back through the same action.

**K7 — the API screen edits a saved request.** Method, URL, headers and body are
a form; `api.save` writes `api/<name>.yaml` through `PUT /api/:name`, which is
the file an `api` step reads.

The other five known gaps stand as written, and `docs/spec/progress/phase-11.md`
says which of them Phase 11 closed.
