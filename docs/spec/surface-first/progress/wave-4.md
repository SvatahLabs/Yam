# Surface-first wave 4 progress

Wave 4 is milestone M4: **T18** (Yam controls the real packaged Yam), **T19**
(coverage and performance with a denominator), **T20** (docs, support matrix and
release review brought to what shipped).

Branch: `surface-first-wave-4`, from `master`.

Nothing in this wave is published. No push, no `npm publish`, no tag, no release
dispatch. The release *review* is a document with evidence; the release is the
owner's.

---

## T18 — Make Yam control the real packaged Yam

**Status:** complete, with a **reliability gap recorded in the verification
section below** — the suite passes but does not pass every time, and that is
stated there rather than averaged away. **91 of 91 reached checks pass; 1 is
blocked; 92 were attempted.** Every interface × platform pair the wave names is
reached: `yam surface` and the MCP tools, each against the packaged
application's **renderer as a browser target** and against its **macOS
accessibility tree**.

**Requirements:** SF-18, SF-21.

### What "Yam controls Yam" had to mean

Waves 1–3 proved themselves with `apps/desktop/test/surfaces-dogfood.mjs`, which
builds the renderer and drives it in a headless browser. It is real evidence
about the screen model and the renderer, it found nine defects in wave 3, and it
**stays** — labelled browser-hosted, because the thing it drives is not the thing
anybody installs.

T18 asks a different question, and the answer had to come from the packaged
application driven through Yam's own public interfaces. The suite is
`evals/self/yam-on-yam/`:

| File | What it is |
|---|---|
| `launch.mjs` | Opens the packaged bundle through LaunchServices and **awaits readiness** — never sleeps. Also the host probe that says whether an accessibility client can read *any* window on this machine. |
| `drivers.mjs` | The two public interfaces behind one shape: `yam surface` spawned as a person types it, and the MCP tools over **stdio through the official SDK client**, as an agent calls them. |
| `journey.mjs` | The primary journey, written **once** and run through both. |
| `negatives.mjs` | Wrong postcondition, stale reference, held target. |
| `oracles.mjs` | Screenshot, geometry, the accessibility audit, and the fixture project's bytes. |
| `run.mjs` | The passes, the counts and the report. |

There is no selector, no injected script and no reach into the renderer in any
driving path. A control is found in a snapshot **Yam took** and acted on by the
reference that snapshot gave it.

Two applications are in play, and the record is exact about which: the **outer**
session is Yam driving the packaged Yam; the **inner** session is the packaged
Yam driving the sample app, opened by the outer session filling a URL and
pressing a button. What is verified at the end is the inner result, read off the
outer application's own screen.

### Six defects the driving found

Every one of them was invisible to a suite that drives a renderer in a browser,
and every one is a claim wave 3 had made about the code.

| # | Defect | Found by | Fix | Now proved by |
|---|---|---|---|---|
| 1 | **The packaged application could not be built at all.** `pnpm --filter @svatah/yam-desktop package` failed: `"createHash" is not exported by "__vite-browser-external"`. `@svatah/yam-schema` builds as one bundled entry with `treeshake: false`, so `canonical.ts`'s `node:crypto` is in the same file as everything else; `packages/screens` imports `offeredActions` from the barrel for the action inspector's forms (T15), and the renderer bundles `packages/screens`. It survived because the evidence harness had a Vite config of its own aliasing `crypto` to a stub, and `shell.spec.ts` *skips* when there is no packaged build — so "there could not be one" was reported as "nothing to check". | Running `package` for the first time since T15. | `packages/schema/tsup.config.ts` builds a second, browser-safe entry (`src/action-forms.ts`, over `surface.ts` and zod and nothing else) exported as `@svatah/yam-schema/action-forms`; the barrel still re-exports every name, so Node callers are unchanged. The harness's alias is **deleted**, so it links the bundle the product ships. | `tools/repo-checks/test/renderer-bundle.test.ts`: the built screen model imports no Node built-in; the two Vite configs configure no alias; the stub file is gone. |
| 2 | **The broker was version-blind, and dropped arguments in silence.** `yam surface connect --attach <endpoint>` reached a broker the *packaged application* had started from the copy of the CLI staged inside its own bundle, built before `attach` existed. The argument vanished, a fresh blank browser was launched instead of the application's renderer being joined, and the session answered `succeeded` — on a target the caller never named, which is what SF-04 forbids. Every snapshot after it was empty and every one said `succeeded`. | `yam surface snapshot` returning `nodes: []` in 3 ms against a window Playwright could read perfectly. | `catalogueFingerprint()` — derived from every operation name, CLI flag, tool name and route, so nobody has to remember to bump it — is published on the broker's `/health`; `brokerAlive` compares it, and `connectToBroker` stops a broker that speaks a different contract and starts one that matches. | `packages/surface-control/test/contract-guard.test.ts`; the suite clears the field before it measures anything. |
| 3 | **A missing action argument was reported as a timeout.** `yam surface act --action type` with no value answered `TIMEOUT` and exited 75. The adapter throws `ActionabilityError` for a missing argument and the dispatcher maps that to `TIMEOUT`, so an agent read "try it again" for a request no retry could fix. SF-11 says act validates its arguments **before dispatch**, and it did not. | The suite sending the argument under the wrong name. | `dispatchAct` checks the action's required fields against `ACTION_FORMS` — the table T15 put beside the catalogue precisely so no client would have to know — and refuses with `INVALID_ARGUMENT`, exit 64, "Nothing was dispatched." The adapter is never called. | `contract-guard.test.ts`: the refusal, its `details.missing`, and that the surface recorded no action. |
| 4 | **`yam surface` ignored flags it did not know.** `yam surface control --action take` parsed, dropped `--action` (the command line spells it `--take`), reported the *status* of the lease and exited 0. The caller who meant to take control was told nobody held it. Three flags the CLI already read — `--idempotency-key`, `--holder`, `--secret` on `act`, `--with-session-cookies` on `request` — were also missing from the catalogue, so they worked and were not written down. | The suite calling `control` with the MCP spelling. | The catalogue gained the four missing flags; `yam surface` now rejects any flag an operation does not declare, naming the flag, the subcommand and what it does take. The check is the catalogue, not a second list beside it. | `packages/cli/test/surface-flags.test.ts`. |
| 5 | **The application opened into the project chooser, not Surfaces.** The main process opens a projectless service on ready and announces it; until that landed, the renderer rendered the **welcome screen**. So on any machine that has ever opened a project, the first thing a person saw was the old chooser with their recents on it, and Surfaces arrived a second later — "Surfaces is the default screen" was true of the second second and not the first. The browser-hosted harness stubs the preload bridge with `recentProjects: []` and answers `serviceInfo()` immediately, so it never saw the state a real machine has. | Launching the packaged application cold, with recents on the machine. | `apps/desktop/src/renderer/App.tsx` renders a **loading** state (`#screen-starting`, SF-17's own vocabulary) while the service is opening. The welcome screen is still where a *failure* lands, which is when a person needs the chooser and the log. | The suite's readiness helper, which fails the run if the welcome screen is what comes up; and the `opens into Surfaces` check in both journeys. |
| 6 | **`yam surface --json` truncated its output at 64 KiB.** `process.exit()` discards whatever is still buffered, and when stdout is a **pipe** — `yam … --json \| jq`, and every suite that reads this command — a large answer is still buffered when the command returns. The cut was exactly 65 536 bytes, one pipe buffer, mid-token: `wc -c` said 65536 through a pipe and 130764 into a file, and only the second parsed. SF-06 asks that a pipe parse exactly one JSON result per call; half a result is neither. It had never shown because every existing suite redirected to a file or read answers small enough to fit — and it surfaced the first time Yam read a *native* accessibility tree of its own window, which is three hundred nodes. | The AX pass's second snapshot answering with unparseable JSON. | `packages/cli/src/bin.ts` flushes stdout and stderr before exiting, bounded so a reader that has gone away cannot hang a finished command. | The AX passes, which cannot complete without it; `piped JSON parses, nodes = 321`. |
| 7 | **The broker's Accessibility grant is not the caller's.** `yam surface doctor` in a terminal said **granted**; `yam surface connect --adapter ax` said **denied**, on the same machine a second apart. Both were true. macOS gives the permission to a *program*, and the program asking is whichever one started the **broker** — which, on a machine where the desktop application got there first, is the copy of the CLI staged inside `Yam.app`, a program nobody granted. Every native session on the machine then asks on its behalf. | Driving AX once the display was unlocked. | The refusal now **names the program the grant is about** rather than saying "the program running Yam", and says that `surface doctor` reports the permission of whatever program *it* runs as, which is not always the same one. The suite starts the broker from the workspace binary before launching the application, so the application joins the one already running. | The two AX passes, which are refused without it; the message itself carries the path. |
| 8 | **Two accessibility defects in the shipped window.** The independent audit, run over the packaged application's own live DOM, found the heading outline jumping `h1 → h3` (the toolbar title is the `h1`; the discovery group headings were `h3`) and **no `<main>` landmark** — the workspace was a labelled `section`, which is a region and not the main one, so "skip to the content" had nowhere to land. | `scripts/audit-sheet.mjs` over the window, as an oracle. | `h3` → `h2` in `Surfaces.tsx`; `section` → `main` in `Shell.tsx`. | The `oracles` pass: 0 violations over the live DOM. |

Two of the six (1 and 5) are defects a user would have met on first launch. Both
were behind a green gate, and both needed the *packaged* application to see.

### Blocked, with the host's own words

One check is blocked, and for a permanent reason rather than a host one:

```
blocked [oracles] axe-core confirms the in-house audit
  — axe-core is MPL-2.0 and REQ-PKG-3 admits MIT, Apache-2.0 and BSD only, so it
    is not a dependency of this repository. Set YAM_AXE=<path to axe.min.js> to
    run it beside the in-house audit.
```

The in-house audit (`scripts/audit-sheet.mjs`) runs always, over the packaged
window's own live DOM. axe-core is the optional second opinion, and the licence
is why it is not vendored.

**A host reason that came and went, and is worth keeping.** For the first part
of this work the display on this machine was locked, and macOS answers *every*
application's window list with the application itself in that state — so no
accessibility client could read any window. The suite reported the two AX passes
as `blocked`, quoting `yam surface doctor`'s own line
(`CGSSessionScreenIsLocked`) **and** the fact that the Finder — always running,
not ours — reported 0 windows to the same client. That second half is the part
worth keeping: it is what separates "this host cannot be asked" from "Yam could
not read Yam", and `launch.mjs`'s `accessibilityHost()` still performs it on
every run. The display was later unlocked and both passes were run for real.

### Validate — every item, and the command that shows it

```
pnpm install --frozen-lockfile
pnpm -r build
pnpm --filter @svatah/yam-desktop package
YAM_ON_YAM_EVIDENCE_DIR=docs/spec/surface-first/evidence/wave-4 \
  node evals/self/yam-on-yam/run.mjs
```

| T18 Validate item | Shown by |
|---|---|
| The packaged app is launched by the suite | `launch` pass: "the packaged application starts and publishes a window", naming the bundle. |
| Readiness awaited by a helper, not a sleep | `launch.mjs`'s `waitUntil` over three conditions: the DevTools endpoint answers, a page target exists, the **Surfaces body** is on screen. The third was added after the second proved insufficient — the shell had rendered and the window under it still said "Loading…". |
| The primary journey through `yam surface` | `cli-browser`, 16 checks. |
| The same journey through the MCP tools | `mcp-browser`, 16 checks, over a real `yam mcp` subprocess through the SDK's stdio client. |
| The renderer attached to as a browser target | Both of the above connect with `--attach <the application's DevTools endpoint>`. |
| The app's accessibility tree | `cli-ax`, `mcp-ax`, 18 checks each: the same journey with `--adapter ax --app Yam`. The two platforms describe the same control differently — the application's tree lines are `<button aria-pressed>`, which the DOM calls `button` and macOS publishes as `checkbox` — so `findNode` matches the role where it discriminates and the *name* where it does not. |
| A wrong postcondition fails the gate | `negative-cli` / `negative-mcp`: a true postcondition passes, then a false one answers `failed` / `CHECK_FAILED`, keeps the value it observed, and exits **20** on the command line. Shown failing, not shown passing when correct. |
| A stale reference is refused | Both negative passes: a reference nothing issued, offered with a superseded snapshot id, answers `refused` / `STALE_REFERENCE`. Unconditional — an earlier draft ran it only when a particular button happened to be on screen, and skipped in silence when it was not. |
| A held target refuses the other client | Both negative passes: control taken under `yam-on-yam-agent`, an act from `somebody-else` refused `CONTROL_BUSY` **naming the holder**, then released. The reference is taken from a snapshot of the moment, so the refusal under test is the lease and not a stale ref. |
| External oracles: screenshot | `oracles`: a real PNG of the window, checked by magic bytes and size. |
| External oracles: geometry | `oracles`: the URL field's right edge against the Connect button's left, measured over CDP — the class of defect T14's driving found. |
| External oracles: accessibility | `oracles`: `scripts/audit-sheet.mjs` over the window's live DOM. |
| External oracle: the fixture project unchanged | `oracles`: 46 files hashed before the run and after; no addition, modification or removal. |
| No hidden selector-based UI actions | Every driving call is in the transcripts, as a command line or a tool call. |

### Result

```
91 of 91 reached check(s) passed; 1 blocked; 92 attempted
```

Per pass, as `yam-on-yam.json` records them — counted from that file rather
than retyped, because the first version of this table was typed by hand and
every row was wrong (it summed to 94 against an evidence file that says 91,
which in a wave about honest denominators is the defect it exists to catch):

| Pass | Interface | Platform | Passed | Blocked | Attempted |
|---|---|---|---|---|---|
| `cli-browser` | `yam surface` | the renderer, attached to | 17 | 0 | 17 |
| `mcp-browser` | MCP over stdio | the renderer, attached to | 17 | 0 | 17 |
| `cli-ax` | `yam surface` | macOS accessibility tree | 17 | 0 | 17 |
| `mcp-ax` | MCP over stdio | macOS accessibility tree | 17 | 0 | 17 |
| `negative-cli` | `yam surface` | the renderer | 9 | 0 | 9 |
| `negative-mcp` | MCP over stdio | the renderer | 8 | 0 | 8 |
| `launch` | — | the packaged application | 1 | 0 | 1 |
| `oracles` | independent | the packaged application | 5 | 1 | 6 |
| **total** | | | **91** | **1** | **92** |

`negative-cli` has one check more than `negative-mcp` on purpose: the exit code
is a thing only a command line has, and a wrong postcondition must exit nonzero
so a script cannot miss it.

Evidence in `docs/spec/surface-first/evidence/wave-4/`:

- `yam-on-yam.json` — every check, its pass, its outcome, the counts and the timings.
- `yam-on-yam-transcript.txt` and `.json` — **every** command line and every MCP
  tool call with its arguments and the envelope that came back. This is the
  record that every action on the application went through a public interface.
- `packaged-surfaces.png` — the packaged window, as the harness took it.
- `packaged-surfaces-dom.html` — the DOM the accessibility oracle audited.

### Deviations

- **The projectless workspace is not written to, and is not a project.** Nothing
  in T18 opens a project; the application starts on its private workspace and
  the fixture project's 46 files are byte-identical afterwards. "Save as
  automation" is not exercised here — it refuses without a project, which wave
  3's verification established and T18 does not re-litigate.
- **The AX passes need the broker to belong to the terminal.** The suite starts
  it from the workspace binary before launching the application, for defect 7's
  reason. On a machine where the desktop application starts the broker first,
  the two AX passes are refused with the permission message — which now names
  the program the grant is needed for.
- **`@modelcontextprotocol/sdk` and `@playwright/test` became root
  devDependencies.** `evals/self` is not a package with a manifest of its own,
  and pnpm's strict isolation means the suite could not otherwise resolve the
  MCP client it must speak through. Neither is a runtime dependency of anything
  published.

### Known gaps

- `permission-denied` in the **desktop** remains undriven, as it has since wave
  3. The *domain* refusal is now driven — defect 7 above produced a real
  `PERMISSION_REQUIRED`-class refusal through the command line, with the
  program named — but making the desktop render its permission-denied state
  needs the grant revoked mid-run, which no unattended host can produce.
- Windows UIA, Appium and BiDi are not revalidated here; T19 records what each
  says about itself and why.

---

## T19 — Publish coverage and performance

**Status:** complete. **272 of 272 reached checks pass; 5 are blocked; 277 were
attempted.**

**Requirements:** SF-09, SF-18, SF-20, SF-21.

### The report is generated, and the denominator is the headline

`node scripts/coverage-report.mjs` (`pnpm coverage`) writes
`docs/spec/surface-first/evidence/wave-4/coverage.md` and `coverage.json`.
Nothing in it is typed in: the suite results are read from the JSON their
runners wrote, adapter readiness is asked of the product, the timings are
measured in the process that reports them, and the quick starts are run from a
packed tarball outside the workspace.

SF-21: *"A high agreement percentage on a small reachable subset cannot satisfy
release coverage."* So every row reads **passed, failed, reached, blocked,
attempted**, and the headline is the three totals rather than a percentage. A
blocked row always carries the sentence that would have to become false for it
to be reached.

| Interface | Platform | Reached | Passed | Blocked |
|---|---|---|---|---|
| CLI | browser (the packaged renderer) | 26 | 26 | 0 |
| MCP | browser (the packaged renderer) | 25 | 25 | 0 |
| CLI | macOS AX (the packaged window) | 17 | 17 | 0 |
| MCP | macOS AX (the packaged window) | 17 | 17 | 0 |
| desktop | the packaged application | 1 | 1 | 0 |
| desktop | **browser-hosted** (the built renderer) | 154 | 154 | 0 |
| HTTP | the service's `/v1` routes | 14 | 14 | 0 |
| external | independent oracles | 4 | 4 | 1 |
| packaging | a clean install from the packed tarball | 11 | 11 | 0 |
| adapter | readiness, one row each | 2 | 2 | 4 |

The `desktop / browser-hosted` row keeps its label. It is
`apps/desktop/test/surfaces-dogfood.mjs`, which builds the renderer and drives
it in a browser; it is not the packaged application, and counting it as if it
were is the thing this wave exists to stop.

### Adapters: validated, unvalidated, blocked — and the difference

SF-09: *"An adapter's presence in a dropdown is insufficient evidence of
support."* Neither is `available: true`, which means registered and on a
matching platform — a claim about this machine, not about the adapter. So the
report reads the T18 transcript for adapters a session was actually **opened
through**, and everything else says why not, in the words of what would have to
be true.

| Adapter | Status | Evidence, or the reason |
|---|---|---|
| `playwright` | **validated** | a session of kind `web` opened through it in this run |
| `ax` | **validated** | a session of kind `desktop` opened through it in this run |
| `http` | unvalidated here | driven by `packages/cli/test/surface-transport.test.ts` in the gate rather than by this suite, which drives the packaged desktop |
| `bidi` | unvalidated | needs a Chrome or Firefox started with a BiDi endpoint; `pnpm bidi:independence` is the suite that drives it and it is not part of this run |
| `appium` | unvalidated | needs an Appium server and a device or emulator; neither is present on this host, and no device runner is provisioned |
| `uia` | **blocked** | `Adapter "uia" requires win32; this host is darwin.` — the product's own sentence; no Windows runner is available |

### Clean-package quick starts, from the docs, verbatim

`node scripts/surface-quick-start.mjs` (`pnpm quick-start:surface`) packs the
CLI and its closure with `pnpm pack`, installs the tarballs into a directory
under the OS temporary directory — **outside** this workspace, so nothing
resolves through pnpm's links — and runs **every command extracted from
`examples/surface-control/README.md`**. The commands are not written in the
script; they are read out of the document, so a doc that drifts is a failing
check rather than a stale page.

**11 of 11 commands pass**, including `npm install @svatah/yam` being the
scoped name SF-20 requires, the six `yam surface` lines of the journey, and an
ordinary MCP client initialising against the installed package and listing
**21 tools, 14 of them surface tools**.

A reader replaces exactly two things when they copy this quick start, and so
does the script — `http://localhost:3000` for their own application and `s_...`
for what the previous command printed, which is what the document's own comment
tells them to do. Both substitutions are recorded beside the command in
`coverage.json`, so "verbatim" does not have to be taken on trust.

**A defect the running found.** The first draft of this runner hosted the
sample application *in its own process* while running the commands under
`spawnSync`, which blocks the event loop — so the server could not answer the
browser, and every connect reported `TIMEOUT` after ten seconds. A harness that
publishes its own blocked event loop as a product timeout is worse than no
harness; the application now runs in a child process. The same mistake, and the
same fix, appears in the timing measurement below.

### Timing budgets: defined here, measured here

`requirements.md` calls these *"proposed product budgets to calibrate, not
measured current performance"*. This is the calibration, on a named machine.
Each sample is a **fresh process**, so cold start is included — which is what a
person at a terminal actually pays.

Reference machine: `darwin arm64, Node v25.6.1`.

| What | Budget | p95 | Median | Samples | Within |
|---|---|---|---|---|---|
| connect (a browser to the sample app) | 5000 ms | 912 ms | — | 5 | yes |
| snapshot (bounded, interactive only) | 5000 ms | 823 ms | — | 5 | yes |
| act (typing into a real field) | 5000 ms | 576 ms | — | 5 | yes |
| the desktop's first paint (launch to Surfaces on screen) | 60000 ms | 1141 ms | — | 1 | yes |

The exact numbers are in `coverage.json`; they will differ per machine and the
report always names the one it ran on.

**`act` measures an act.** An earlier draft timed an HTTP session's
`capabilities` call and labelled it `act`, because an HTTP surface refuses
`act` — a budget measured on a different operation than the one it names is
worse than no budget. It now drives the sample application and types into a
field of it.

### Validate

| T19 Validate item | Shown by |
|---|---|
| Attempted / reached / passed / failed / blocked by platform and interface | `coverage.md`'s first table, generated. |
| Externally verified checks distinguished | The `Externally verified` column; the `external` row is the independent oracles. |
| Clean-package quick starts run | `pnpm quick-start:surface` — 11 of 11, from a packed tarball outside the workspace. |
| Timing budgets defined and measured | The budgets table, measured in the same run, on a named machine. |
| BiDi / Appium / UIA revalidated or marked unvalidated with exact host reasons | The adapters table: each unvalidated row names what would have to be true; `uia` carries the product's own refusal sentence. |
| No headline percentage without its denominator | The report's headline is three counts and says why. |

### Deviations

- **BiDi and Appium are marked unvalidated rather than revalidated.** T19
  permits either. Driving BiDi needs a browser started with a BiDi endpoint and
  Appium needs a server and a device; neither is provisioned here, and inventing
  a pass for them is precisely what SF-09 forbids.
- **`http` is validated by the gate, not by this suite.** Its row says so. The
  suite's subject is the packaged desktop; the HTTP interface is covered by its
  own row (`catalogue-to-openapi`, 14 of 14) and by `surface-transport.test.ts`.
- **One sample for the desktop's first paint.** It is the T18 run's own launch
  measurement, and that run launches the application once.

### Known gaps

- No Windows, device or BiDi runner on this host, so three adapters carry a
  reason instead of a result.
- The budgets are one machine's. They are calibration, and the report says so.

---

## T20 — Finish migration and release review

**Status:** complete.

**Requirements:** the P0 portions of SF-01–SF-21.

### The support matrix is derived, not written

[`docs/reference/generated/support-matrix.md`](../../../reference/generated/support-matrix.md)
is generated by `scripts/docs.mjs` from `coverage.json`, which
`scripts/coverage-report.mjs` generates from runs. `pnpm docs --check` is in the
gate, so a coverage report that moves and a matrix that does not is a red build
rather than a page that quietly rots.

It publishes four words and says what each one claims:

| Word | What it claims |
|---|---|
| **validated** | A session was opened through this adapter, and driven, in the run the page comes from. |
| implemented, unvalidated here | Built and registered; nothing in that run drove it, and the reason is given. Not a claim that it works, and not a claim that it does not. |
| not available on this host | It could not be asked; the reason is the product's own sentence. |
| unimplemented | Absent, with no row. |

### Three claims the docs made that the product does not keep

| Claim | Where | Now |
|---|---|---|
| *"on any platform an adapter exists for"* | `README.md`, `docs/README.md` | Removed; both point at the generated support matrix, which says how far each adapter has actually been driven. |
| *"one published interface over every platform"* | `docs/concepts/three-layers.md` | *"one published interface, and each platform reaches it through an adapter"*, with the unimplemented ones named and a pointer to the matrix. |
| **An AT-SPI adapter, listed among the implemented ones** | `README.md`'s layer table | There is no AT-SPI adapter — SF-23 has it unimplemented and T23 unstarted. A reader choosing a tool for a Linux desktop would have chosen this one. The row now names what exists and says AT-SPI and process/terminal are not implemented. |

### The desktop guide described the product two waves ago

`docs/guides/use-the-app.md` listed **Project** and **Explorer** among the
screens — the Explorer was removed in T15 — had no Surfaces, no four-section
rail, and said nothing about projectless startup. It is rewritten to what
shipped: Surfaces as the default screen, the connect flow, the tree and the
action inspector, dispatch and verification as two separate answers, shared
control with an agent, the four sections, and "Save as automation".

**Its screenshots are the ones the harness took** — `surfaces-empty-`,
`surfaces-connected-` and `surfaces-acting-1440x1000.png` from
`evidence/wave-4/` — and the page carries the command that regenerates them.

The guide also has a *What it does not do yet* section naming the screenshot
preview, pixel actions, Copy CLI, Copy MCP call and the connection test, so a
reader meets those limits in the guide rather than in the product.

### Every copied command runs, and the docs are the test

`tools/repo-checks/test/active-docs.test.ts` reads the documentation a *user*
reads — `README.md`, `docs/**`, `examples/**`, minus the specification and the
generated pages — and fails on:

- a Flows landing promise (SF-02: the app opens on Surfaces);
- an unqualified any/every-platform claim;
- AT-SPI named without saying it is unimplemented;
- a repository path, a fixture gateway or an unscoped package name in a
  **setup** page (SF-20);
- **a command in the surface quick start that `coverage.json` does not record
  as having been run**, or one that failed when it was.

That last one is the T20 rule the wave's contract names: the copied commands are
run by a test from the docs source, in a clean directory, from the packed
artifact. `pnpm quick-start:surface` extracts them from
`examples/surface-control/README.md` at run time and runs them there — 11 of 11.

**The check bites.** Restoring *"on any platform an adapter exists for"* to
`README.md` fails `claims no universal platform support`; removing it passes.

### The self-parity gate has a Yam side for Surfaces

`evals/self/checks.yaml` said, of driving Yam's own Surfaces screen:

> driving Yam's own Surfaces screen needs a second live surface session inside
> the one the self suite is already driving with … `app.launch` opens one
> session and there is no sentence for a nested one.

That was true of the **flow language** and had been read as true of the
product. T18 opens exactly that nested session. So `yam eval self` gains a
`yam-on-yam` source — the suite itself, mapped check name → verdict, with a
blocked check reported `unreachable` and its reason — and three checks change:

- `app.surfaces-offers-a-connect-form-and-no-prose-intent` gains a `yam` side;
- `app.opens-into-the-new-flows-screen-not-the-eleven-tabs` gains one that
  drives the packaged application rather than reading a Flows screen;
- **`app.yam-drives-the-packaged-yam-end-to-end`** is new — acceptance scenario
  8 of the mission, whose `external` side is deliberately `unreachable`: an
  external oracle for it would be a Playwright case driving the renderer by
  selector, which is precisely what "Yam controls Yam" must not be reduced to.
  Its independent oracles are separate rows.

`reports/self-parity.md` is regenerated by `pnpm self`; the Explorer's two rows
are gone with the screen.

### Seven more defects the re-run found

The parity gate had not been run since before wave 3, and running it turned up
seven things — five in the product, two in the gate itself.

| # | Defect | Fix |
|---|---|---|
| 1 | **Yam could no longer open a project through the app.** Making Surfaces the landing screen retired the welcome screen and its list of recent projects, so the only way to open one became a **native directory dialog** — which no flow can drive. Yam's verification of its own project screens collapsed from thirty checks to twelve, and nothing said so because the gate had not been re-run. | The recents come back where a project is chosen: beside the top bar's project button, while nothing is open, gone once something is. It is a better experience for anyone with two projects, and it is the gesture `app.launch-open-read-quit` names. |
| 2 | **`yam explore` did nothing at all.** Over the SDK's *stdio* transport an ordinary client disconnects by closing the server's stdin, and `StdioServerTransport` does not report that as a close — so the promise the command waits on never settled, Node exited with *"Detected unsettled top-level await"*, and no trajectory was compiled and no proposal written. No error either. The only test of it used the in-memory transport, where `close()` does fire `onclose`; SF-07 asks for "the actual subprocess transport" for exactly this reason. | `explore` also resolves on stdin `end`/`close`. |
| 3 | **`selectOption` was refused on the desktop.** The AX and UIA adapters read `value` alone; Playwright and BiDi read `value`, `values` **or** `label`, and the flow language's `Select "<label>" in the <target>` compiles to the last of them. So pattern 15 worked on the web and answered *"the selectOption action needs an argument value"* on a desktop — about an argument the caller had supplied under its other documented name. | The two native adapters read all three, and `ACTION_FORMS` carries `alsoAccepts` so the pre-dispatch validation added in T18 does not refuse them either. |
| 4 | **A repository path in a user-facing string.** The record gateway read *"fake — committed answers from evals/grounding/cases"* — a directory inside Yam's own checkout, meaningless to anyone running the installed package, and the exact thing SF-20 keeps out of what a user reads. | *"fake — committed answers, no model"*, and the note says the answers are "committed with Yam". |
| 5 | **The self flows still drove the Explorer**, removed in T15, and asserted the fake gateway note on a screen whose default gateway depends on whether the host has a display. | The Explorer story is gone, with a comment saying where its coverage went. The gateway story asserts what is true of the control rather than of one machine's default. |
| 6 | **The gate scored a run that never happened.** `yam eval self` read "the newest directory under `runs/`" for its verdicts whether or not *this* invocation produced one — so a `yam run` that stopped before its first step (a bindings file missing one field) was scored with the results of a run half an hour earlier. A gate that can publish a verdict about something that did not run is not a gate. | It records the run directories that existed before, and a run that adds none is `unreachable` with the command's own output. |
| 7 | **An expectation is evaluated once; only *resolution* retries.** `The first recent project should be absent` failed the instant it was asked, because opening a project starts a service and takes seconds. The language cannot say "wait for this to go away". | Recorded, not worked around: the flows wait by *resolving* something that exists only once the project is open (`The Save flow button should be visible`). Polling element expectations is a runtime change and is named here rather than made. |

### What the regenerated report says, and what it does not

`reports/self-parity.md` is regenerated from a real run, which is what T20 asks
for. It reads **not conformant: 4 disagreements over the 14 checks both sides
reached**, and that is published rather than smoothed:

| Check | What happened |
|---|---|
| `app.the-command-palette-opens-on-k-and-lists-the-registry-s-acti` | `no-process` — the application was gone |
| `app.agents-opens-and-every-control-on-it-is-named-and-id-d` | `no-process` |
| `app.the-data-screen-names-every-secret-and-shows-none-of-them` | `no-window` |
| `app.screen-through-two-adapters` | the attaching side read the toolbar before the project finished opening |

**Three of the four are the application disappearing mid-run, and it is not the
suite's doing.** Run on its own, the same suite passes **126 of 129 steps**:

```
node packages/cli/dist/bin.js run evals/self --host none
  → {"passed":126,"failed":1,"skipped":2} over 129 steps
```

Inside `yam eval self`, the application is terminated part-way through the `yam`
source by something else in the run — several sources launch and `pkill` the
packaged application by name, and the gate does not isolate them from one
another. Which one could not be established here, and it is stated as an open
finding rather than guessed at: **`yam eval self` does not isolate its sources
from each other's applications**, and a source that kills an application by
process name can end another source's session. That is a defect in the gate, of
the same family as the one fixed above — a gate that cannot be trusted about
what it ran.

The fourth is the project-opening race on the attaching side, fixed in the flows
and verified by hand (6 of 6 steps), which the gate then re-broke by killing the
application under it.

**None of this is in the wave's stated gate.** `pnpm -r build && -r typecheck &&
-r test && lint`, and `pnpm docs:check`, do not run `yam eval self`; it is
`pnpm self`, a separate suite of several minutes. The report is regenerated, the
disagreements are named, and the remaining cause is written down.

### One check that is now honestly one-sided

`app.the-record-review-chooses-its-gateway-and-says-what-a-fake-s` loses its Yam
side, with a reason precise enough to implement:

> the AX adapter's `selectOption` presses the control and then looks for a
> **menu item** the press opened, which is what a native macOS pop-up button
> produces. This one is Radix's select, whose options are a DOM listbox
> rendered into a portal — present in the accessibility tree, and not a menu.
> The adapter needs a second strategy: after pressing, look for an element with
> `role="option"` and the wanted name anywhere in the window.

That is a shortcoming of Yam's, said as a to-do rather than an excuse, which is
what the catalogue's `unreachable` field is for.

### Validate

| T20 Validate item | Shown by |
|---|---|
| Support matrix updated to shipped behaviour | Generated from `coverage.json`; `pnpm docs --check` keeps it current. |
| Install and setup examples are the ones that ran | `active-docs.test.ts` compares the quick start's commands with what `coverage.json` records as run. |
| Screenshots are the ones the harness took | `use-the-app.md` embeds `evidence/wave-4/surfaces-*.png` and carries the regenerating command. |
| No broken copied command | 11 of 11 run from the packed artifact, outside the workspace. |
| No unsupported universal claim | `claims no universal platform support`, demonstrated to bite. |
| No old Flows landing promise | `promises no Flows landing`. |
| No repository path or fixture gateway in a user default | `puts no repository path or fixture gateway in a setup instruction`. |
| Zero unexpected changes to user project artifacts | The T18 oracle hashes the fixture project before and after the whole suite; `git status evals/fixtures` is empty. |
| Release review with real evidence and open limitations | [`release-review.md`](../release-review.md) — every limitation named, none described as almost done. |

### Deviations

- **`tasks.md`'s boxes were all ticked, not only this wave's.** The file's
  header says "unchecked tasks are not implemented" and every box in M0–M4 was
  empty — so it was asserting that none of waves 1 to 3 existed. T18–T20 are
  this wave's; T01–T17 are ticked because their progress records and the code on
  `master` say they are done, and a task list that contradicts the repository is
  the kind of documentation T20 exists to stop. M5 stays unchecked.
- **The release review is a document, and the release is not made.** No push,
  no publish, no tag, no dispatch — the wave's own decision, restated here
  because a review that looked like a release would be the wrong artefact.
- **`docs/privacy.md`, `docs/ci.md` and `docs/finetune.md` still run the CLI
  from a checkout.** They are contributor pages, and running from a checkout is
  the right instruction there. The check is scoped to the pages a person
  follows to *install and start*.

### Known gaps

- The support matrix is generated from the most recent committed coverage run.
  Regenerating coverage on another machine and not regenerating the docs is a
  red `pnpm docs --check`, which is the intended failure.

---

## Verification of wave 4

Done against the verification contract in
[wave-4-implementation.md](../wave-4-implementation.md). The branch arrived with
T18 and T19 committed, T20 complete but **uncommitted**, and a **red gate**.
Eight defects; the two that matter most are the last two, because they are about
whether the wave's own evidence can be believed.

| # | Defect | Found by | Fix |
|---|---|---|---|
| 1 | **The gate was red.** T20 removed a repository path from a user-facing string (`"fake — committed answers from evals/grounding/cases"` → `"committed answers, no model"`, SF-20) and left two desktop tests asserting the old text. `apps/desktop` was `2 failed \| 121 passed`. | Running `pnpm -r test`. | Both tests now assert the *rule* — the note says what a fake session is, and names no `evals/` path — so the next rewording is free and the next repository path is a red build. |
| 2 | **A pass could leave the denominator.** `negative-mcp` was in neither of the two literal lists of passes blocked when the application cannot be launched, so on such a host it was not blocked, not attempted and not reported: it vanished. SF-21 exists to stop exactly that. | Reading the two lists against the passes. | One `NEEDS_THE_APP`, read by both branches, plus a check on every healthy run that every pass which ran is one such a host would block. |
| 3 | **The per-pass table was typed by hand and every row was wrong.** It claimed 18/18/18/18/8/7 against an evidence file recording 17/17/17/17/9/8, and summed to 94 where `yam-on-yam.json` says 91. | Counting the evidence the table cites. | Counted from the file, with the totals row, and the one-check difference between `negative-cli` and `negative-mcp` explained rather than smoothed over. |
| 4 | **"The packaged application opens into Surfaces" passed on every screen.** It looked for a *button named Surfaces*, which the rail carries on every screen in the application. A run in which the connect form was never on screen still reported that Surfaces was the landing screen. | A run where the check passed and the next one could not find the connect form. | Asserted by something only the Surfaces screen has — its connect form — so the check fails when the window is showing Automations. |
| 5 | **The suite adopted its own leftovers.** It clears the broker before measuring and says why, and does nothing about the **service**: the application starts one for the workspace it opens and *adopts one already serving that directory*. Quitting the application does not stop its service, so the next run's application adopted the last run's orphan. Measured: a run that followed another got eleven checks in, then answered `SESSION_CLOSED — the session has no open page`, with every later pass failing on a protocol error. None of it was a defect in Yam and all of it looked like one. | Running the suite twice. | The service is cleared with the broker, before and after. |
| 6 | **The denominator moved with the result.** A pass that stopped early recorded only what it reached, so `attempted` shrank with the failure: three runs of the same suite on the same machine reported 92, 60 and 65 attempted. A count that moves because the subject failed is not a denominator. | Running the suite repeatedly and comparing the totals. | `JOURNEY_CHECKS` declares the journey's seventeen checks; whatever is not reached is reported as a failure saying where the pass stopped. A blocked AX pass blocks all seventeen rather than collapsing to one row. |
| 7 | **A host reason invented by impatience.** The AX passes were blocked with *"an accessibility-readable window was not ready within 20000 ms"* on a run that followed another, against a helper whose own default is 45 s. macOS registers a freshly launched application's windows on its own schedule; a timeout shorter than that publishes the harness's haste as the host's limitation. | Two AX passes blocked on one run and green on the next. | The call site uses the helper's default. |
| 8 | **The committed evidence predated the code it described.** `yam-on-yam.json` was written at 17:45; `Shell.tsx` — the top bar of the very screen T18 drives — was changed at **18:11**, adding the recent-project buttons, and the suite was never re-run. Re-running it on this machine failed: a reference taken from a snapshot was gone by the time the act used it, because **Yam attaching to Yam changes what Yam is showing** (opening a session adds a row to the session list the screen draws). | Re-running the committed suite. | The journey takes its snapshot as late as possible and re-finds once if the application redrew underneath — the same *Refresh and select again* the product offers a person (SF-17). Every assertion is unchanged. All evidence in `evidence/wave-4/` is regenerated from the code as committed. |

### The reliability gap, stated rather than averaged

After the fixes the suite passes — **91 of 91 reached, 1 blocked, 92 attempted**,
which is the committed evidence — and it does **not** pass every time. Runs on
this machine during verification:

| Run | Outcome |
|---|---|
| as committed, dirty field | 24 of 33 reached passed |
| as committed, clean field | 36 of 41 reached passed |
| with the journey fixes | **91 of 91**, 1 blocked, 92 attempted |
| two consecutive, with all fixes | 57 of 57 (3 blocked) then 61 of 64 |
| two consecutive, after the cleanliness fix | 29 of 76 then 12 of 42 |
| final, into the evidence directory | **91 of 91**, 1 blocked, 92 attempted |

The failing runs share one signature: the **outer session disappears**
(`SESSION_NOT_FOUND`) around the moment the application opens its own inner
session, after which nothing can attach to the application's DevTools endpoint.
What is established: the application process is still alive, there is no crash
report, and closing an attached session and re-attaching works in isolation. In
one instrumented run both sessions sat happily in one broker on one process; in
another the outer one was gone a second after the press. It is a race and it is
**not root-caused**.

So T18's claim is true and is not yet dependable, and this suite cannot be a
gate until it is. That is the first thing wave 5 should fix, and it is named in
its prompt.

### The parity gate is not conformant, and the record did not say so

`reports/self-parity.md`, regenerated by T20, ends:

> **Not conformant.** 2 disagreement(s) over the 26 check(s) both sides reached.

Master's copy says *"100 percent agreement over the 29 check(s) both sides
reached. The gate passes only at 100 percent (REQ-SELF-2)."* The T20 section
describes the parity work at length and never states its outcome. The two
disagreements, unresolved:

- `app.screen-through-two-adapters` — the same flow through the accessibility
  tree and over CDP disagree: AX passes, CDP fails expecting *"Flows"* in the
  toolbar title. One of the two oracles is wrong, which is what a disagreement
  means.
- `app.record-opens-and-every-control-on-it-is-named-and-id-d` — Yam cannot
  resolve `app.record-fake-gateway`; the external side passes. The binding
  matches on `automationId`, so the string change of T20 is not the cause; the
  note renders only for a running fake-gateway session.

The parity gate is a report rather than part of `pnpm -r test`, so this does not
make the repository's gate red — but a wave that regenerates it owes the reader
its verdict.

### What was verified, and how

| Contract step | Result |
|---|---|
| The gate with no credential; tree clean; `pnpm docs --check` | Green after defect 1. 32 packages, lint and the derived docs. |
| The T18 suite and its transcripts | Re-run from a clean checkout of the branch. Every action on the application is a command line or a tool call in `yam-on-yam-transcript.txt`. |
| A wrong postcondition fails | Driven, both interfaces: `CHECK_FAILED`, the observed value kept, exit 20 on the command line. |
| The T19 report against the run that produced it | Regenerated: 272 of 272 reached, 5 blocked, 277 attempted. Every blocked row carries the sentence that would have to become false. |
| Packed artifacts, installed outside the workspace, copied commands verbatim | 11 of 11, read out of `examples/surface-control/README.md` at run time. |
| The fixture project unchanged | 95 files hashed before and after; no addition, modification or removal. |
| The docs checks bite | Demonstrated: restoring *"on any platform an adapter exists for"* to `README.md` fails `claims no universal platform support`; removed, it passes. |

### Known gaps after verification

- **The suite is not reliable.** Above, with the runs. Wave 5's first task.
- The parity gate is not conformant, with two named disagreements.
- `permission-denied` in the desktop is still undriven, as since wave 3.
- Windows UIA, Appium and BiDi remain unvalidated, each with its host reason.
