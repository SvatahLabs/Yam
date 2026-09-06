# Phase 9 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. `master` already carries Phase 8, its verification, and Draft 2.11 of the spec. It applies the Phase 8 corrections from `docs/spec/progress/phase-8-verification.md`, then implements Phase 9 (builder surfaces, foundation).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 8 are merged on master; Phase 8 was verified at 8.9/10 with corrections required. The spec on master is Draft 2.11, which adds the builder surfaces (LLD §13.7, §13.8) and Phases 9 and 10 to docs/spec/tasks.md, and moves the release to Phase 11; do not edit the four spec documents. You will apply the corrections, then implement Phase 9.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md (§13.6, §13.7, §13.8 are the heart of this phase)
- docs/spec/tasks.md (Phase 9)
- docs/spec/design/README.md, then docs/spec/design/base.css and every file under docs/spec/design/artboards/ — the owner-approved mockups; build to them
- docs/spec/progress/phase-8.md and docs/spec/progress/phase-8-verification.md

Branching: create branch phase-9 from master. Commit after each item with "P8-F<n>: <title>" or "T9.<n>: <task title>".

PHASE 8 CORRECTIONS (before any Phase 9 task):
F1 The desktop gate can address a still-exiting ADE: it stops an instance with pkill by path and launches the next with `open -n`, and the bridge addresses the process by name, so a dying instance with no window can be the one read (one of the verifier's three runs failed both healing cases at variant 1 with `no-window`). Implement LLD §7.5 as amended in Draft 2.10: wait until no process of the previous launch remains; when several processes share the name, address the one that owns a window.
F2 The bridge cost line says nothing about load (1.6 ms per node at load average seven, 29.6 beside the test suite, on one machine). Record the one-minute load average and the CPU count beside the cost; retry an exceeded deadline once and say so in the report.
F3 Three unnamed buttons on the ADE's Project screen. Name them; make the desktop snapshot case fail on an unnamed interactive control. (Phase 9's new Flows screen must satisfy the same rule from the start.)
F4 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-8.md with the verifier's results: the packaged ADE opened by hand, the screenshot taken through the adapter (K1 closed), the gate green twice at load average seven and failed once at eleven with the no-window race, and F1 through F3.

PHASE 9 SCOPE: tasks T9.1 through T9.5 in docs/spec/tasks.md, in order. Nothing from Phase 10: the old screens stay reachable behind a "Legacy" rail item, and only Flows and Run are rebuilt.

Environment and fallbacks (state which applied in the progress file):
- This host is macOS with the Accessibility permission granted to the terminal that runs Svatah; Screen Recording depends on the terminal (`svatah surface doctor` says). A screenshot you cannot take is recorded with the doctor line, never fabricated.
- The mockups use IBM Plex Sans and IBM Plex Mono from Google Fonts; ship them as packaged font files under the OFL, never a runtime fetch.
- Python and Java clients (T9.3): Python 3 and JDK 17 are on this host; the generators must be permissively licensed (REQ-PKG-3). If a generator cannot be found under a permissive licence, write a minimal generator of your own from the OpenAPI description and say so.
- Ink and Radix are MIT. The terminal tests run under a pseudo-terminal; if none is available in CI, test the Ink renderer with ink-testing-library and say so.
- Model credential and local model server: same rules as before. Every recording in the suite uses `--gateway fake`.

Decisions already made (do not re-open):
- One headless screen model, two renderers. A screen's logic lives in @svatah/screens; the ADE and svatah ui render it and add nothing.
- The action registry is the single list behind the palette, the TUI, the SDK's `actions`, and the CLI; a repository check asserts the parity.
- Sidebar, workspace, inspector; conventional keys with a command palette on ⌘K / ^K. Dark-first, light theme, lavender accent, the status set of the mockups, every control named and id'd.
- The SDK is generated from the OpenAPI description; nothing hand-written that the description states.
- The ADE stays the desktop conformance target; the new Flows screen must be readable by the AX adapter with every control named.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. Where a mockup and the LLD disagree, the LLD wins; record it under Deviations in docs/spec/progress/phase-9.md with the section reference and the artboard. Do not edit the spec or the mockups.
3. Model calls only through the gateway and only where earlier phases allow them; the replay path stays model-free; the import-boundary lint must still pass, extended so @svatah/screens depends on the service client only and neither renderer imports a runtime package.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS and the current LTS; JDK 17.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-9.md with, per correction F1..F4 and per task T9.1..T9.5: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential, on Node 22 and the current LTS.
- The parity check's output, and its failure on a renamed action.
- The component sheet's axe-core result and a screenshot of it in both themes.
- The SDK's record-session test, and the Python and Java smoke scripts' output against a live service.
- The packaged ADE opened into the new Flows screen with the desktop snapshot case reporting zero unnamed controls; a screenshot through the AX adapter; a record and a run driven through the new Run screen under Playwright.
- `svatah ui` running `comp` in a pseudo-terminal, a capture of its panes, and `--json` output equal to the model's state.
- The live macOS gate result after F1 and F2, three consecutive runs with load figures.

When finished, print a summary table of F1..F4 and T9.1..T9.5 with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-9`:

1. Run the six-command contract with no credential on Node 22 and the current LTS; confirm `git diff master..phase-9 -- docs/spec/{requirements,hld,lld,tasks}.md docs/spec/design` is empty.
2. Rename an action in the registry and expect the parity check to fail; restore it.
3. Open the component sheet in both themes and run axe-core independently; read every control's name through the AX adapter.
4. Package the ADE, open the fixtures project, and compare the Flows and Run screens with the mockups; drive a record and a run through the buttons; take the AX screenshot.
5. Run `svatah ui` against the fixtures project in a pseudo-terminal, run `comp`, and diff `--json` against the SDK's view of the same state.
6. Run the Python and Java smoke scripts against a live service.
7. Run the desktop gate three times, once beside the test suite, and read the load figures and the retry line.
8. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
