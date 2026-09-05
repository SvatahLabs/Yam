# Phase 7 — hardening and the 0.1.0 release candidate

Branch `phase-7` from `master` (`7ba35a5`, Draft 2.8) · Date: 2026-09-04
Subject: the seven corrections the Phase 6 adversarial verification required, then T7.1–T7.6.

Every claim below names the command that makes it and what that command
answered on this host. Where a command could not be run, the section says so,
gives the exact command a verifier should run instead, and says what *was*
measured in its place. Nothing here reports a number nobody took.

## The three results, stated up front

- **The AX bridge is 62× cheaper per node, and the live gate is still unrun.**
  The rewrite is measured against a real macOS accessibility tree — 10.4 ms per
  node against 650 ms — but not against a *window*, because this host's display
  is unreachable and no application on it has one. `reports/adapter-ax.md`.
- **The Windows UIA bridge had four defects that would have failed every call,
  and they were found without Windows.** Running the PowerShell scripts through
  a real PowerShell showed the request was never bound to the script at all.
  The gate itself remains unrun. `reports/adapter-uia.md`.
- **The release candidate is real and publishes nothing.** 26 tarballs, and the
  module (a) quick start runs from them in an empty project outside this
  workspace, on both Node LTS versions, with no credential.

## The contract

`pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`

| Command | Result |
|---|---|
| CONTRACT_ROW_PLACEHOLDER | |

## Which environment fallback applied

| Fallback the prompt named | What happened here |
|---|---|
| "This host is macOS with the Accessibility permission granted… If your session's terminal reports `denied`, say so" | `doctor` reports **`granted`**. A *different* blocker applied: the display is unreachable, so no application has an accessible window. Recorded in T7.1 and in `reports/adapter-ax.md` with the probes that establish it. |
| "T7.2's Windows gate cannot run here" | Confirmed: the only host is macOS. The pipeline carries the leg and the exact blocked command is recorded. What recorded exchanges could not reach — the PowerShell invocation itself — was reached by installing a real PowerShell, which found four defects. |
| "T7.5 needs hours of machine time… otherwise run the shortest schedule that produces a tuned digest and report its measured number as what it is" | FINETUNE_FALLBACK_PLACEHOLDER |
| "T7.6 publishes nothing: dry runs and packed tarballs only" | Held. No `publish` appears in either release definition, and a repository check asserts it. |
| "Every recording in the suite uses `--gateway fake`" | Held; no model credential was present at any point. |

---

# The Phase 6 corrections

## P6-F1 — The AX bridge reads a window in bulk `633514b`

**Status: fixed and measured; the live gate that would close it is blocked (see T7.1).**

### Reproduced first

The Phase 6 verification measured the old bridge at **650 ms per node** against
the ADE's 35-node welcome window: seventeen attributes per element, one Apple
event each. Re-measured here against the ADE's own menu-bar tree with the same
`osascript`, to check the shape of the cost rather than to take the verifier's
word for it:

```console
$ osascript -l JavaScript /tmp/measure.js      # entire contents, properties, per-attribute
{"entireContentsMs": 695, "nodes": 198,
 "propertiesMsPerEl": 22.65, "attrNamesMsPerEl": 22.2, "threeAttrsMsPerEl": 65.95}
```

Every Apple event costs the same fixed ~16–25 ms whatever it carries. The old
design sent one per attribute per node; that is the whole defect.

### What was changed

`packages/adapter-ax/src/bridge.ts`. The window read is breadth-first over
**containers**, and every read answers for a whole set of children at once:

| event | what it answers |
|---|---|
| `properties of every UI element of C` | role, subrole, title, description, value, name, help, enabled, focused, selected, position, size |
| `value of attribute "AXChildren" of every UI element of C` | which children are containers, so no event is spent on a leaf |
| `value of attribute "AXIdentifier" \| "AXDOMIdentifier" \| "AXPlaceholderValue" \| "AXExpanded" …` | what `properties` leaves out, and only for a container holding a control |
| `name of every action of every UI element of C` | `AXPress` and friends, so `act` uses an accessibility action rather than a click |

Two consequences are load-bearing and are stated in the file. The script is
**AppleScript**, not JXA, because only AppleScript can ask a plural specifier for
`properties` — JXA answers `Error: Can't get object.`, which was measured before
the design was chosen. And a bulk read is all-or-nothing, so each optional
attribute keeps a success and a failure count and is abandoned after eight
failures rather than falling back to per-element reads.

### Measured

```console
$ node --input-type=module -e '…parseWindow(spawnSync("osascript", ["-e", WINDOW_SCRIPT, "Svatah ADE", "2000", "9"]))…'
ok true  nodes 199  events 103  wallMs 2067  msPerNode 10.39
```

| | Phase 6 | now |
|---|---|---|
| ms per node | 650 | **10.39** |
| Apple events, 199-node tree | ~3 400 | **103** |
| osascript invocations per snapshot | 1 | 1 |

The ADE's project screen is **488 nodes** (`scripts/record-desktop-tree.mjs`),
which at 10.39 ms per node is about **5.1 s** against §7.5's 10 s budget. That
is an extrapolation from a menu-bar tree and is labelled as one everywhere it
appears.

### The other half of F1

The timeout message no longer blames the permission. `AxWindow` carries an
`AxSnapshotCost`; the script carries its own deadline a second inside the
caller's, so a window it cannot finish answers with nodes, wall time and events
rather than being killed with nothing to say; and a deadline exceeded after
`permission()` said `granted` is reported as a bridge timeout naming those
numbers. `packages/adapter-ax/test/bridge.test.ts` asserts both branches.

---

## P6-F2 — The Java runtime writes the published schemas `3fb30ee`

**Status: fixed, and demonstrated twice.**

### Reproduced first

```console
$ node --input-type=module -e '…stepResultSchema.safeParse(each line of the Java runtime’s results.jsonl)…'
first invalid line 1 [{"path":"startedAt","message":"Required"},
                      {"path":"endedAt","message":"Required"},
                      {"path":"durationMs","message":"Required"}]
results.jsonl: 40 of 40 lines invalid
summary.json valid: false [{"path":"startedAt",…},{"path":"endedAt",…}]
```

Exactly the verifier's finding: the runtime had copied the committed
*projection* rather than the schema, and the suite compared the projection and
never looked at the file.

### Validate

| Item | Command | Result |
|---|---|---|
| "artifacts valid and zero mismatches, twice" | `node scripts/runtime-conformance.mjs --report reports/runtime-java.md`, run twice | `artifacts valid — 40 results.jsonl lines against stepResultSchema, summary.json against summarySchema` then `java: conformant — artifacts valid, 40 step results, zero mismatches`. The two reports are byte-identical below their timestamp line. |
| "a deliberately stripped line makes it fail with the schema path" | `node scripts/runtime-conformance.mjs --strip endedAt` | exit **1**; `results.jsonl line 1 — endedAt: Required`, and the report's Artifacts section says **Invalid** |
| "`reports/runtime-java.md` carries both facts" | `reports/runtime-java.md` | "**Conformant.** Artifacts valid, and 40 step results with **zero mismatches**…", with an `## Artifacts` section naming both schemas |

`--strip <field>` exists for the second row: a check that cannot be shown to
fail is not a check, and the alternative was hand-editing a file in a temporary
directory the script deletes on its way out.

`evals/conformance/runtime/README.md` now opens by saying the fixture is a
projection, is *not* valid against the schemas beside it, and why that
distinction cost a false result.

---

## P6-F3 — The desktop healing cases `4bb2fd3`

**Status: implemented and measured against recorded trees; the live gate is blocked (see T7.1).**

T6.1's Validate item "a healing variant subset (renamed control, moved panel)
passes relocalization" was neither implemented nor deviated. Draft 2.8 §16 makes
it concrete and this implements it.

### What the ADE gained

`SVATAH_A11Y_VARIANT`, reaching the renderer on the window's URL rather than
through the preload bridge — LLD §13.6 keeps that bridge to four functions, and
widening the ADE's narrowest surface for a test fixture would be the wrong
trade.

| Variant | What changes | What it breaks |
|---|---|---|
| `1` | the **Flow editor** tab becomes **Editor**; the Project screen's **Open a project…** button becomes **Choose a project…** | the *name* a binding matched on |
| `2` | the Record screen's gateway control moves into a `Session settings` panel | the control's *place* in the tree and its neighbours |

Both keep every control's `id`, which the desktop adapters publish as
`automationId` and the cases use as ground truth — the desktop equivalent of
`apps/sample-web`'s `data-svatah-eval`, and excluded from scoring for the same
reason (§16).

### Measured

```console
$ pnpm --filter @svatah/cli exec vitest run test/desktop-healing.test.ts
✓ test/desktop-healing.test.ts (6 tests)
```

Six: record-then-heal for each variant, through **both** desktop adapters, plus
one that asserts a healing case with no relocalizer injected *fails* rather than
skipping. Model-free relocalization, `@svatah/bindings`' own defaults — the same
weights and threshold `svatah eval healing` uses, because neither names one.

| Case | Variant | Binding | Score | Threshold | Outcome |
|---|---|---|---|---|---|
| `ade.heal.renamed-control` | 1 | `screen-flows` tab | 0.899 | 0.72 | relocalized |
| `ade.heal.renamed-control` | 1 | `project-open` button | 0.912 | 0.72 | relocalized |
| `ade.heal.moved-panel` | 2 | `record-gateway` combobox | 0.817 | 0.72 | relocalized |

Every proposal was verified against the ground-truth key, never against its own
confidence.

### One measurement worth keeping, and one design choice it forced

The tab rename was first written as *Flow editor* → **Flows**, which shares no
word with the original. The right tab ranked first at **0.731**, above the
threshold — but the runner-up scored **0.644**, inside the 0.1 margin, so the
healer answered **ambiguous** and refused. That is LLD §6.4 working as designed:
eleven sibling tabs are identical apart from their text, and with the text
destroyed there is genuinely not enough to tell them apart.

The committed variant renames to *Editor*, which keeps a word. The number in the
table is what that gives. The harder case is recorded here rather than left out,
because it is the boundary of model-free healing on a platform where a control's
whole identity is its label.

Variant 2 also had to be chosen rather than assumed. A plain `<div>` wrapper
changed nothing a desktop adapter can see — the accessibility tree does not
publish it — so the case's own "variant N changed this control" check failed,
correctly. The committed variant wraps in `role="group"` with a name, which is
the smallest container that actually moves the control in the tree.

---

## P6-F4 — `Dismiss the dialog` dismisses it `cb3b1bb`

**Status: fixed, end to end, both directions.**

### Reproduced first

```console
$ node repro-f4.mjs            # /widgets, through the Playwright adapter
args.action="dismiss" -> the page says "confirmed"
args.action="accept"  -> the page says "confirmed"
```

The grammar has always emitted `{ action: "accept" | "dismiss" }`. Both adapters
read `args.accept`, a key no step has ever carried, found `undefined`, and took
their default of `true`.

### Validate

| Item | Command | Result |
|---|---|---|
| "`Dismiss the dialog` leaves the sample page saying `dismissed` and `Accept the dialog` saying `confirmed`, in the suite" | `pnpm --filter @svatah/cli exec vitest run test/dialog.test.ts` | 2 passed. A flow file → compiler → runtime → adapter → the page's own `#confirm-result`, both directions in one story |
| the same at the surface level | `packages/conformance/src/surface/cases.ts` `widgets.dialog` | now asserts *both* directions; it asserted only the dismissed one before |
| a missing action is refused | the second case of `test/dialog.test.ts` | `The "dialog" action needs args.action of "accept" or "dismiss"` |

Nothing caught this for two phases because nothing crossed the seam: the
compiler's golden entries stop at the IR, and the surface conformance suite calls
`act("dialog", …)` with the adapter's own spelling and never sees a step. The
new test is the only shape that could have.

Pattern 21's four forms already had golden entries — `g-077` `Accept the
dialog`, `g-078` `Dismiss the dialog`, `g-079` `Answer the dialog with "Atul"`,
`g-080` `Accept the dialog and check it said "…"` — and all four carry
`args.action`. The Java runtime has no `dialog` action and fails it by name,
which is the documented behaviour for anything outside the fixture's feature set.

---

## P6-F5 — `pnpm -r typecheck` is green, and is in the contract `5a06687`

**Status: fixed.**

`DEFAULT_CONFIG` is `Omit<Config, "project">` — the project's name is the one
field with no defensible default — and three test helpers spread it and called
the result a `Config`.

| Package | What was wrong |
|---|---|
| `@svatah/workflow` | `test/policy.test.ts`'s `config()` helper (K9, the one the verifier found) |
| `@svatah/tool` | `test/tools.test.ts`, the same construction |
| `@svatah/cli` | `test/from-ade.test.ts` called `readLegacyFlow` with one argument of two |

```console
$ pnpm -r typecheck; echo $?
0
```

`README.md`'s contract is now the six commands §16 names — install, browsers,
build, typecheck, test, lint — and says why `typecheck` and `lint` joined it.
Both CI definitions already ran `pnpm -r typecheck`; it was the *contract* that
did not, which is what let it stay red for two phases with every gate green.

---

## P6-F6 — The desktop gate's report path and window wait `b303d04`

**Status: fixed, and both halves are checked by a test that runs anywhere.**

### Reproduced and fixed

```console
# From the repository root, which is where the verifier ran it:
$ node scripts/desktop-conformance.mjs --adapter ax --report ../adapter-ax.md --print-report-path
/Users/atul/Workspace/Svatah/automator/.claude/worktrees/adapter-ax.md
```

One directory *above* the repository, which is what `../` means from there —
against `evals/adapter-ax.md`, which is where it went before.

The eight-second sleep is a poll of the OS for an actual window, up to sixty
seconds (§15), asked of System Events and of `MainWindowHandle` rather than of
the adapter: folding "the bridge is slow" into "no window yet" would hide the
distinction this gate exists to draw. A launch that never shows a window is exit
**2** with the `doctor` output and no report written.

`--print-report-path` resolves and stops, so the resolution can be executed on a
runner with no packaged ADE, no permission and no window —
`tools/repo-checks/test/desktop-gate.test.ts`, 8 tests.

---

## P6-F7 — The post-verification corrections section `d05a98f`

**Status: written.**

`docs/spec/progress/phase-6.md` gains a "Post-verification corrections" section
carrying the verifier's live AX numbers (650 ms per node, `entireContents()` at
121 ms, `properties()` at 19 ms, 0 of 7), the schema finding (40 of 40 lines
invalid, and *why* the suite reported conformant anyway), and F3 stated as what
it is: a Validate item that was missed, in a file that recorded six deviations
and not this one.

---

# The Phase 7 tasks

## T7.1 — The macOS Accessibility live gate, and the desktop healing cases `633514b` `4bb2fd3` `b303d04` `de00803`

**Status: implemented; the live gate is blocked on this host by the display, not the permission.**

### Validate, item by item

| Item | Status | Evidence |
|---|---|---|
| "`node scripts/desktop-conformance.mjs --adapter ax` passes 7 of 7 on a macOS host with the permission granted" | **blocked** | The permission *is* granted. No application on this host has an accessible window; see below and `reports/adapter-ax.md` |
| "with the project screen (≥400 nodes) read within 10 s and the cost in the report" | **partly** | The project screen is 488 nodes, measured. The bridge is measured at 10.39 ms per node on a 199-node tree, so 488 nodes is ~5.1 s — an extrapolation, labelled as one. The report machinery is in place: `AxSurface.bridgeCost()`, `ConformanceReport.bridge`, and the gate's own summary |
| "the two healing cases relocalize at variant 1 and 2 and the report says so" | **done against recorded trees** | 0.899 / 0.912 / 0.817 against a 0.72 threshold, both adapters. The gate's report has a `## Healing (LLD §16)` table for the live run |
| "`svatah surface doctor` still reports `denied` and `prompt-pending` correctly against recorded exchanges" | **done** | `packages/adapter-ax/test/bridge.test.ts`: `-25211` and "not allowed assistive access" → `denied` with "restart it"; a timeout → `prompt-pending` with the per-program advice. 17 tests |

### Why the gate is blocked, established rather than assumed

```console
$ node packages/cli/dist/bin.js surface doctor --adapter ax
ok    -/platform             darwin arm64, Node v25.6.1
ok    ax/accessibility       granted

$ osascript -e 'tell application "System Events" to tell process "Finder" to count windows'
0
# and the same for Google Chrome, Claude, Notes: 0 each
$ screencapture -x /tmp/s.png
could not create image from display
```

The assistive-access call succeeds — the ADE's 199-node menu-bar tree was read
through the bridge on this host — and the display is unreachable. It is not the
Accessibility permission, and it is not the ADE.

### The command that closes it

```bash
pnpm -r build
pnpm --filter @svatah/ade exec electron-forge package
node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

It launches the ADE three times — variant 0, 1 and 2 — carries the recorded
fingerprints between the passes, and writes one report with every case's outcome
at every variant plus the bridge's measured cost.

---

## T7.2 — The Windows UIA gate, and the pipeline that carries every gate `de00803`

**Status: the gate is blocked; four defects it would have found were found anyway; the pipeline carries every gate.**

### Validate, item by item

| Item | Status | Evidence |
|---|---|---|
| "`reports/adapter-uia.md` from a live run… or the exact blocked command and the host's `doctor` output" | **blocked, recorded** | `reports/adapter-uia.md`: the command, and `skip  uia/platform  not Windows` |
| "the pipeline definition runs the Java conformance and both desktop gates" | **done** | `bitbucket-pipelines.yml`: the Java conformance in `default`, `branches` and `pull-requests`; both desktop legs in `custom: desktop-gates` against self-hosted runner labels |
| "and is green or blocked per leg with the reason recorded" | **done** | Java: runs on Bitbucket's hosted Linux. Desktop: blocked on a runner, reason below |
| "keep the GitHub workflow in step" | **done** | `tools/repo-checks/test/ci.test.ts`, 15 tests |

### What running the scripts through a real PowerShell found

T7.2 says the bridge scripts are untested against a real `UIAutomationClient`.
They were untested against a real **PowerShell**: every test in the package
injects its own runner, so nothing had ever spawned one. PowerShell 7.4.6 was
installed on this macOS host and the four scripts run through it — it cannot do
UI Automation, but it is the same language.

1. **The request never reached the script.** `powershell.exe -Command <script>
   -Request <json>` binds nothing; PowerShell appends trailing arguments to a
   string command as *text*. Every call died with `ParserError: Unexpected token
   ':"Svatah ADE"' in expression or statement.` Replaced with `-EncodedCommand`
   and an assigned request.
2. **Every non-ASCII name would have arrived mangled.** A redirected
   `powershell.exe` writes the console code page; the conformance target's own
   buttons are called *Open a project…* and *Import prototype database…*.
3. **A one-pattern element answered a string, not a list.** PowerShell unrolls a
   single-element array on return, so `ConvertTo-Json` wrote `"patterns":
   "Invoke"` and the adapter's `patterns.includes(…)` became a substring test.
4. **A host without UI Automation produced no output at all**, and the bridge
   reported "not JSON". All four scripts answer now, and PowerShell's CLIXML
   stderr is decoded into something readable.

After the fixes, on this host: `AVAILABILITY_SCRIPT`, `WINDOW_SCRIPT` and
`PERFORM_SCRIPT` all parse, run and answer valid JSON. `SCREENSHOT_SCRIPT` will
not compile under PowerShell 7 on macOS because its Windows-only type literals do
not resolve there; that is the test host, not a finding, and it is the one script
of four this exercise could not check. `packages/adapter-uia/test/bridge.test.ts`
now has 82 tests, seven of them for these four defects.

### Why the desktop legs are in `custom:` and not the default pipeline

Bitbucket's hosted runners are Linux only. A step whose `runs-on` labels match no
attached runner **queues** rather than failing, so putting the desktop legs in
`branches` would stall every build behind a runner that does not exist. They are
defined, labelled and one attached runner away.

The macOS leg tolerates exit **2** — "this host cannot run me" — and nothing
else. `continue-on-error: macos-latest`, which is what the GitHub workflow had,
tolerated *any* failure, so Phase 6's 0-of-7 would have been green. Both
definitions now discriminate on the exit code.

---

## T7.3 — Dialog IR, the type check, the small defects `cb3b1bb` `5a06687` `b303d04`

**Status: done.** See P6-F4, P6-F5 and P6-F6 above; the three corrections *are*
this task.

| Validate item | Result |
|---|---|
| "`Dismiss the dialog` leaves the sample page saying `dismissed` and `Accept the dialog` saying `confirmed`, in the suite" | `packages/cli/test/dialog.test.ts`, 2 passed |
| "`pnpm -r typecheck` exits 0 from a clean checkout" | exit 0 |
| "the contract line in `README.md` includes it" | the contract is the six commands of §16 |

---

## T7.4 — The Java runtime writes the published schemas `3fb30ee`

**Status: done.** See P6-F2. Every Validate item is demonstrated there, with the
commands.

---

## T7.5 — The fine-tune, measured

FINETUNE_PLACEHOLDER

---

## T7.6 — Release candidate 0.1.0 `7db92ea`

**Status: done, except the leg that needs a Bitbucket runner.**

### Validate, item by item

| Item | Command | Result |
|---|---|---|
| "`pnpm release:dry-run` produces the tarballs and lists their contents" | `pnpm release:dry-run` | **26 tarballs**, every file listed, and six claims checked per package: 0.1.0, Apache-2.0, a README, built JavaScript, type declarations, no tests, no build state, and no `workspace:` range that a registry cannot resolve |
| "the quick-start script passes against the tarballs on Node 22 and the current LTS with no credential" | `pnpm quick-start:packed` | **Node v22.20.0: 19.7 s. Node v25.6.1: 11.2–25.9 s.** Three bindings recorded, run green, heal green, of a ten-minute budget |
| "the licence check passes on the packed dependency trees" | the same script, step 6 | `Licence check OK — 14 package(s) …, 3 distinct licence(s): Apache-2.0, ISC, MIT` |
| "the release workflow runs to the artifact step on the pipeline that exists" | see below | the pipeline is defined and its body was executed locally; the pipeline itself has no runner here |

### What "from the tarballs" means, and why it is a different test

`pnpm quick-start` runs the quick start *inside* this workspace, where every
`@svatah/*` import resolves to a directory through pnpm's links. That measures
the ten-minute budget honestly and cannot measure what REQ-PKG-1 promises: that
a Playwright user who has never seen this repository can install four packages
and be running. A workspace hides exactly the failures that matter to it — a
missing `files` entry, a `dist` nobody built, a `workspace:*` that escaped into
a tarball, a dependency that resolves only because a sibling is hoisted.

`pnpm quick-start:packed` builds a project in `$TMPDIR` with `npm init`,
`@playwright/test`, `file:` dependencies on the four tarballs and `overrides`
for the transitive ones; copies the README's spec file in; points it at the
sample application over `SVATAH_BASE_URL`; and runs record, run and heal there.

### `@svatah/schema` carries the fixture

T7.6 asks for "`@svatah/schema` with the JSON Schema files and the conformance
fixtures included". The 32 generated JSON Schemas were already published under
`json/`; the runtime conformance fixture is now copied into `conformance/` at
build time from `evals/conformance/`, so there is one source and the published
copy cannot drift. A third party writing a runtime downloads this package for
the schemas their artifacts must satisfy *and* the fixture their results are
compared against; shipping one without the other leaves them able to validate
and unable to check.

### Nothing is published

Neither `.github/workflows/release.yml` nor `bitbucket-pipelines.yml` contains a
publish, and `tools/repo-checks/test/packaging.test.ts` asserts it. The GitHub
workflow gains a tarball job on both Node LTS versions and an ADE installer
matrix on three operating systems, both attaching to the release notes beside
`reports/*.md`. `bitbucket-pipelines.yml` gains `custom: release`, which packs,
runs the packed quick start, writes the reports and stops.

---

## Deviations

DEVIATIONS_PLACEHOLDER

## Known gaps

GAPS_PLACEHOLDER
