# Surface-first wave 4 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, on `master` with wave 3 merged. It is milestone M4 — **T18, T19, T20** from [tasks.md](tasks.md): prove the mission through Yam's own public interfaces, publish coverage that says what was reached, and finish the migration of the docs and the release review.

Waves 1–3 built the core, the transports and the desktop. Every claim so far has been proved by a harness that drives the built renderer in a browser (`apps/desktop/test/surfaces-dogfood.mjs`) and by tests that drive the built binary, a real service and a real MCP subprocess. What does not exist yet: Yam controlling the *packaged* Yam through `yam surface` and MCP; a coverage report with a reachability denominator; docs that describe what shipped.

It excludes M5 (Streamable HTTP MCP, process/PTY, AT-SPI, native/mobile expansion). Nothing is published in this wave either.

**Read wave 3's verification first.** Nine defects reached its branch on top of the twelve from waves 1 and 2, and the shape repeated: the driven checks never *acted after taking control*, never ran at 200%, never took the keyboard past the connect field, and used an HTTP client where the requirement said "agent". See [progress/wave-3.md](progress/wave-3.md), "Verification of wave 3".

---

## Prompt

```
You are implementing wave 4 of Yam's surface-first direction. Waves 1–3 are merged on master.

What exists: `packages/surface-control` — a catalogue of fourteen operations that is the single source for the CLI, the MCP tools and the service's routes; a broker that owns sessions across processes, with control leases, deadlines, idempotency, snapshot-scoped references, a redacted event stream and per-session promotion steps; `yam surface targets|connect|snapshot|describe|capabilities|act|read|check|control|events|request|screenshot|close|sessions`; the same fourteen as MCP tools over stdio, served by the same broker; the desktop with Surfaces as the default screen — discovery, connect, the action inspector, shared control with an agent, "Connect an agent", "Save as automation" — driven at 1440×1000 and 1280×800 at 100% and 200% zoom and by keyboard alone, with every SF-17 state except permission-denied driven for real.

What does not exist: Yam driving the packaged Yam through its own public interfaces; a coverage report that says what was attempted, reached, passed, failed and blocked per platform and interface; docs, support matrix and screenshots that describe what shipped; a release review with real evidence.

Read, in this order, and treat them as the source of truth:
- docs/spec/surface-first/README.md
- docs/spec/surface-first/requirements.md — SF-09, SF-18, SF-20, SF-21 are this wave's, and the P0 portions of SF-01..SF-21 for T20
- docs/spec/surface-first/design.md
- docs/spec/surface-first/tasks.md — T18, T19, T20
- docs/spec/surface-first/progress/wave-1.md, wave-2.md, wave-3.md — what was built, and the twenty-one defects verification found across three waves
- docs/spec/{requirements,hld,lld,tasks}.md — Draft 2.25
- apps/desktop/test/surfaces-dogfood.mjs — the harness T18 promotes; evals/self and reports/self-parity.md — what it replaces

Branching: create branch surface-first-wave-4 from master. Commit after each task with "T<nn>: <task title>".

WAVE 4 SCOPE, in order:

  T18  Make Yam control the real packaged Yam.
  T19  Publish coverage and performance.
  T20  Finish migration and release review.

Nothing else. No Streamable HTTP MCP, no process/PTY, no AT-SPI. Those are M5 and their tasks stay unchecked.

DECISIONS ALREADY MADE (do not re-open):

- Everything is local and unpublished. No push, no npm publish, no tag, no release dispatch, no GitHub release. The release *review* is a document with evidence; the release itself is the owner's.
- The public interfaces are the only way T18 drives the app: `yam surface` and the MCP tools, through the broker, against the packaged desktop launched as a native target (AX on macOS) and its renderer attached to as a browser target. No selector-based Playwright against the renderer counts as "Yam controls Yam"; the browser-hosted evidence from surfaces-dogfood.mjs stays, labelled as browser-hosted.
- The catalogue stays the single source. If T18 needs an operation the catalogue lacks, add it there and let it propagate; do not add a test-only route.
- The projectless workspace is not a project. Nothing in T18–T20 may write into it; "Save as automation" refuses without a project and the project sections say so.
- Coverage is reported with a denominator. "N of M checks reached" per platform and interface, with blocked platforms named with the exact host reason (no Windows runner, no device, no accessibility grant). A percentage on a reachable subset is not a release headline.
- reports/self-parity.md and evals/self/checks.yaml are regenerated from what runs; the Explorer's two cases go, the Surfaces cases come, and the yam-side stories for them are written through Yam.

WHAT EACH TASK HAS TO ANSWER:

- **T18** — can Yam drive Yam. The packaged app is launched by the suite, its readiness is awaited by a helper rather than a sleep, and the primary journey — open Surfaces, connect to the sample app, select a control, fill it, verify it, close — runs through `yam surface` against the app's accessibility tree, and again through the MCP tools, and again with the renderer attached as a browser target. The negative cases run the same way: a wrong postcondition fails the gate; a stale reference is refused; a held target refuses the other client. External oracles stay: screenshot, geometry, axe, and the fixture project's files unchanged.
- **T19** — what was reached. One report per run: attempted, reached, passed, failed, blocked and externally verified, per interface (CLI, MCP, HTTP, desktop) and per platform (macOS AX, browser, HTTP; Windows UIA, Appium and BiDi revalidated or marked unvalidated with the host reason). Clean-package quick starts run from a packed tarball outside the workspace, copied verbatim from the docs. Timing budgets are defined and measured: connect, snapshot, act, the desktop's first paint.
- **T20** — do the docs say what shipped. The support matrix is derived from T19's report, not written. Install and setup examples are the ones T19 ran. Screenshots are the ones the harness took. Every copied command in active docs runs. No "opens into Flows" promise, no "any platform" claim, no repository path, no fixture gateway in a user default. The release review lists the open limitations by name: permission-denied undriven, screenshot preview and pixel actions unbuilt, Copy CLI / Copy MCP unbuilt, Streamable HTTP MCP absent, the connection test not speaking MCP.

HOW THE WORK IS PROVED. Twenty-one defects reached the first three branches. Every one survived because a claim had been made about the code rather than the product, and in wave 3 specifically because the driven checks stopped one step short: they took control and never acted; they connected by keyboard and clicked the rest; they tested 100% and called it 200%; they used an HTTP client and called it an agent. So:

- Every T18 case is a `yam surface` or MCP transcript against the running packaged app, kept as evidence. If a case cannot be reached on this host, it is *blocked* with the reason, not skipped silently and not simulated.
- The wrong-postcondition case must be shown failing the gate, not shown passing when correct.
- T19's report is generated by the suite; a hand-written table is not a report.
- T20's copied commands are run by a test from the docs source, in a clean directory, from the packed artifact.

WORKING RULES:

1. Follow each task's Do and Validate in docs/spec/surface-first/tasks.md literally. A task is complete when every Validate item is demonstrated by something a verifier can re-run.
2. Record deviations in docs/spec/surface-first/progress/wave-4.md with the section reference and the reason. If a thing cannot be done, say so there rather than marking it complete.
3. The import boundaries in eslint.config.js stand. `evals/self` may use the CLI and the MCP client; it may not import the renderer.
4. User-facing strings contain no internal vocabulary (REQ-CLI-9).
5. Nothing is published. No push, no npm publish, no tag, no release dispatch. Ask the owner first.

EVIDENCE YOU MUST LEAVE:

- docs/spec/surface-first/progress/wave-4.md: per task, status, the exact commands demonstrating each Validate item, observed results, deviations, known gaps.
- The T18 transcripts (CLI and MCP) and the T19 report, under docs/spec/surface-first/evidence/wave-4/.
- The regenerated reports/self-parity.md and evals/self/checks.yaml.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential; the tree clean afterwards; pnpm docs:check clean.

When finished, print a table of the wave 4 tasks with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

In a clean worktree of `surface-first-wave-4`:

1. Run the gate with no credential. Confirm the tree is clean and `pnpm docs:check` passes.
2. Run the T18 suite and read its transcripts: confirm every action on the app went through `yam surface` or an MCP tool, and that the app it drove was the packaged one.
3. Break a postcondition in one T18 case and confirm the gate fails; restore it.
4. Read the T19 report against the run that produced it: every blocked platform has a host reason; the denominators match the attempted counts; no headline percentage omits them.
5. Pack the artifacts, install them outside the workspace, and run every copied command in the active docs verbatim.
6. Confirm the fixture project's flows, bindings, runs and proposals are byte-for-byte unchanged after the whole suite.
