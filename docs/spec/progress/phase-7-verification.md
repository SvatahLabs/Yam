# Phase 7 — adversarial verification

Verifier: separate session · Date: 2026-09-05 · Subject: branch `phase-7` at `33f5dc2`
Method: clean detached worktree of `phase-7`; the six-command contract with no model credential on Node 25 and on Node 22 with `CI=true`; every claim in `docs/spec/progress/phase-7.md` re-run or probed with independently constructed inputs; the ADE packaged and driven live through the macOS Accessibility bridge with the display unlocked; the fine-tune measurement reproduced against the tuned model still in Ollama.

## The headline results, checked

- **The AX bridge is cheaper and the live gate is still unrun.** The gate ran here, on an unlocked display, for the first time: **0 of 5 flow cases and 0 of 4 healing cases pass**, with `ade.snapshot` and `ade.no-navigation` green. The window appeared, the bridge read it, and every flow case found no project open. The cause is not the bridge and not the permission (F1).
- **The Windows bridge's four defects.** Not reproducible here: the PowerShell the report says was installed is not on this machine's PATH or in the usual places. The tests that encode the four fixes pass. Blocked stays blocked.
- **The release candidate is real.** 26 tarballs from `pnpm release:dry-run`; the packed quick start passed in 11.6 s on Node 25 and 9.4 s on Node 22 in an empty project outside the workspace with no credential; the bindings tarball carries version 0.1.0, Apache-2.0, built `dist/`, and no `workspace:` range.
- **The fine-tune makes Tier 2 worse.** Reproduced exactly: 86.8 % → 13.2 %, Tier 1 unchanged at 100 %, against the same two Ollama models.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`, no credential, Node v25.6.1 | all exit 0; 2,750 vitest + 241 Playwright Test passed, 0 failed |
| `pnpm -r test` on Node v22.23.2 with `CI=true` | 2,750 + 241 passed, 0 failed |
| `git diff master..phase-7 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty |
| `./gradlew --no-daemon clean fatJar test` | BUILD SUCCESSFUL |
| `node scripts/runtime-conformance.mjs`, twice | `artifacts valid`, 40 step results, zero mismatches; reports identical below the header |
| `node scripts/runtime-conformance.mjs --strip endedAt` | exit 1, `results.jsonl line 1 — endedAt: Required` |
| `electron-forge package`, then `node scripts/desktop-conformance.mjs --adapter ax` on an unlocked display | ran all three variants; window after 12.2 s, 1.7 s, 1.2 s; **not conformant**, 2 of 9 cases green at every variant; bridge 35 nodes in 1.3 s, 38 ms per node |
| The Recent-project button pressed through the bridge (`AXPress`) | the press reached the ADE; the ADE logged `svatah serve did not print its handshake within 30000 ms. What it did say:` and nothing followed (F1) |
| The packaged binary invoked as the ADE invokes it, `<app> bin.js serve <project> --port 0` | no output, a second ADE instance appears; with `ELECTRON_RUN_AS_NODE=1` still no output, because the `RunAsNode` fuse is off |
| The unpackaged ADE under Playwright, project opened through its Recent list, project screen read through the bridge | **176–193 nodes in 9.8–9.9 s, 51–55 ms per node**, then the bridge's own 10 s deadline; the full screen is 488 nodes (F2) |
| `bridge.window()` with `timeoutMs: 180000` | still answers "did not answer within 10000 ms": the caller's deadline does not reach the script (F5) |
| `Dismiss the dialog` **after** `Click the Show confirm button` | the page says `confirmed`, as in Phase 6 |
| `Dismiss the dialog` **before** `Click the Show confirm button` | the page says `dismissed`; the suite's test uses this order and passes (F3) |
| `node scripts/finetune-eval.mjs --tuned qwen2-5-3b-svatah-q4` | tier 2 86.8 % → 13.2 %, tier 1 100 % → 100 %; exit 1 as documented |
| `pnpm release:dry-run` | 26 tarballs under `release/`, nothing published, tree clean afterwards |
| `pnpm quick-start:packed` on Node 25 and Node 22 | 11.6 s and 9.4 s of a ten-minute budget; three bindings recorded, run and heal green |
| `README.md` contract, `phase-6.md` post-verification section, packaging test's no-publish assertion | present |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on both Node versions with `typecheck` and `lint` in the contract; every published number reproduces, the fine-tune's included |
| 2 | Spec fidelity | 6 | §7.5's budget is missed by about 2.5× on the real screen; the conformance target of §16 cannot be reached because the packaged ADE cannot open a project; pattern 21's order-dependence is undocumented |
| 3 | Test integrity | 8 | Every claim the suite can reach reproduces; the packaged application is reached by no test, and the bridge cost was extrapolated from a tree five times cheaper than the real one |
| 4 | Boundaries, packaging, hygiene | 9 | 26 clean tarballs; the quick start from tarballs in an empty project; no publish anywhere; tree clean after every script |
| 5 | Phase 6 corrections | 8 | F2, F4 in the tested order, F5, F6, F7 verified; F1 improved twelve to twenty times and still over budget; F3 against recorded trees only |
| 6 | Automation guarantees and secrets | 9 | No new leak; the unarmed dialog still accepts silently |
| 7 | Reach | 6 | The AX gate now runs and fails for a reason outside the adapter; UIA unrun; the fine-tune measured and negative |
| 8 | ADE | 6 | The packaged product cannot open a project on any host, which is its first job; the unpackaged one does everything |
| 9 | Report accuracy and candour | 9 | The display claim was true when written; the regression reported without softening; the extrapolation labelled; the untested packaged app not noticed |
| 10 | Deviation discipline | 9 | Eight deviations, each with the section and the reason; D2 stricter than the words and argued |

**Overall: 7.9 / 10.** Phase 7 is accepted with corrections. The release candidate is not releasable until F1 is fixed.

## Findings

**F1 — The packaged ADE cannot open a project (REQ-ADE-2, LLD §13.6; present since Phase 3, exposed by the live gate).** `service.ts` spawns the CLI with `process.execPath`. Unpackaged, that is the Electron development binary and the script runs. Packaged, it is the ADE itself with the `RunAsNode` fuse deliberately off, so the child is a second ADE instance that prints nothing and the handshake times out after 30 s. Every path to a project in the packaged app goes through this spawn: the Recent list, the file chooser, the smoke check. `scripts/ade-smoke.mjs` launches the unpackaged build through `node_modules/electron/cli.js`, and `apps/ade/test` never launches the packaged app, so nothing could have seen it. The desktop gate launches the packaged app and then asks for a project screen that cannot exist. Draft 2.9 §13.6 states the runtime resolution and gives the gate a project without a dialog; T8.1.

**F2 — The bridge misses the §7.5 budget on the real screen (REQ-ADP-7).** Measured on the ADE's project screen with a project open: 51–55 ms per node, 176–193 nodes inside the 10 s deadline, 488 nodes on the screen, so about 25 s for one snapshot. The report's 10.39 ms per node was measured on the menu-bar tree, whose nodes are cheap, and labelled an extrapolation; the label was honest and the number was wrong by five. The bulk-read design is right and not yet bulk enough: the walk is per container, one to four events each, and a Chromium tree is mostly containers. Draft 2.9 §7.5 requires the budget to be measured on the project screen and permits reads over the whole tree at once (`properties of every UI element of entire contents`), or a native helper if that cannot meet it; T8.2.

**F3 — Pattern 21's semantics are order-dependent and the reference does not say so (LLD §3.2, §4.2).** A `dialog` step arms the answer for the *next* dialog; written after the click that opens one, it does nothing and the dialog is accepted by default with no trace. The Phase 6 finding is fixed for the order the new test uses and unchanged for the order the reference's examples suggest. Draft 2.9: the reference states the order; a lint warns on a `dialog` step that no later step in the story can trigger, and on a dialog-opening step with no armed policy where one is expected; the executor writes an audit line when an unarmed dialog is auto-accepted; T8.3.

**F4 — Two small defects in the gate and the suite.** A case with zero checks (`ade.api-client` 0/0 in one run) is reported failed with nothing to read; the healing cases run at variant 0 where they cannot mean anything and are reported failed there. T8.2.

**F5 — The bridge's deadline does not follow the caller's.** `osascriptBridge({ timeoutMs: 180000 })` still stops the script at ten seconds. Harmless for the gate, wrong for a caller that asked for more; T8.2.

**F6 — Spec drift absorbed (Draft 2.9).** The AppleScript window script and JXA elsewhere (D3); optional attributes for containers holding a control (D4); `promptText` renamed in the lowering (D5); the runtime fixture in `@svatah/schema` (D6); the shorter fine-tune schedule recorded in the digest (D7); fused fp16 weights served through Ollama (D8); the desktop legs in a `custom:` Bitbucket pipeline and the exit-code discrimination (D1, D2).

**F7 — The fine-tune.** The measurement stands and the diagnosis is plausible: 83 grammar-shaped pairs, four epochs, training loss 0.005, a validation split drawn from the same 83. What it establishes is that ADR-4's fine-tune cannot be claimed for 0.1.0. Draft 2.9 records the target as not met and makes the corpus the precondition for another attempt; T8.4.

## What was confirmed beyond the report

- The Java runtime's artifacts validate against both schemas from an independent run with secret inputs, and the artifacts carry no secret.
- The desktop gate's launch polls for a window and reports the time it took; on this host it varied from 1.2 s to 60 s across launches, and once never appeared.
- The tuned model, served at the same quantization as the base, fails the same way the report shows: right action, missing or invented arguments.
