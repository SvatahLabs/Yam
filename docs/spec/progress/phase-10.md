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
