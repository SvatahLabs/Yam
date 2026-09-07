# Surface-first wave 3 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, on `master` with wave 2 merged. It replaces the flow-first desktop with the surface-first one: **T14, T15, T16, T17** from [tasks.md](tasks.md), which is milestone M3.

Waves 1 and 2 built the core. A person cannot reach it yet: the desktop still opens into Flows, its Explorer is a protocol form, and Surfaces is not in the rail. This wave is where the mission becomes something you can show someone.

It excludes M4 (proving and releasing) and M5 (Streamable HTTP MCP, process/PTY, AT-SPI).

---

## Prompt

```
You are implementing wave 3 of Yam's surface-first direction. Waves 1 and 2 are merged on master.

What exists: `packages/surface-control` with an operation catalogue that is the single source for the CLI, the MCP tools and the service's routes; a broker that owns sessions across processes and serves them over loopback; target and capability discovery; generation-bound references; leases, deadlines and idempotency; a redacted event stream. `yam surface connect|snapshot|describe|capabilities|act|read|check|screenshot|close|sessions|targets` works in an empty directory, and so does the same journey through a generic MCP client with no project and no intent.

What does not exist: any of it in the desktop.

Read, in this order, and treat them as the source of truth:
- docs/spec/surface-first/README.md
- docs/spec/surface-first/requirements.md — SF-02, SF-04, SF-05, SF-09..SF-11, SF-13, SF-14, SF-16..SF-19 are this wave's
- docs/spec/surface-first/design.md — "Desktop interaction design" is the specification for T14 and T15; read it as a contract, not a sketch
- docs/spec/surface-first/tasks.md — T14, T15, T16, T17
- docs/spec/surface-first/progress/wave-1.md and wave-2.md — what was built, and the twelve defects verification found across the two waves
- docs/spec/{requirements,hld,lld,tasks}.md — Draft 2.25

Branching: create branch surface-first-wave-3 from master. Commit after each task with "T<nn>: <task title>".

WAVE 3 SCOPE, in order:

  T14  The Surfaces shell and the connect flow.
  T15  The selected-target action inspector.
  T16  Shared control and agent setup.
  T17  Automations regrouped, and "Save as automation" (P1).

Nothing else. No Streamable HTTP MCP, no process/PTY, no AT-SPI, no packaged-app self-test. Those are wave 4.

DECISIONS ALREADY MADE (do not re-open):

- Everything is local and unpublished. Change navigation, screens and routes in place; no compatibility window. Keep saved preferences, project recents and deep links resolvable.
- The desktop is a client of the same broker and the same catalogue. It must not grow its own session store, its own operation list or its own idea of what an action needs. If a screen knows something about an operation that the catalogue does not, that is the defect.
- Primary navigation is Surfaces, Automations, Activity, Settings. Surfaces opens by default. Flows, recording, binding repair and tool publishing move under Automations with their behaviour unchanged; run evidence moves under Activity.
- The Explorer as it stands is replaced, not extended. Its adapter chooser and intent box were a protocol form; T15 is a capability-driven action form.
- Intent stays optional. Nothing in the desktop may require a prose sentence before it will inspect something.

WHAT EACH TASK HAS TO ANSWER:

- **T14** — a person opens Yam and connects to something. Discovery grouped by platform, with the exact prerequisite shown for anything unavailable. Explicit attach or launch. No project needed, and none created. The adapter shown is the adapter the service used.
- **T15** — a person selects a control and acts on it without typing JSON. The form comes from capabilities: fill takes a value, click takes the control, drag takes two, navigate takes a URL, HTTP takes a method and a path. Dispatch and verification are shown separately, and `verified` is true only when a postcondition passed. "Choose an action" can never be a dead end again.
- **T16** — a person and an agent share one target. The UI shows a session an agent created, who holds control, and hands over explicitly. A lost connection offers inspection, never an unqualified Retry. "Connect an agent" shows copyable generic MCP configuration for the installed binary and tests the connection.
- **T17** — the automation features are where they now belong, with their artifacts and semantics untouched, and a session can be promoted into a reviewed proposal without forcing a flow or a run.

HOW THE WORK IS PROVED. Twelve defects reached the first two branches. Every one survived because something was asserted about the code rather than about the product: tests that grepped source for identifiers, a generator tested against itself, a module wired in that nothing could feed. In a UI wave the equivalent mistake is asserting that a component renders. So:

- Drive the real desktop. The repository already runs the built renderer in headless Chromium over a real service (`docs/spec/surface-first/evidence/dogfood.mjs`); use that harness or its successor.
- Every state in SF-17 gets a case: loading, empty, permission denied, disconnected, unsupported, stale, busy, unknown outcome. A screenshot of the happy path is not evidence that the others exist.
- Keyboard only: connect, select, act, check, close. Focus stays visible and returns predictably after a dialog.
- 1280×800 and 1440×1000, at 100% and 200%. The audit found the old Explorer's controls overlapping at 1440×1000; a layout assertion at one size is not coverage.
- A deliberately wrong postcondition must show as failed, not as verified.

WORKING RULES:

1. Follow each task's Do and Validate in docs/spec/surface-first/tasks.md literally. A task is complete when every Validate item is demonstrated by something a verifier can re-run.
2. Record deviations in docs/spec/surface-first/progress/wave-3.md with the section reference and the reason. If a thing cannot be done, say so there rather than marking it complete. A "known gaps: none" beside a deviation that guts the task is what wave 1 did.
3. `packages/screens` models the states; `apps/desktop` renders them. Neither imports an adapter. The action registry, the palette fixture, the screen key tables and the CLI stay in agreement — there is a check for that.
4. User-facing strings contain no internal vocabulary (REQ-CLI-9).
5. Nothing is published. No push, no npm publish, no tag, no release dispatch. Ask the owner first.

EVIDENCE YOU MUST LEAVE:

- docs/spec/surface-first/progress/wave-3.md: per task, status, the exact commands demonstrating each Validate item, observed results, deviations, known gaps.
- Screenshots of Surfaces empty, connected, acting, refused-and-busy, and unknown-outcome, at both sizes.
- A transcript of the keyboard-only journey.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential; the tree clean afterwards; pnpm docs:check clean.

When finished, print a table of the wave 3 tasks with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

In a clean worktree of `surface-first-wave-3`:

1. Run the gate with no credential. Confirm the tree is clean and `pnpm docs:check` passes.
2. Open the app on an empty directory. Confirm Surfaces is the default, that connecting needs no project, and that no project files are created.
3. Connect, select a control, fill it, verify it, and close — using only the keyboard.
4. Drive each SF-17 state deliberately: unplug the service mid-action, ask for an adapter this host lacks, act on a reference from before a navigation, take control while an agent holds it.
5. Start a session from the CLI and confirm the desktop shows it, and the reverse.
6. Confirm the flows, bindings, runs and proposals of an existing fixture project are unchanged, still reachable, and still compile and replay to the same hashes.
