# Phase 8 — ship

Branch `phase-8` from `master` (`77fb2b5`, Draft 2.9) · Date: 2026-09-05
Subject: the six corrections the Phase 7 adversarial verification required (F1–F6), then T8.1–T8.6.

Every claim below names the command that makes it and what that command
answered on this host. Where a command could not be run, the section says so,
gives the exact command a verifier should run instead, and says what *was*
measured in its place. Nothing here reports a number nobody took.

`git diff master..phase-8 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.

## The results, stated up front

- **The packaged ADE opens a project.** It was spawning `process.execPath` to
  run `svatah serve`; packaged, with the `RunAsNode` fuse off, that is the ADE
  itself. Worse than the verifier found: the child inherited `SVATAH_ADE_SMOKE`
  and spawned another, and reproducing F1 here reached **594 ADE processes**.
  The runtime is resolved now, the packager ships the CLI it never shipped, and
  the packaged application opens the fixtures project and shows its eleven tabs.
- **The macOS gate is green, live, against the packaged ADE.** 7 of 7 flow cases
  at variant 0 and both healing cases relocalized at variants 1 and 2. The
  project screen — 588 nodes — reads in **879–999 ms, 1.49–1.7 ms per node** on
  an idle machine, against §7.5's ten seconds and the 51–55 ms per node the
  verifier measured. Under load it is slower and still inside the budget; the
  numbers and the one run that was *not* are in T8.2.
- **The Draft 2.9 §7.5 form the spec suggests does not work, and is not what
  was used.** `properties of every UI element of entire contents of window 1`
  answers `-1700` from System Events, as does every variant of it. The section's
  other option — a native helper reading `AXUIElement` — is what the bridge uses,
  through JXA's Objective-C bridge, with nothing installed and nothing compiled.
- **The fine-tune is withdrawn and the corpus exists.** 184 reviewed pairs of a
  sentence the grammar refuses and the step it means, every one of them
  compiled by a repo check and required to come back `E_NO_MATCH`.
- **Publishing is prepared and not triggered.** `node scripts/publish.mjs`
  prints the twenty-six exact commands and refuses on three separate guards.

And one thing that could not be done here: **no screenshot was taken through the
AX adapter**, because `screencapture` needs the Screen Recording grant and this
process tree does not have it. The exact command and its answer are in T8.2.

---

## The verification contract

```
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && \
  pnpm -r typecheck && pnpm -r test && pnpm lint
```

From a clean detached worktree of `phase-8` at `663ff49`, with
`ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` unset:

| Node | Result |
|---|---|
| v25.6.1 (current) | all six exit 0; the tree is clean afterwards |
| v22.23.2 (LTS), `CI=true` | all six exit 0 |

On Node 22, `pnpm -r test` reports **3,160 vitest tests passed, 0 failed** across
26 packages plus the Playwright Test suites of `@svatah/playwright-test` and
`@svatah/host-playwright`. Node 25 is the same set. Neither run had a model
credential; `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` were unset for both.

---

## Phase 7 corrections

### F1 — the packaged ADE cannot open a project (T8.1)

**Reproduced first**, exactly as the verifier described and then some.

```console
$ pnpm --filter @svatah/ade exec electron-forge package
$ APP="apps/ade/out/Svatah ADE-darwin-arm64/Svatah ADE.app/Contents/MacOS/Svatah ADE"

# (a) with no environment at all: there is no CLI in the package
$ env -u SVATAH_CLI SVATAH_ADE_SMOKE="$PWD/evals/fixtures" "$APP"
svatah-ade smoke failed: Error: Could not find the svatah CLI. Looked in:
  …/Svatah ADE.app/Contents/Resources/svatah/bin.js

# (b) with the workspace CLI, which is what every test and every gate did
$ SVATAH_ADE_SMOKE="$PWD/evals/fixtures" SVATAH_CLI="$PWD/packages/cli/dist/bin.js" "$APP"
svatah-ade smoke failed: Error: `svatah serve` did not print its handshake within 30000 ms.
What it did say:
```

Two facts the verification did not have:

1. **The packaged application contained no CLI at all.** `Resources/svatah/` did
   not exist. `SVATAH_CLI` hid it: the smoke check set it, the desktop gate set
   it, and `apps/ade/test` never launched a packaged app. So the first failure a
   person downloading the ADE would hit is not the handshake — it is that there
   is nothing to hand a runtime to.
2. **The spawn was a fork bomb.** The child ADE inherited `SVATAH_ADE_SMOKE`,
   ran the smoke check, opened the project, and spawned another.
   `ps ax | grep -c "Svatah ADE"` reached **594** while reproducing (a) and (b).

**What was implemented** — Draft 2.9 §13.6, in full:

| §13.6 says | Where |
|---|---|
| resolve `SVATAH_NODE`, then a `node` on `PATH` of the supported major or newer, then a Node beside the CLI under `resources/` | `packages/service/src/runtime.ts` |
| never `process.execPath` | `apps/ade/src/main/service.ts` takes `runtime` as an option; a test asserts the resolution never answers `process.execPath` |
| the Project screen's alert names the three places | `runtimeNotFoundMessage`, rendered by `App.tsx`'s `role="alert"` |
| `doctor` and the smoke check report the chosen runtime | `svatah surface doctor`'s `ade/node-runtime` check; the smoke line's `runtime: …` |
| `SVATAH_ADE_PROJECT=<dir>` opens a project on ready | `apps/ade/src/main/index.ts`, announced on `service:opened` |
| the smoke check runs against the packaged application when one exists under `apps/ade/out/` and says which | `scripts/ade-smoke.mjs` |
| the desktop gate passes the fixtures project that way | `scripts/desktop-conformance.mjs` |

The resolver lives in `@svatah/service` under a `./runtime` subpath export
because two programs need it — the ADE, to spawn; and `doctor`, to say what the
ADE *would* choose without launching it — and the ADE's main bundle must not
pull Fastify in behind it.

`scripts/stage-ade-cli.mjs` stages a `pnpm deploy` of `@svatah/cli` into
`apps/ade/.stage/svatah`, and Forge copies it to `Resources/svatah` as an
`extraResource` — outside the asar, because a program inside one cannot be
spawned. No Node binary is staged: §13.6's third place is "when the packager
includes one", and shipping one would make T8.1's `PATH`-emptied case pass for
the wrong reason.

**Validated:**

```console
$ pnpm --filter @svatah/ade package     # stages the CLI, then packages
$ pnpm ade:smoke
svatah-ade smoke target=packaged (…/Svatah ADE.app/Contents/MacOS/Svatah ADE)
svatah-ade smoke ok project=…/evals/fixtures flows=7 stories=22 window=open packaged=yes
  runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)

# with PATH emptied: the alert, and nothing opened
$ env -i HOME="$HOME" PATH="" SVATAH_ADE_SMOKE="$PWD/evals/fixtures" "$APP"
svatah-ade smoke failed: Error: The Svatah ADE could not find a Node 22 or newer to run
`svatah serve` with, so no project was opened. It looked in three places:
  • the SVATAH_NODE environment variable: not set
  • a `node` on PATH: PATH is empty
  • a Node shipped beside the CLI under `resources/` — …/Resources/svatah/node: no Node is
    packaged here
Install Node 22 LTS (or newer) so that `node` is on PATH, or set SVATAH_NODE to the
interpreter you want used, and open the project again.
```

**The eleven tabs**, read out of the packaged application through the
accessibility API, with the project opened by `SVATAH_ADE_PROJECT`:

```console
$ open -n -F --env SVATAH_A11Y=1 --env "SVATAH_ADE_PROJECT=$PWD/evals/fixtures" \
    -a "apps/ade/out/Svatah ADE-darwin-arm64/Svatah ADE.app"
$ node -e '…osascriptBridge("Svatah ADE").window(…)…'
root=AXWindow nodes=588 wallMs=904 msPerNode=1.54 axCalls=9413 truncated=false tabs=11
  screen-project, screen-flows, screen-plan, screen-run, screen-results, screen-api,
  screen-data, screen-record, screen-bindings, screen-explorer, screen-tools
```

**The gate's variant 0 log shows the project screen open before the first case**
— see T8.2.

**`pnpm ade:smoke` in CI on the three-OS matrix**: `.github/workflows/ci.yml`'s
`ade-installers` job runs `pnpm ade:smoke` after `make`, on
`ubuntu|macos|windows-latest`. `make` fills `apps/ade/out/`, so the smoke check
picks the packaged application. Not run here — this host is one of the three —
and the line it prints says which target it used, so a CI log settles it.

### F2 — the bridge misses the §7.5 budget on the real screen (T8.2)

**Reproduced first.** The Phase 7 bridge, against the packaged ADE's project
screen with the fixtures project open:

```
176–193 nodes in 9.8–9.9 s, 51–55 ms per node, then the bridge's own 10 s deadline
```

**The form Draft 2.9 suggests does not work.** §7.5 offers "`properties of every
UI element of entire contents of window 1` and one further event per optional
attribute". System Events refuses it, and every variant of it:

```console
$ osascript -e 'tell application "System Events" … properties of every UI element of
    entire contents of window 1 of proc'
ERR -1700 System Events got an error: Can’t make every UI element of e…
$ … 'properties of entire contents of window 1 of proc'
ERR -1700 System Events got an error: Can’t make properties of entire…
$ … 'value of attribute "AXRole" of entire contents of window 1 of proc'
ERR -1700 System Events got an error: Can’t make attribute "AXRole" of…
```

`entire contents` yields object specifiers one at a time and nothing else, which
is the per-element read the budget is about. So the section's *other* option is
what was implemented: "a native helper that reads `AXUIElement` directly when
the process-based bridge cannot reach 10 s".

**The helper is JXA.** `osascript -l JavaScript` reaches
`AXUIElementCopyAttributeValue` through the Objective-C bridge and macOS's own
BridgeSupport metadata: no Apple events, no `node-gyp`, no compiler on the
installing machine, nothing outside a permissive licence (REQ-PKG-3). The
process bridge is kept for actions, as the phase's decision allows.

**Measured, on the ADE's project screen with a project open**, five consecutive
reads through the adapter on an idle machine:

| | |
|---|---|
| nodes | 588 (§7.5 requires ≥ 400) |
| wall time | 879–999 ms |
| ms per node | **1.49–1.7** |
| accessibility calls | 9,413 |
| `osascript` invocations | 1 |

**And what it costs under load**, because the budget is a wall-clock one and
this is the honest range on one machine:

| Machine | nodes | wall | ms/node | Gate |
|---|---|---|---|---|
| idle | 588 | 879–999 ms | 1.49–1.7 | conformant |
| load average ≈ 8 | 588 | 3,556 ms | 6.05 | conformant |
| a full `pnpm -r test` running alongside | 362 | 9,361 ms | 25.86 | **not** conformant |

The third row is the design working rather than failing: the read exceeded the
caller's ten seconds, and §7.5's sentence — "a deadline exceeded after `doctor`
reported `granted` is reported as a bridge timeout with those numbers, never as
a permission prompt" — is what the case report says, with the node count, the
wall time, the cost per node and the call count in it. A verifier who runs the
gate beside a build will see that, and it is a true statement about the machine
rather than about the adapter. It is recorded as K7 below.

**The gate:**

```console
$ node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
ok    -/platform             darwin arm64, Node v25.6.1
ok    ade/node-runtime       runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)
ok    ax/accessibility       granted
warn  ax/screen-recording    refused — could not create image from rect
variant 0: the ADE's window appeared after 1222 ms
variant 0: the project screen was open after 2646 ms (…/evals/fixtures)
variant 1: the ADE's window appeared after 1187 ms
variant 1: the project screen was open after 1343 ms (…/evals/fixtures)
variant 2: the ADE's window appeared after 1212 ms
variant 2: the project screen was open after 1469 ms (…/evals/fixtures)
"ax" is conformant — 9 cases across variants 0, 1 and 2 → reports/adapter-ax.md
```

`reports/adapter-ax.md`: **conformant**, 7 of 7 at variant 0 (30 checks), both
healing cases relocalized at variants 1 and 2. Green on four separate end-to-end
runs; the committed report is from the last of them, whose bridge line is 588
nodes in 3,556 ms because the machine was still busy — see the load table above.

Two things the gate needed before it could be green, both measured:

- **A GUI application forked from this session never gets a window.** A direct
  `spawn` of the packaged binary was polled for 37 s and answered `windows=0` at
  every step, through both System Events and the accessibility API, while the
  same build opened with `open -n` answered `1`. The gate uses `open` on macOS
  now, which hands the launch to LaunchServices and the session a person is
  looking at. This is almost certainly what "once did not appear" was.
- **`ade.result` asked for "something naming a run" case-sensitively**, which the
  fixtures project's empty `runs/` — the directory is git-ignored — could not
  satisfy: the screen renders `Runs (0)` and an explanation. The case reads the
  screen's own count now and checks what goes with it, which is true at every
  project state and stricter than what it replaces.

### F5 — the bridge's deadline does not follow the caller's (T8.2)

**Reproduced:** `osascriptBridge({ timeoutMs: 180000 }).window(…)` stopped at
ten seconds, because `window()` read only `windowDeadlineMs`.

The deadline is per-call, then window-specific, then the session's `timeoutMs`,
then §7.5's default of 10 s. The script's own budget is the caller's less the
`osascript` process overhead, so an exceeded deadline answers with numbers
rather than being killed with none:

```console
$ …window({ maxNodes: 3000, deadlineMs: 1000 })
AxBridgeError: The accessibility bridge did not finish reading the window of "Svatah ADE"
within 1000 ms: 294 nodes in 533 ms (1.81 ms per node, 4709 accessibility calls,
1 osascript invocation). The Accessibility permission is granted, so this is the bridge's
own budget (LLD §7.5), not a permission prompt.

$ osascriptBridge({ timeoutMs: 60_000 }).window({ maxNodes: 3000 })
60s deadline -> 588 nodes in 872 ms, truncated=false
```

### F4 — a case with no checks, and healing cases at variant 0 (T8.2)

§7.5: "A conformance case with no checks is reported as skipped, not failed; a
healing case is run only at the variant it is about."

- A case that ran and observed nothing is `skipped` with the reason. It used to
  be `passed` — counted towards "7 of 7" while establishing nothing.
- A healing case at variant 0 records the baseline the later pass needs and
  reports `skipped` with "recorded N binding(s) at variant 0; this case is
  measured at variant N". A recording it *could not* make is still a failed
  check, so a silent no-op cannot pass for a skip.

The report shows it: at variant 0 both healing cases are `skipped`; at variant 1
`ade.heal.renamed-control` passes 8/8 and everything else is skipped; at variant
2 `ade.heal.moved-panel` passes.

Covered by three tests in `packages/conformance/test/surface-suite.test.ts`.

### F3 — pattern 21 is order-dependent and undocumented (T8.3)

**Reproduced:**

```console
# click first: the page says "confirmed" and the flow said "dismiss"
$ svatah run   # story: Go to /widgets; Click the show confirm button; Dismiss the dialog
audit.jsonl:   {"kind":"dialog","armed":false,"answer":"accept", … "message":"Are you sure?"}
```

**What was implemented** — Draft 2.9 §3.2 and §4.2:

- `docs/flow-language.md` pattern 21 is rewritten around the arming order, with
  a worked example, the two-dialog case, the counter-example *labelled* as one,
  and the audit line it produces.
- `W_DIALOG_UNARMED` and `W_DIALOG_NEVER_OPENED` in `lintPlan`. The arming is
  **counted**, not merely looked for: one `dialog` step arms one dialog, so a
  story that arms once and clicks twice is the same defect one step later. Only
  stories that answer dialogs are checked — every click in every flow can open
  one in principle and warning about all of them is a warning nobody reads —
  and a story's *first* `navigate` is not an opener, because there is no page to
  leave and every example begins with one.
- The executor writes the audit line, for the armed case as well as the unarmed
  one: a log that records only the mistake is an alarm rather than an account.

**Validated:**

```console
$ pnpm --filter @svatah/cli exec vitest run test/dialog.test.ts
 ✓ dismisses what it is told to dismiss and accepts what it is told to accept
 ✓ lints the click-then-dialog order and records the default it took
 ✓ records an armed answer as armed, so the line is an account and not an alarm
 ✓ refuses a dialog step with no action rather than accepting one

$ pnpm --filter @svatah/repo-checks exec vitest run test/lint-golden.test.ts
 ✓ 15 tests — the eight golden entries, and the reference's own examples read out
   of docs/flow-language.md and linted
```

`evals/compiler/lint.jsonl` holds the golden entries. The reference's examples
are read *out of the document* rather than repeated in the test: pattern 21 was
wrong in the reference for two phases while every test passed, and a check that
quoted the doc would have kept passing through that.

One defect found on the way, which every run would have hit: the audit proxy
wrapped **every** function on a surface, so `dialogLog()` returned a Promise and
the executor died with "not a function or its return value is not iterable".
Accessors — `capabilities`, `bridgeCost`, `dialogLog`, `browser` — are not
surface calls and are not wrapped.

### F6 — the Phase 7 progress record (done)

`docs/spec/progress/phase-7.md` gains a "Post-verification corrections" section
with the verifier's live gate result (2 of 9 at every variant, the handshake
failure, 51–55 ms per node on the project screen, the deadline that did not
follow the caller), F1 through F7 as they were found, and the one thing that
file got wrong about its own environment.

---

## Phase 8 tasks

### T8.1 The packaged ADE opens a project

Done; see F1 above for the reproduction, the implementation and every Validate
item. Commit `2d738e9`.

### T8.2 The AX bridge within budget, and the macOS gate green

Done; see F2, F4 and F5 above. Commit `1a62941`.

| Validate item | Answer |
|---|---|
| 7 of 7 plus both healing cases, live, permission granted, display unlocked | `reports/adapter-ax.md` — conformant, 9 cases across variants 0, 1 and 2 |
| the report's bridge line is a snapshot of the project screen (≥400 nodes) within 10 s | 588 nodes in 914 ms |
| a `window()` call with a 60 s deadline is allowed to run 60 s | shown above |

**Not done: the screenshot through the AX adapter.** `screencapture` refuses on
this process tree:

```console
$ screencapture -x -R 95,33,1280,849 /tmp/probe.png
could not create image from rect
$ echo $?
1
$ node packages/cli/dist/bin.js surface doctor --adapter ax
ok    ax/accessibility       granted
warn  ax/screen-recording    refused — could not create image from rect
      → Screenshots come from `screencapture`, which needs Screen Recording — a different
      → grant from Accessibility. …
```

Screen Recording is a separate TCC grant from Accessibility, and the process
tree running this session does not have it. The accessibility tree reads
perfectly, which is why the gate is green and the screenshot is not there. A
verifier on a terminal with the grant closes it with:

```console
$ open -n -F --env SVATAH_A11Y=1 --env "SVATAH_ADE_PROJECT=$PWD/evals/fixtures" \
    -a "apps/ade/out/Svatah ADE-darwin-arm64/Svatah ADE.app"
$ node -e 'const {osascriptBridge}=await import("./packages/adapter-ax/dist/index.js");
    const b=osascriptBridge({process:"Svatah ADE"}); await b.permission();
    const w=await b.window({process:"Svatah ADE",maxNodes:3000});
    await b.screenshot("reports/images/ade-project-screen-ax.png", w.nodes[0].box);'
```

`svatah surface doctor` gained the advisory check so that whoever finds an empty
screenshot directory has a line to read. It is advisory rather than fatal
because a run without it keeps every result and loses only its pictures, and
making it fatal would stop a conformance gate that would have passed.

### T8.3 Dialog arming: documented, linted, audited

Done; see F3 above. Commit `4ee30bd`.

### T8.4 The fine-tune withdrawn from 0.1.0, and the corpus that would bring it back

Commit `5f749db`.

**The withdrawal** is in `reports/eval-finetune.md` — written by
`scripts/finetune-eval.mjs` rather than by hand, so a regeneration cannot
quietly drop it — and in `CHANGELOG.md` under "Withdrawn from 0.1.0". The
measurement was re-run here and reproduces exactly:

```console
$ node scripts/finetune-eval.mjs --tuned qwen2-5-3b-svatah-q4
tier 2: 86.8 % → 13.2 % (-73.7) → reports/eval-finetune.md
```

**The corpus.** `svatah eval finetune corpus` collects three sources and says
what each contributes:

```console
$ node packages/cli/dist/bin.js eval finetune corpus
Tier 2 corpus — sentences the grammar refuses (T8.4, ADR-4)

  test-set    38 found,    0 exported  evals/compiler/golden.jsonl
  candidate   38 found,    0 exported  evals/migrate/expected/migration-review.md
  reviewed   184 found,  184 exported  evals/compiler/refused.jsonl

  184 training pair(s); excluded 0 in the golden set and 0 duplicate(s).
```

`evals/compiler/refused.jsonl` is seeded with **184** reviewed (sentence, Step)
pairs across 30 actions, above the 150 T8.4 asks for. Every one is put through
the compiler by `tools/repo-checks/test/refused-corpus.test.ts` and has to come
back `E_NO_MATCH`; every step has to be a shape a Tier 2 answer can have; and
the corpus shares no sentence with the golden set.

```console
$ node packages/cli/dist/bin.js eval finetune export
exported 184 pair(s) from the Tier 2 corpus → evals/compiler/finetune/pairs.jsonl
  sources: evals/compiler/golden.jsonl (0), …/migration-review.md (0), …/refused.jsonl (184)
  excluded: 0 in the golden set, 0 duplicate
```

Two things found while building it:

- **`asExample` dropped `target2`.** `modelStepSchema` has had it since Draft 2 —
  it is what `dragTo` and `hoverAndClick` need — so every `dragTo` example in the
  Tier 2 prompt showed the model a drag with a source and nowhere to put it.
- **`modelStepSchema` has no `invoke`.** Five sentences the grammar does refuse
  (`Run "Sign in" before anything else`) would have exported as
  `{"action":"invoke"}` with the story name lost. They are out of the corpus and
  `evals/compiler/README.md` says why.

**No training run was made** against the new corpus and none is claimed.

### T8.5 Publish 0.1.0

Commit `557a9a1`.

```console
$ node scripts/publish.mjs
svatah 0.1.0 — 26 package(s) under @svatah, in dependency order.

  npm publish release/svatah-schema-0.1.0.tgz --access public
  npm publish release/svatah-surface-0.1.0.tgz --access public
  … 24 more …

Nothing was published. The reasons:
  • `--publish` was not passed (this is a dry run)
  • there is no manual trigger: a GitHub `workflow_dispatch`, or Bitbucket's
    `custom: publish` pipeline with SVATAH_PUBLISH_TRIGGER=manual
  • NPM_TOKEN is not set
$ echo $?
0
```

Each guard was exercised on its own:

| Environment | Exit | Reason given |
|---|---|---|
| `--publish`, `NPM_TOKEN=x`, no trigger | 1 | no manual trigger |
| `--publish`, `GITHUB_EVENT_NAME=workflow_dispatch`, no token | 1 | NPM_TOKEN is not set |
| `--publish`, `BITBUCKET_PIPELINE_UUID` + `SVATAH_PUBLISH_TRIGGER=manual`, no token | 1 | NPM_TOKEN is not set |
| `--publish`, `BITBUCKET_PIPELINE_UUID` + `NPM_TOKEN=x`, no `SVATAH_PUBLISH_TRIGGER` | 1 | no manual trigger — a branch build cannot publish |
| no flags (a dry run) | 0 | prints the commands |

The tarballs it names are the ones `pnpm release:dry-run` packed, which the
packed quick start installed and the licence check checked. Publishing a
*directory* would publish whatever is on disk now.

`bitbucket-pipelines.yml` gains `custom: publish` and
`.github/workflows/release.yml` a dispatched `publish` job, each after the pack,
the packed quick start and the reports, and each waiting on the jobs that attach
the ADE installers and `reports/*.md`. **Neither has been triggered**, and no
token exists in this environment.

`CHANGELOG.md`'s 0.1.0 entry lists what is in (the published packages and what
was added), what is measured (a table of every number and the report it is in),
and what is withdrawn (the fine-tune, with its number).

### T8.6 The Windows UIA gate (carried)

Commit `663ff49`. **Blocked, unchanged from Phase 7.** No Windows host, and this
machine no longer has the PowerShell 7 install through which T7.2's four defects
were found:

```console
$ node scripts/desktop-conformance.mjs --adapter uia --report reports/adapter-uia.md
The "uia" adapter runs on win32 and this host is darwin, so the conformance suite was not
run and nothing was written to …/reports/adapter-uia.md.
$ echo $?
2
$ node packages/cli/dist/bin.js surface doctor --adapter uia
ok    -/platform             darwin arm64, Node v25.6.1
ok    ade/node-runtime       runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)
skip  uia/platform           not Windows
$ which pwsh powershell powershell.exe
pwsh not found / powershell not found / powershell.exe not found
```

`reports/adapter-uia.md` carries all of it, plus the three harness changes
underneath the gate that a Windows run will exercise for the first time. One fix
while re-attempting it: the gate used to launch an ADE and wait sixty seconds
before noticing that `uia` cannot run on macOS, because `doctor` answers `skip`
and exits 0. It refuses a host that cannot run the adapter now, with exit 2.

---

## Deviations

**D1 — the AX window read is a native helper, not the whole-window Apple-event
form (§7.5).** Draft 2.9 offers `properties of every UI element of entire
contents of window 1` first and a native helper second. The first does not work:
System Events answers `-1700` to it and to every variant of it, with the exact
output in F2 above. The second is implemented, in JXA through the Objective-C
bridge rather than as a compiled module, so nothing has to be installed or built
on an installing machine (REQ-PKG-3). The process bridge is kept for actions, as
the phase's decision requires.

**D2 — `AxSnapshotCost.appleEvents` is renamed `axCalls` (§7.5).** The section
asks the report to record "nodes read, wall time, and milliseconds per node",
which are unchanged. The fourth number was Apple events, and a native helper
sends none; a report that said "Apple events: 9,413" would be false.
`BridgeCost.appleEvents` is kept in the type for a Windows bridge that counts
something equivalent.

**D3 — the preload bridge exposes a sixth entry, `onServiceOpened` (§13.6).**
§13.6 names four callable functions; `onServiceLog` has been a fifth since Phase
3. `SVATAH_ADE_PROJECT` opens a project before the renderer exists, so there is
no call for the renderer to await, and the answer — a connection, or the message
the Project screen shows as its alert — has to reach a screen that did not ask
for it. It is one-way, has no handler on the other end, and can start nothing
and read nothing.

**D4 — the desktop gate launches the ADE through `open` on macOS.** A GUI
application forked from a process outside the user's Aqua session never attaches
to the WindowServer: measured, `windows=0` for 37 s, against `1` for the same
build opened with `open -n`. The gate is about the window a person sees, and
LaunchServices is the platform's way of putting an application in that session.

**D5 — `svatah eval finetune export` no longer takes `--ref` or `--project`
(§15's command table).** T8.4's Do says "export pairs from that corpus only", and
the corpus is three committed files rather than a git ref. The flags are gone
rather than accepted and ignored. The command table's row also says "exports
only from merged flows", which is the behaviour T8.4 replaces because it is what
made the tuned model worse.

**D6 — `svatah surface doctor` gains an advisory severity.** A failed Screen
Recording grant is reported as `warn` and does not change the exit code. Making
it fatal would stop a desktop conformance gate that would otherwise pass, since
the accessibility tree needs no such grant; leaving it out entirely means an
empty screenshot directory with nothing to read.

**D7 — the packaged ADE grew by 145 MB.** `Resources/svatah` is a `pnpm deploy`
of `@svatah/cli` with its dependencies, so the `.app` is 442 MB rather than 287
MB. §13.6 requires a bundled CLI and the CLI's dependency tree is what it is.

---

## Known gaps

**K1 — no screenshot through the AX adapter on this host.** Screen Recording is
not granted to this process tree; the exact command, its output and the
closing command are in T8.2. Nothing else in the phase depends on it.

**K2 — the Windows UIA gate is unrun.** T8.6, above.

**K3 — `pnpm ade:smoke` against the packaged app has run on macOS only.** The
three-OS matrix is in `.github/workflows/ci.yml` and the packaged-app lookup
finds the Linux and Windows executables by scanning rather than by guessing
their names, but neither has been executed here.

**K4 — nothing is published.** By design (T8.5). The pipeline exists, its dry
run prints the commands, and the owner triggers it.

**K5 — the compiler golden set holds 222 entries against REQ-COMP-9's 300.**
Inherited, unchanged by this phase, and not in Phase 8's scope; the new
`evals/compiler/refused.jsonl` (184) and `evals/compiler/lint.jsonl` (8) are
separate corpora and do not count towards it.

**K7 — the AX gate is sensitive to machine load.** The budget is wall-clock and
the numbers above span 1.5 to 26 ms per node on one machine depending on what
else is running; a gate run beside a full `pnpm -r test` exceeds ten seconds and
fails. It fails *with the numbers*, which is what §7.5 asks for, but a CI runner
that packs the desktop leg beside anything else will see it. The margin at idle
is about eleven times.

**K6 — the desktop conformance suite reads the ADE's project screen with an
empty `runs/`.** `ade.result` checks the screen's own count and what goes with
it, which is true at every state, but the branch that asserts a table of runs
has not been exercised: closing that needs the gate to make a real run against
`apps/sample-web` first.
