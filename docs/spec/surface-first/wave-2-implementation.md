# Surface-first wave 2 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, on `master` with wave 1 merged. It finishes the core the first wave started: what a target *is*, what a reference *means*, what happens when two callers want the same thing, and what the service and its clients look like once the catalogue is the only source.

Wave 2 is M1's remainder plus M2's: **T06, T07, T08, T09, T12, T13** from [tasks.md](tasks.md). It excludes the desktop shell (M3), Streamable HTTP MCP, process/PTY and AT-SPI.

**Owner decision, carried from wave 1:** everything is local and unpublished. No `/v1` prefix, no compatibility window, no deprecation shims. Routes change in place and every client changes with them.

**Read wave 1's verification first.** Seven defects reached its branch, and the shape of them matters more than the count: the tests asserted that strings appeared in source files, so they passed while the code did not compile, while a gate had been replaced by a worse failure, and while an argument was forwarded one layer and dropped the next. See [the progress record](progress/wave-1.md).

---

## Prompt

```
You are implementing wave 2 of Yam's surface-first direction. Wave 1 is merged on master: there is a `packages/surface-control` with an operation catalogue, a dispatcher, a session store and a broker; a `yam surface` command family; ten MCP surface tools; and a projectless connect → inspect → act → verify journey that works across separate processes.

Read, in this order, and treat them as the source of truth:
- docs/spec/surface-first/README.md
- docs/spec/surface-first/requirements.md — SF-01..SF-23
- docs/spec/surface-first/design.md — references and determinism, ownership and lifecycle, the one public contract
- docs/spec/surface-first/tasks.md — T06, T07, T08, T09, T12, T13 are yours
- docs/spec/surface-first/progress/wave-1.md — what was built, and the seven defects verification found
- docs/spec/{requirements,hld,lld,tasks}.md — Draft 2.25, already reconciled

Branching: create branch surface-first-wave-2 from master. Commit after each task with "T<nn>: <task title>".

WAVE 2 SCOPE, in order:

  T06  Target and capability discovery.
  T07  Reference scope and preconditions.
  T08  Operation coordination and recovery.
  T09  Redacted session events and artifacts.
  T12  Transport parity: the service's surface routes generated from the catalogue, and the clients regenerated.
  T13  Clean-installation packaging and docs.

Nothing else. No desktop navigation, no Streamable HTTP MCP, no process/PTY, no AT-SPI. Those are wave 3 and their tasks stay unchecked.

DECISIONS ALREADY MADE (do not re-open):

- No `/v1`, no compatibility window. `POST /surface/:session/*` becomes whatever the catalogue says it is, and the generated TypeScript, Python and Java clients, the desktop's client and the SDK change in the same commit.
- The catalogue is the single source. If an operation's arguments live in more than one place after this wave, the wave failed. T12's test is: change one argument in the catalogue and watch the CLI help, the MCP schema and the service route all change.
- The broker owns sessions. Wave 2 gives it leases and target identity; it does not grow into a multi-user service.
- Intent stays optional for direct control and is never fabricated. Evidence for authoring is gathered before a call, targeted at the element the call names, and only when an intent was given. Do not reintroduce a full snapshot per operation.

WHAT EACH TASK HAS TO ANSWER:

- **T06** — what is on this machine that Yam can drive, and can it. Browser tabs, HTTP endpoints, native windows. An adapter that is registered is not the same as an adapter that can run here: report readiness with the exact missing permission, host or tool. Multiple matches require a choice rather than a guess. The Explorer's adapter list stops being the source of truth.
- **T07** — a reference identifies a session, a target, a document generation, a snapshot and an element, and it means nothing outside them. Navigation, replacement, a second tab and a cross-session id must each be refused rather than resolved to something else. Wave 1's evidence capture calls `describe` before a call; prove that path cannot retarget the caller's reference.
- **T08** — one mutation per target at a time, a lease that can be handed over, deadlines, cancellation, and an outcome vocabulary that distinguishes `failed` from `unknown`. A crash after dispatch must not read as "never happened". Idempotency keys deduplicate within a stated window; a key reused with different input is refused.
- **T09** — one event stream, redacted. A synthetic secret must not appear in a result, in protocol text, in a persisted event, in a trace or in a screenshot. Artifact reads are scoped. Refused and failed calls are recorded without being executed.
- **T12** — the service's surface routes come from the catalogue, and every client is regenerated from the served document. The shared corpus runs the same requests and the same failures through CLI, MCP and HTTP and gets the same domain codes.
- **T13** — a person can install and use this from a clean environment. `@svatah/yam`, the installed binary, no repository paths, no fixture gateway in a user default. Pack the artifacts and run the copied examples outside the workspace.

HOW THE WORK IS PROVED. Wave 1's tests read source files for strings and were green while the product was broken. Every claim in this wave is demonstrated by driving the built binary, a real service or a real MCP subprocess. A test that greps a source file for an identifier is not evidence that the behaviour exists. In particular:

- A negative test for each refusal: the stale ref, the wrong session, the busy target, the unknown adapter, the missing permission, the reused idempotency key.
- Two clients contending for one target, in two processes, with the loser told who holds it.
- A deliberately wrong postcondition must fail the gate.

WORKING RULES:

1. Follow each task's Do and Validate in docs/spec/surface-first/tasks.md literally. A task is complete when every Validate item is demonstrated by a command a verifier can re-run.
2. Record deviations in docs/spec/surface-first/progress/wave-2.md with the section reference and the reason. If something cannot be done, say so there rather than marking it complete.
3. `packages/surface-control` imports no compiler, recorder, gateway or service. Update eslint.config.js deliberately and say why in the commit.
4. User-facing strings contain no internal vocabulary (REQ-CLI-9).
5. Nothing is published. No push, no npm publish, no tag, no release dispatch. Ask the owner first.

EVIDENCE YOU MUST LEAVE:

- docs/spec/surface-first/progress/wave-2.md: per task, status, the exact commands demonstrating each Validate item, observed results, deviations, known gaps.
- A transcript of two clients contending for one target, and of a stale reference being refused.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential; the tree clean afterwards; pnpm docs:check clean.

When finished, print a table of the wave 2 tasks with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

In a clean worktree of `surface-first-wave-2`:

1. Run the gate with no credential. Confirm the tree is clean and `pnpm docs:check` passes. A branch that does not build has not been tested by whoever wrote it.
2. Change one operation's arguments in the catalogue and confirm the CLI help, the MCP tool schema and the service route all change together.
3. Drive each refusal by hand: a reference from before a navigation, a session id from another broker, a target another client holds, an adapter this host lacks, an idempotency key reused with different input.
4. Run two clients against one target in two processes; confirm one is refused and told who holds the lease, and that interrupting one does not silently continue its mutation.
5. Put a synthetic secret through an action and grep every result, event, log, trace and screenshot for it.
6. Pack the artifacts, install them outside the workspace, and run the copied quick-start examples verbatim.
