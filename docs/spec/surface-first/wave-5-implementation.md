# Surface-first wave 5 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, on `master` with wave 4 merged. It is milestone M5 — **T21, T22, T23** from [tasks.md](tasks.md) — with one thing before them: **make the Yam-on-Yam suite dependable**, because M4 left it passing without passing every time, and a suite that cannot be trusted cannot gate the reach M5 adds.

Waves 1–3 built the core, the transports and the desktop. Wave 4 made Yam drive the *packaged* Yam through its own public interfaces, published coverage with a denominator, and brought the docs to what shipped. Its verification found eight further defects and left two gaps named in [progress/wave-4.md](progress/wave-4.md): the suite is intermittent, and the parity gate is not conformant.

**Read wave 4's verification first.** Twenty-nine defects have reached the four branches now, and the shape has not changed once: something was asserted about the code rather than the product, or an artefact was believed after the code beneath it moved. Wave 4's own worst case was the second kind — the evidence file was written twenty-six minutes before the screen it describes was changed, and nobody re-ran it.

---

## Prompt

```
You are implementing wave 5 of Yam's surface-first direction. Waves 1–4 are merged on master.

What exists: a catalogue of fourteen operations that is the single source for the CLI, the MCP tools and the service's routes; a broker owning sessions across processes, with control leases, deadlines, idempotency, snapshot-scoped references, a redacted event stream and promotion steps; `yam surface` and the same fourteen as MCP tools over stdio; a desktop whose default screen is Surfaces; a suite (`evals/self/yam-on-yam/`) that launches the packaged application and drives it through `yam surface` and the MCP tools against both its renderer and its macOS accessibility tree; a generated coverage report with attempted/reached/passed/failed/blocked per interface and platform; a generated support matrix; and a release review.

What does not exist: a Yam-on-Yam suite that passes every time; a conformant parity gate; Streamable HTTP MCP; a process/PTY surface; Linux AT-SPI.

Read, in this order, and treat them as the source of truth:
- docs/spec/surface-first/README.md
- docs/spec/surface-first/requirements.md — SF-08, SF-22, SF-23 are this wave's; SF-21 governs T00
- docs/spec/surface-first/design.md
- docs/spec/surface-first/tasks.md — T21, T22, T23
- docs/spec/surface-first/progress/wave-4.md — especially "Verification of wave 4": the reliability gap, the runs, and the two parity disagreements
- docs/spec/surface-first/release-review.md
- docs/spec/{requirements,hld,lld,tasks}.md — Draft 2.25

Branching: create branch surface-first-wave-5 from master. Commit after each task with "T<nn>: <task title>".

WAVE 5 SCOPE, in order:

  T00  Make the Yam-on-Yam suite dependable, and the parity gate conformant.
  T21  Add Streamable HTTP MCP.
  T22  Deliver process/PTY.
  T23  Expand native/mobile coverage (AT-SPI, and the discovery/capability gaps).

T00 is not in tasks.md because it came out of wave 4's verification. Add it there, in M5, with its requirement references (SF-18, SF-21), and tick it like any other.

DECISIONS ALREADY MADE (do not re-open):

- Everything is local and unpublished. No push, no npm publish, no tag, no release dispatch, no GitHub release.
- The catalogue stays the single source. A new transport (T21) and a new adapter (T22, T23) reach the same operations; neither gets a route, a tool or a flag the catalogue does not define.
- Coverage is reported with a denominator, and a platform that cannot be asked is blocked with the host's own sentence — never omitted, never counted as passing. A new adapter that nothing drove is "implemented, unvalidated here" with what would have to be true.
- Browser-hosted renderer evidence stays labelled browser-hosted. It is not the packaged application.
- T00 comes first. Do not add reach on top of a harness whose failures cannot be told apart from the product's.

WHAT EACH TASK HAS TO ANSWER:

- **T00** — can the suite be believed. Two things are wrong. First, it is intermittent: runs on one machine gave 91/91 twice and, in between, failures whose signature is the **outer session disappearing** (`SESSION_NOT_FOUND`) around the moment the application opens its own inner session, after which nothing can attach to its DevTools endpoint. The application process survives and there is no crash report; closing an attached session and re-attaching works in isolation. Root-cause it — the broker's ownership of two sessions from two builds, the application's own service and lock, and the CDP endpoint's lifetime are the places to look — and fix the cause rather than the symptom. Then run it ten times in a row, unattended, and publish the ten results. Second, `reports/self-parity.md` ends "Not conformant" with two disagreements: `app.screen-through-two-adapters` (the same flow passes through AX and fails over CDP expecting "Flows" in the toolbar title) and `app.record-opens-and-every-control-on-it-is-named-and-id-d` (Yam cannot resolve `app.record-fake-gateway`, which renders only for a running fake-gateway session). A disagreement means one oracle is wrong; say which, and fix that one. When both are done, the suite is a gate: put it in CI behind the packaged build.
- **T21** — an agent that cannot spawn a process. Streamable HTTP MCP against the same broker and the same catalogue, with pinned protocol and SDK versions, negotiated transport, authentication, and the cancellation and reconnect semantics of the version pinned. The conformance corpus that stdio passes must pass here unchanged, and session isolation between two clients must be tested rather than assumed. Do not label the existing REST API an MCP transport.
- **T22** — a terminal is a surface. Snapshot, input, streams, signals, exit state, and bounded artifact and filesystem access, through the same operations as every other surface. Yam drives its own CLI and TUI through it and checks exit codes and state. No undisclosed shell escape, no read outside the declared root. Until it lands, CLI tests are reported as externally driven, and the support matrix says so.
- **T23** — Linux AT-SPI, and the discovery and capability gaps for Appium, UIA and BiDi. Each newly supported capability gets a reproducible conformance result, its limitations and its version range. Support labels are derived from runs, never from a dropdown. A platform with no runner stays unvalidated with the reason — that is a complete answer.

HOW THE WORK IS PROVED. Twenty-nine defects have reached the first four branches. Every one was a claim about the code rather than the product, or an artefact trusted after the code beneath it moved:

- Wave 4 wrote its evidence file twenty-six minutes before it changed the screen that evidence describes, and did not re-run it. **Regenerate every artefact from the code as committed, last, and commit them in the same change as the code.** If a run takes minutes, that is what it costs.
- A count that shrinks because the subject failed is not a denominator. Every pass declares its checks; a check not reached is a failure that says where the pass stopped.
- A harness that publishes its own state as a product result is worse than no harness. Wave 4 had three: a blocked event loop reported as a product timeout, an impatient timeout reported as a host limitation, and its own leftover service reported as a dead session.
- A negative case must be shown failing, not shown passing when correct.

WORKING RULES:

1. Follow each task's Do and Validate in docs/spec/surface-first/tasks.md literally. A task is complete when every Validate item is demonstrated by something a verifier can re-run.
2. Record deviations in docs/spec/surface-first/progress/wave-5.md with the section reference and the reason. If a thing cannot be done, say so there rather than marking it complete.
3. The import boundaries in eslint.config.js stand.
4. User-facing strings contain no internal vocabulary (REQ-CLI-9) and no repository path (SF-20).
5. Nothing is published. No push, no npm publish, no tag, no release dispatch. Ask the owner first.

EVIDENCE YOU MUST LEAVE:

- docs/spec/surface-first/progress/wave-5.md: per task, status, the exact commands demonstrating each Validate item, observed results, deviations, known gaps.
- T00's ten consecutive runs, with their counts, under docs/spec/surface-first/evidence/wave-5/.
- A conformant reports/self-parity.md, or the two disagreements resolved with the oracle that was wrong named.
- The regenerated coverage report and support matrix, produced after the last code change.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential; the tree clean afterwards; pnpm docs --check clean.

When finished, print a table of the wave 5 tasks with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

In a clean worktree of `surface-first-wave-5`:

1. Run the gate with no credential. Confirm the tree is clean and `pnpm docs --check` passes.
2. Run the Yam-on-Yam suite **five times in a row, unattended**, and confirm every run reports the same attempted count and no failures. This is the whole of T00; a suite that needs a clean machine between runs has not been fixed.
3. Confirm `reports/self-parity.md` is conformant, and that any check that lost a side says which oracle was wrong.
4. Drive the Streamable HTTP transport with a generic client the repository does not own, including cancellation, reconnect and two clients that must not see each other's sessions.
5. Drive a real terminal through the process surface: a command that exits nonzero, one that reads from stdin, one that is signalled. Confirm no read outside the declared root.
6. Read the support matrix against the runs it came from: every label derived, every blocked row carrying the host's own sentence.
7. Confirm the fixture project's files are byte-for-byte unchanged after the whole suite.
