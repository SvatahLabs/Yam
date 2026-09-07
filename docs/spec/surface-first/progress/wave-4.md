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

**Status:** complete. **90 of 90 reached checks pass; 1 is blocked; 91 were
attempted.** Every interface × platform pair the wave names is reached: `yam
surface` and the MCP tools, each against the packaged application's **renderer
as a browser target** and against its **macOS accessibility tree**.

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
90 of 90 reached check(s) passed; 1 blocked; 91 attempted
```

| Pass | Interface | Platform | Checks |
|---|---|---|---|
| `cli-browser` | `yam surface` | the renderer, attached to | 18 |
| `mcp-browser` | MCP over stdio | the renderer, attached to | 18 |
| `cli-ax` | `yam surface` | macOS accessibility tree | 18 |
| `mcp-ax` | MCP over stdio | macOS accessibility tree | 18 |
| `negative-cli` | `yam surface` | the renderer | 8 |
| `negative-mcp` | MCP over stdio | the renderer | 7 |
| `launch` / `oracles` | — | the packaged application | 1 / 5 (+1 blocked) |

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
