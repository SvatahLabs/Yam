# Phase 9 — builder surfaces, foundation

Branch `phase-9` from `master` (`2ca8a69`, Draft 2.11) · Date: 2026-09-05
Subject: the four corrections the Phase 8 adversarial verification required
(P8-F1..F4), then T9.1–T9.5.

Every claim below names the command that makes it and what that command
answered on this host. Where a command could not be run, the section says so,
gives the command a verifier should run instead, and says what *was* measured in
its place. Nothing here reports a number nobody took.

`git diff master..phase-9 -- docs/spec/{requirements,hld,lld,tasks}.md docs/spec/design`
is empty.

## The results, stated up front

- **The screen model is real and its fixtures are a recording.**
  `@svatah/screens` has the twelve screens of LLD §13.7, 34 actions in one
  registry, and a fake service whose answers were recorded from a live
  `svatah serve` against `evals/fixtures` and the `comp` run the `Run` artboard
  is drawn from — six passed, one failed, exit 11, plan `a60918dc`, bindings
  `aa7c8799`. So "the state the mockup shows" is a claim about what a service
  answered, not about a stub written to match a picture.
- **Both renderers run, on the two screens, against a real project.** The
  packaged ADE opens into the new Flows screen and drives a record and two runs
  through its own buttons under Playwright, 8 of 8; `svatah ui` draws the same
  `comp` run in a real pseudo-terminal, in colour, and its `--json` is equal —
  key for key — to what `screenById("run").load(client, { runId: "comp" })`
  produces in another process.
- **Three clients are generated from one description and all three reach a live
  service.** `pnpm clients:smoke` passes on python 3.14.3 and java 17.0.12,
  three of three each, with the stream's step count matching `results.jsonl`.
- **The four Phase 8 corrections are in, and the two that could be are
  demonstrated rather than asserted**: the perform script's process choice is
  *executed* against a fake System Events, and the desktop snapshot case is shown
  failing on three unnamed buttons and passing on a named window.
- **Two things this phase could not do, and says so.** `axe-core` is MPL-2.0 and
  REQ-PKG-3 admits MIT, Apache-2.0 and BSD, so the component sheet's
  accessibility run is an audit of our own with an `--axe <path>` hook for a
  verifier who has a copy (D1). And the AX *screenshot* needs the Screen
  Recording grant, which this terminal does not have — `svatah surface doctor`
  says so and nothing was fabricated (K1).

---

## The verification contract

```
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && \
  pnpm -r typecheck && pnpm -r test && pnpm lint
```

From this worktree of `phase-9`, with `ANTHROPIC_API_KEY` and
`ANTHROPIC_AUTH_TOKEN` unset:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm browsers` | exit 0 (chromium, firefox) |
| `pnpm -r build` | exit 0; 31 packages and two apps |
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r test` | see the table below |
| `pnpm lint` | exit 0 |
| `node scripts/check-licenses.mjs` | OK — 1,050 packages, 17 distinct licences, none copyleft |
| `git diff master..phase-9 -- docs/spec/{requirements,hld,lld,tasks}.md docs/spec/design` | empty |

Node v25.6.1 on macOS darwin arm64. **Node 22 has not been run here**: this host
has one Node, and the second leg of the contract is a verifier's to run
(`pnpm -r typecheck && pnpm -r test` with `CI=true` on Node 22). Nothing in this
phase uses an API newer than Node 22 — the two new runtime calls are
`os.loadavg` and `os.availableParallelism`, both present since 18 and 19 — and
the `engines` field of every new package is `>=22.0.0`.

### One test failed on the first full run and passes on its own

`packages/cli/test/bidi-independence.test.ts`, `home.snapshot: the surface
opens`. It is the Firefox-over-BiDi leg, and it failed once during a
`pnpm -r test` that had eight vitest processes and 3,344 s of test time in
flight; run alone it passes in 69 s:

```console
$ pnpm --filter @svatah/cli exec vitest run test/bidi-independence.test.ts
 ✓ test/bidi-independence.test.ts (1 test) 69192ms
```

This phase touched nothing under `packages/adapter-bidi`. It is the same
load-sensitivity P8-F2 is about, in a different suite, and it is reported here
rather than re-run until it was green.

---

## Phase 8 corrections

### P8-F1 — the gate can address a still-exiting ADE

> Between variants the gate stops the ADE with `pkill -f <app>` and launches the
> next with `open -n`, and the bridge addresses the process by name. When the
> previous instance is still shutting down,
> `applicationProcesses.byName("Svatah ADE")` can answer the dying one, which
> owns no window, so every case at the new variant throws `no-window`.

Both halves of Draft 2.10 §7.5 are implemented.

**The gate waits.** `scripts/desktop-conformance.mjs`'s `stop()` polls
`pgrep -f <app>` until nothing of the previous launch remains, escalates to
`pkill -9` halfway through a thirty-second budget, and says so when one survives
anyway. The first variant gets the same clean slate — a leftover from an earlier
gate run is the same defect.

**The bridge takes the one with a window.** `window()` already did:
`frontWindowOf` walks `NSWorkspace.runningApplications` and skips a process with
no `AXWindow`. The *perform* script did not — it asked System Events for
`applicationProcesses.byName(…)`, which answers the first match. It now filters
`whose({ name })` for a process that admits to a window, skips one that refuses
the question, and still answers `no-window` when none has one.

`PERFORM_SCRIPT` is exported so it can be **executed** rather than read:

```console
$ pnpm --filter @svatah/adapter-ax exec vitest run test/bridge.test.ts -t "P8-F1"
 ✓ presses the element in the instance that has a window, not the first match
 ✓ skips a process that refuses the question rather than failing on it
 ✓ activates the windowed instance too
 ✓ still answers `no-window` when not one of them has a window
```

`tools/repo-checks/test/desktop-gate.test.ts` reads the gate's source for the
teardown poll, the SIGKILL escalation and the pre-loop stop — that half needs a
packaged ADE and a granted permission and is read rather than run.

### P8-F2 — the cost line records the machine, and the gate retries once

> 1.6 ms per node at load average seven, 29.6 ms per node beside the test suite.
> The number is honest each time and useless without the load beside it.

`AxSnapshotCost` and `UiaSnapshotCost` carry `loadAverage1m` and `cpus`, read
*after* the walk so the one-minute average is the one the read competed with.
`availableParallelism()` rather than `cpus().length`: it is what the process is
allowed to use, which on a container-limited runner is the smaller and truer
number. The conformance report's bridge line prints both, and says when the
numbers are a retry. The bridge's own timeout message carries them too — that
message is what a failed gate prints.

The gate re-runs a variant once when a read exceeded the bridge's deadline or hit
the `no-window` race, and names the retried variants in the report. **Exactly
once**: a gate that kept retrying would publish the best of N reads, which is not
what §7.5's budget means.

```console
$ pnpm --filter @svatah/adapter-ax exec vitest run test/bridge.test.ts -t "P8-F2"
 ✓ puts the one-minute load average and the CPU count on every read
 ✓ puts them in the timeout message too, which is where they are needed most

$ pnpm --filter @svatah/conformance exec vitest run -t "P8-F2"
 ✓ names the load average and the CPU count beside the cost
 ✓ says when the numbers are a retry rather than a first read
 ✓ leaves the load out rather than printing a zero when it was not recorded
```

The live gate's own figures are in the section below.

### P8-F3 — name the window's own buttons, and fail on an unnamed control

> The bridge listed three `AXButton` nodes with no title before "Open a
> project…".

Three of them, before the first control the ADE draws, on a *standard macOS
window*: close, minimise and zoom. macOS gives them no `AXTitle` — it publishes
`AXRoleDescription` "close button", which VoiceOver reads. Reading that attribute
would cost one more `AXUIElementCopyAttributeValue` on **every** node of the
tree, about six per cent of a read, to learn what the subrole already says. So
`nameOf` falls back to a static subrole → name table (`AX_SUBROLE_NAME`), and a
subrole that merely *refines* a role — `AXSearchField`, `AXTabButton` — is
deliberately absent from it: those carry the application's own label, and
inventing one for them would hide exactly the defect this exists to stop hiding.

`ade.snapshot` now fails on an interactive control with no accessible name, and
names the offenders. Both directions are demonstrated:

```console
$ pnpm --filter @svatah/conformance exec vitest run -t "P8-F3"
 ✓ passes when every button, tab and field is named
 ✓ fails, and names them, when three buttons have none
 ✓ counts a whitespace-only name as no name
 ✓ says nothing about a group or a static text, which are not operated
```

The ADE's own side: the Project screen's Import and Recent buttons have ids now,
and a Recent button whose path ends in a separator has a name rather than the
empty string `"/a/b/".split("/").pop()` produces. The rebuilt Flows and Run
screens satisfy the rule from the start — `@svatah/ui` throws in development
without a label and an id — and `apps/ade/test/shell.spec.ts` reads every
interactive control off the live Flows screen and asserts none is unnamed or
unidentified.

**The *id* half of §13.7's contract is deliberately not a gate condition yet.**
F3 asks for one rule, and the ADE still carries the eleven legacy screens until
Phase 10 (T9.4: they stay reachable behind a "Legacy" rail item). Several of
their controls are named and not identified — `Import prototype database…`,
`Start recording`, `Open <runId>` — so a check added now would fail the live gate
on screens this phase is not allowed to rebuild. T11.3 is where it becomes a
gate condition. Recorded as **K2** below.

### P8-F4 — the Phase 8 progress file carries the verification's results

`docs/spec/progress/phase-8.md` gained a "Post-verification corrections" section:
the packaged ADE opened by hand, the screenshot taken through the adapter (K1
closed for the project), the gate green twice at load average seven and failed
once at eleven with the `no-window` race, and F1 through F3 with what each one
changed.

---

## T9.1 — the screen model and the action registry

**`packages/screens`.** Twelve screens (`flows`, `record`, `runs`, `run`,
`heal`, `bindings`, `agents`, `api`, `data`, `explorer`, `import`, `settings`),
one action registry of 34, the key bindings both renderers read, and a
fake-service harness.

A screen is `{ id, title, load(service, params), actions, keys }`. Two decisions
worth stating:

- **Every state carries `sources`**: the endpoints it was assembled from, in call
  order. That turns §13.6's screen rule from something a review confirms into
  something `svatah ui --json` prints — a screen that computed a number the
  service does not publish would have nowhere to say where it came from.
- **A failed call is state, not an exception.** The mockups draw a failed load as
  an alert on the screen; a renderer that had to `catch` would be a renderer with
  logic in it.

**The service client is an interface, not an import.** `@svatah/sdk` is generated
from the description and takes its `actions` from this package, so a screen that
imported the SDK would make the graph cyclic — the same mistake the service made
in Phase 2 and fixed by injecting `ServiceApi`. `eslint.config.js` now carries
three more boundaries: `screens` may import `@svatah/schema` and nothing else;
`tui` may not import a runtime package; `ui` knows nothing about plans, runs or
bindings.

### The fixtures are a recording

```console
$ node scripts/record-screen-fixtures.mjs
wrote packages/screens/test/fixtures/fixtures-project.json: 7 flow(s), 22 stories, 30 bindings, 1 run(s)

$ node scripts/record-screen-fixtures.mjs --check
… matches the service: 7 flow(s), 22 stories, 30 bindings, run comp exit 11
```

It starts `apps/sample-web`, runs `guards-and-compensation.flow` through
`svatah run` as the `comp` run the Run artboard is drawn from, spawns
`svatah serve` with the ADE's own handshake, and writes every response.
`--check` re-records and diffs past the wall clock, the durations, the
per-candidate timings inside a resolver failure's message and `configHash` —
all four are *kept* in the file, because the screens show them, and all four
differ between two identical runs.

### Validate

| Item | Command | Answer |
|---|---|---|
| Every screen loads with the state the mockup shows | `pnpm --filter @svatah/screens test` | 27 passed. The Flows screen says "7 files · 22 stories"; the Run screen is 6 passed / 1 failed / exit 11 with the five candidates that matched nothing, the audit stamped `08.451`-style from the run's start, and `resumeFrom` on the failing step |
| The parity check passes | `pnpm --filter @svatah/repo-checks exec vitest run test/action-parity.test.ts` | 10 passed |
| A renamed action makes it fail | the same file's second `describe` | four cases: a renamed id, a renamed **label**, a changed CLI command, and an action in one source and not the other |
| `svatah ui --json` prints exactly the model's state | `tools/repo-checks/test/tui-pty.test.ts` | see T9.4 |

The parity check reads three sources and none is generated from another: the
registry, the CLI's usage block **and** its dispatch (parsed from
`packages/cli/src/cli.ts` and `packages/bindings-cli/src/cli.ts`), and
`packages/screens/fixtures/palette.json`, which is maintained by hand. A fixture
generated from the registry would compare the registry with itself and pass
whatever anyone called anything.

---

## T9.2 — the design system

**`packages/ui-tokens`** and **`packages/ui`**, built to the `Tokens` artboard.

- The tokens live in TypeScript and `tokens.css` is generated from them, because
  three things need the values and only one is a stylesheet: the CSS, the React
  components, and `svatah ui`, which renders the same status set as ANSI colours
  in a terminal that has no CSS variables.
- `:root` is the dark theme; `[data-theme="light"]` overrides every token and
  nothing else. `ui.css` selects on **no theme at all**, which is what makes
  "the two themes differ only in tokens" checkable.
- IBM Plex Sans (variable, 100–700) and Mono (400, 500) ship as Latin `woff2`
  with the OFL text beside them. `docs/spec/design/base.css` opens with a Google
  Fonts `@import`; shipping that would make the first paint of a local-only
  application a network call, and one that fails on an air-gapped machine.
- Every interactive component demands a visible label that is its accessible
  name and an id in the `automationId` form, and throws in development without
  either. `Pill` refuses an empty label: there is no way through this package to
  draw a status colour with nothing beside it.

### Validate

| Item | Command | Answer |
|---|---|---|
| The sheet passes an accessibility run with zero violations | `pnpm sheet && pnpm sheet:audit` | `0 violations — 28 interactive elements named and id'd, 89 unique ids, 20 status pills each with a word, 30 contrast pairs across both themes` |
| …and the run can fail | `pnpm --filter @svatah/repo-checks exec vitest run test/sheet-audit.test.ts` | 13 passed: each of the ten rules shown failing on a page written to break it, and the hidden-native-`<select>` case shown *not* failing |
| Every interactive component throws without a label and an id | `pnpm --filter @svatah/ui test` | 43 passed; six components × four ways each |
| The two themes differ only in tokens | `packages/ui/test/theme.test.ts` | no theme selector in `ui.css`, no colour literal outside the shadow, every `var(--…)` defined, both tables the same keys, `tokens.css` byte-identical to `stylesheet()` |
| The licence check stays permissive | `node scripts/check-licenses.mjs` | OK; Radix, Testing Library and jsdom are MIT |
| A screenshot of the sheet in both themes | `pnpm sheet:shoot` | `reports/sheet-dark.png`, `reports/sheet-light.png` |

---

## T9.3 — the SDK and the generated clients

`@svatah/sdk`, `clients/python` and `clients/java`, all three written by
`node scripts/generate-clients.mjs` from `packages/service/openapi.json`: 36
routes, 16 event kinds.

The description now **states the event kinds**. `GET /events/sse` carried no
list, so each of the three clients would have needed its own copy — three places
for a new kind to be missing from. `openApiDocument` builds the sentence from
`SERVICE_EVENT_KINDS`, and the generator reads the document.

Neither foreign client has a dependency: `urllib` and `java.net.http` are enough
for a loopback client and an event stream, so `javac` alone compiles the Java one
and the smoke path has no network in it. The Java client asks for HTTP/1.1
explicitly — `HttpClient`'s HTTP/2 default sends an upgrade header that Fastify
with `@fastify/websocket` mounted answers `400 Invalid Upgrade header` to, so
every request from a default client failed.

### Validate

```console
$ pnpm --filter @svatah/sdk test
 ✓ starts, decides, accepts and stops, over the stream it subscribed to
 ✓ refuses a second session while one is open, the way LLD §13.5 says
 ✓ exposes the screen model's actions, by the same ids
 ✓ runs an action out of process, against the live service
 ✓ says which actions exist when asked for one that does not
 ✓ reads a project through a generated method
 Tests  6 passed
```

The record session is a **real** one: a real `svatah serve`, a real browser, the
fake gateway's committed answers, and the report asserted afterwards — which is
where the test caught that `{ decision: "accept" }` was being read as a
*rejection*. `POST /record/:id/decision` takes `{ accept: true }`; the registry
sends the service's own shape now, and the report's `written` is non-empty,
`stoppedBecause` is absent and `gateway.real` is `false`.

```console
$ pnpm clients:smoke
── python ─────────────────────────────────────────
GET /project      clients-smoke: 7 flow(s), 22 story/stories
POST /run         started 00mto7o3c8a3h79n
GET /events/sse   10 event(s): run.started, step.result, run.summary
GET /runs/00mto7o3c8a3h79n/results  8 step(s), matching the stream
python 3.14.3: 3 of 3 — the client is conformant

── java ───────────────────────────────────────────
GET /project      clients-smoke, 5140 bytes
POST /run         started 00mto7octcvemgj8
GET /events/sse   10 event(s), 8 step result(s)
GET /runs/00mto7octcvemgj8/results  8 step(s), matching the stream
java 17.0.12: 3 of 3 — the client is conformant

PASS  python
PASS  java
```

A missing toolchain is a **skip with the reason**, never a pass, so the CI legs
install a JDK and a Python rather than hoping for them. Both CI files gained a
`clients-smoke` job on every branch and pull request, and
`tools/repo-checks/test/ci.test.ts` holds them in step.

```console
$ pnpm --filter @svatah/repo-checks exec vitest run test/client-drift.test.ts
 Tests  8 passed
```

The drift check is shown failing on each of the three clients — on a hand edit
and on a deletion — and the tree is restored afterwards.

---

## T9.4 — the two renderers, two screens each

### The ADE

The shell is rebuilt on `@svatah/ui`: top bar with the project crumb, the palette
field and the service chip; the rail of §13.7's information architecture;
workspace; inspector; status bar; a command palette on ⌘K. It renders `flows` and
`run` from the model and **nothing else** — the other ten screens are the Phase
3–5 tabs, reachable behind a `Legacy` rail item until Phase 10, which is T9.4's
scope stated as a rail item so nobody has to remember it.

Four defects the live application found, each of which a screens-only test would
have missed:

1. **Two Reacts.** `@svatah/ui` declares React as a peer *and* a dev dependency,
   so pnpm gives it its own copy and Vite bundled both. Two Reacts share no
   dispatcher: the first hook threw `Cannot read properties of null (reading
   'useState')` and the window rendered nothing. `resolve.dedupe` in
   `vite.renderer.config.ts`.
2. **Radix's transitive imports.** `tsup` leaves `dependencies` external, so the
   ADE's Vite had to resolve `@radix-ui/primitive` from inside
   `@svatah/ui/node_modules` and could not. Radix is bundled into the design
   system now: nothing outside imports it, and the boundary lint forbids
   anything else doing so.
3. **The legacy stylesheet's `:root`.** `app.css` declared `--fg`, `--bg`,
   `--line` and `--accent` — the same names `@svatah/ui-tokens` declares — and is
   imported after it, so the rebuilt shell drew `#14161a` text on the dark
   `--bg0` and half the Flows screen was invisible. Every variable in that file
   is `--legacy-*` now; Phase 10 deletes the file.
4. **The stream came up too late.** A run is started from the *Flows* screen, so
   a subscription that came up with the Run screen missed the first
   `step.result` and `run.summary` of every short run — the screen then sat on a
   live run that had ended, with an empty audit pane. The shell subscribes for
   as long as the window is open and re-loads the screen from the files when a
   run ends, which also makes the live screen and the historical screen the same
   object.

### `svatah ui`

`packages/tui`, Ink, four numbered panes, `1`–`4`, `Tab`, `j`/`k`, `Enter`, the
screen's own single-letter accelerators, and the same palette on `^K`. It opens
or adopts a service exactly as the ADE does — `--url`/`--token` or
`SVATAH_SERVICE_URL`/`_TOKEN` skip the search, otherwise it spawns
`svatah serve --port 0`, reads the handshake and stops it on exit.

`--capture <ms>` draws for a while and then quits. It is the product's own flag
rather than a test hook: a cockpit that can only be left by pressing a key cannot
be captured by anything that is not a person, and REQ-ADE-13's point is that an
agent gets what a person gets.

### Validate

| Item | Command | Answer |
|---|---|---|
| The packaged ADE opens into the new Flows screen | `pnpm --filter @svatah/ade package && pnpm --filter @svatah/ade exec playwright test` | 8 passed. The rail, the toolbar's "7 files · 22 stories", the flow list, the editor — and `#screen-project` has count 0, because the eleven tabs are behind the rail item |
| Every control on it is named and id'd | the same file, case 2 | reads every interactive node off the live window and asserts none is unnamed or unidentified |
| A record and a run through the new screens' buttons | the same file, cases 3, 4, 6 | Record starts a session with the fake gateway; Run starts a run and the shell goes to the Run screen with its steps; **Run again** is a button on the Run screen and starts another |
| `svatah ui` runs `comp` in a pseudo-terminal | `pnpm --filter @svatah/repo-checks exec vitest run test/tui-pty.test.ts` | 10 passed. Four panes, the steps, `aborted`, `exit 11`, the footer's keys, ANSI colour — which is the half a pipe cannot prove |
| `--json` equals the model's state | the same file | compared key for key with `screenById("run").load(new SvatahClient(connection), { runId: "comp" })` evaluated in the test's own process, for both screens |
| The same action ids in both palettes | `tools/repo-checks/test/palette-parity.test.ts` | 7 passed: both build from `ACTIONS`, neither invents an id, neither filters a group, both show the CLI command, both resolve by `actionById` and bind keys from `screenById(…).keys` |

#### How the two renderers are driven, and why differently

**The ADE is driven over CDP, not by `_electron.launch`.** Playwright's Electron
support attaches to Electron's *Node* inspector, and a packaged build has the
`RunAsNode` and `EnableNodeCliInspectArguments` fuses off — which is what T8.1
turned off and what must stay off. The renderer's own DevTools endpoint is a
different thing and is available: the application is started with
`--remote-debugging-port` and driven through `chromium.connectOverCDP`. What that
gives up is the main process; what it keeps is the packaged product's real
renderer, which is what the screens are.

**`svatah ui`'s keys are driven by `ink-testing-library`, not in the
pseudo-terminal.** Typing into a pseudo-terminal means writing to its *master*,
and `script(1)` gives a caller no way to reach one — its only input is its own
stdin, which must already be a terminal. So the pseudo-terminal proves the half a
pipe cannot (that the cockpit draws, in colour, with its panes) and
`packages/tui/test/cockpit.test.tsx` drives `useInput` directly for the keys and
the palette. The phase's environment note allows exactly that split and asks that
it be said.

### The desktop conformance suite still runs

`openScreen` presses the `Legacy` rail item when the tab it wants is not on
screen, and only then — so the same five flow cases and two healing cases run
against the pre-Phase-9 build and against this one. T10.3 replaces them with the
new structure and that fallback goes with them.

---

## T9.5 — the record and the screenshots

| Artefact | Command | What it is |
|---|---|---|
| `reports/ade-flows.png` | `pnpm ade:shoot` | The packaged ADE's Flows screen: the rail, the toolbar's counts, the flow list with `guards-and-compensation.flow` aborted, the editor with its gutter and `tier 1 · bound` notes, line 45 selected, `0 ERRORS 3 WARNINGS`, and the inspector's tier, target, binding, guard and last run |
| `reports/ade-run.png` | the same | The `comp` run: `6 passed 1 failed 0 skipped`, the two stories with the compensation policy, the five steps with `testid #0` and `= BK-…`, the failure sentence with `policy applied · compensate: cancel a booking`, `flow aborted · exit 11 · the compensation itself passed`, the audit, and the failing step in the inspector |
| `reports/ui-flows.txt`, `reports/ui-run.txt` | `pnpm ui:capture` | `svatah ui`'s own frames, taken inside a pseudo-terminal with `--capture`, ANSI removed so they can be read in a diff |
| `reports/sheet-dark.png`, `reports/sheet-light.png` | `pnpm sheet:shoot` | The component sheet, both themes |
| `reports/ade-flows-ax.png` | `pnpm ade:shoot` | **Not taken.** See K1 |

The two renderers' screenshots are of the same project and the same run, which is
the comparison T9.5 is for: the ADE's Flows list and `svatah ui`'s pane 1 are the
same seven files with the same statuses; the ADE's step rows and pane 2 are the
same five steps with the same `testid #0` and the same durations.

---

## Deviations

**D1 — the sheet's accessibility run is ours, not axe-core's (T9.2).** T9.2's
Validate says "passes an axe-core run with zero violations". axe-core is
**MPL-2.0**; REQ-PKG-3 admits MIT, Apache-2.0 and BSD, and
`scripts/check-licenses.mjs` refuses MPL by name. The two cannot both be
satisfied by adding the dependency, and the phase's working rules say
"permissive licences only". `scripts/audit-sheet.mjs` implements the ten rules
LLD §13.7's accessibility contract actually names — accessible name,
`automationId` form, unique ids, labelled fields, button type, heading order,
landmarks, contrast through the token tables, colour-never-alone, document
language — and `pnpm sheet:audit --axe <axe.min.js>` runs axe-core beside it for
a verifier who has a copy. Every rule is shown failing in
`tools/repo-checks/test/sheet-audit.test.ts`.

**D2 — the client generator is ours (T9.3, §13.8).** The phase's environment
note authorises this and asks that it be said. `openapi-generator` is Apache-2.0
and would satisfy the licence, but it is a 30 MB jar fetched from Maven Central
at build time — a network dependency in the build of a project whose replay path
has none — and a second toolchain to pin; `openapi-typescript` and `orval` are
MIT and generate TypeScript only. `scripts/generate-clients.mjs` is about 250
lines and emits all three, and the drift check is what makes it trustworthy.

**D3 — the light theme's `--dim` is `#868f9e`, not the artboard's `#8b96a5`
(T9.2).** The artboard's value is 2.998:1 against white — three thousandths
below WCAG AA's 3:1 for a large glyph, and well below the 4.5:1 a 10.5 px section
label wants. `scripts/audit-sheet.mjs` measures it and fails; the value is
darkened by five units of lightness to 3.26:1. The dark theme's `dim` is
unchanged. Where a mockup and a measured accessibility rule disagree, the rule
wins.

**D4 — a `--scrim` token the artboards do not name (T9.2).** The `Palette`
artboard draws the modal's backdrop as `rgba(10,12,16,0.62)`. It is the one
colour that cannot be the same in both themes — a 62 % black over a dark
application is a dimming and over a light one a blackout — so it is a token
rather than a literal, and `ui.css` names no colour of its own.

**D5 — HLD §12's layout block does not list the five new packages (T9.1–T9.4).**
Draft 2.11 adds `@svatah/screens` (LLD §13.7), `@svatah/ui-tokens` and
`@svatah/ui` (§13.7's design system), `@svatah/sdk` (§13.8) and `@svatah/tui`
(REQ-TUI-1) by name in the LLD and in `tasks.md`'s Phase 9, and does not extend
§12's layout block, which was last touched in Draft 2.3.
`tools/repo-checks/test/layout.test.ts` names the five with the section that
requires each, and still fails on a sixth package nobody wrote down. The four
spec documents are unchanged, as the phase requires.

**D6 — the Flows toolbar has Record and Run, and not Heal (T9.4).** The `Main`
artboard draws three buttons. `heal.run` belongs to the `run` screen in the
registry — healing is about a run, and §13.7 gives each action exactly one home
— so the Flows toolbar shows the two actions that screen owns. Heal is one ⌘K
away from anywhere and is a button on the Run screen, where the mockup also
draws it.

**D7 — the rail's `Runs`, `Bindings`, `Agents`, `API`, `Data`, `Import` and
`Settings` items go to the Legacy screens (T9.4).** Phase 9 renders two of the
twelve. A rail item for a screen the model has and the ADE does not render yet
opens Legacy rather than an empty pane; Phase 10 makes each of them its own
screen. The `Legacy` item is on the rail so the state is visible rather than
surprising.

**D8 — `svatah ui --capture <ms>` is a flag the LLD does not name (T9.4).**
§13.7 names `--json` and nothing else. A cockpit that can only be left by
pressing a key cannot be captured by a script, so T9.5's "a capture of its panes"
and the pseudo-terminal test both need it. It draws normally and quits; it is not
a mode.

**D9 — the screen model has no Stop action (T9.1).** LLD §13.5's table has
`POST /runs/:id/stop`; the service publishes only the record half (T2.11 shipped
`POST /record/:id/stop` and no run half). A screen may only ask for a route that
exists, so the Run screen has no Stop button. Recorded as **K3**.

---

## Known gaps

**K1 — no AX screenshot on this host.** `svatah surface doctor --adapter ax`
reports `ok ax/accessibility granted` and `warn ax/screen-recording refused —
could not create image from rect`: Screen Recording is a separate grant from
Accessibility and belongs to the terminal running Svatah. `pnpm ade:shoot` says
so and takes the two renderer screenshots; nothing was fabricated. The command
that closes it is `pnpm ade:shoot` from a terminal with the grant.

**K2 — the desktop snapshot case does not yet require an `automationId`.** P8-F3
above says why: the eleven legacy screens stay until Phase 10 and several of
their controls are named and not identified. The rebuilt screens satisfy it and
`apps/ade/test/shell.spec.ts` holds them to it; T11.3 makes it a gate condition.

**K3 — `POST /runs/:id/stop` is unimplemented.** D9 above. Stopping a run needs
the executor to be cancellable, which is a runtime change and not a screen's.

**K4 — ten of the twelve screens are modelled and not rendered.** T9.4's scope.
They load, they are tested against the recorded fixtures, and they are reachable
through the Legacy rail item; T10.1 and T10.2 build them.

**K5 — the flow editor is read-only.** `PUT /flows/:file` and the `flows.save`
action exist in the model and the ADE renders the file rather than editing it. A
half-built editor that silently dropped a keystroke would be worse than a view
that says it is a view; T10.1 is where it is wired.

**K6 — Node 22 has not been run here.** This host has one Node (v25.6.1). The
contract's second leg is a verifier's: `pnpm -r typecheck && pnpm -r test` with
`CI=true` on Node 22.

**K7 — the compiler golden set is 222 against REQ-COMP-9's 300.** Inherited,
untouched by this phase, and Phase 11's T11.2.

**K8 — the Windows UIA gate is unrun.** Inherited; Phase 11's T11.6.
