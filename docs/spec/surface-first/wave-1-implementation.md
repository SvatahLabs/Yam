# Surface-first wave 1 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root, on `phase-14` with `a7557ae` committed. It implements wave 1 of the [surface-first specification](README.md): the projectless live-control core, reachable from the CLI and from MCP, plus the audit's verified defects.

Wave 1 is the slice [tasks.md](tasks.md) recommends starting with: T01–T05, then a narrow T10/T11 web journey. It deliberately excludes the desktop shell (M3), Streamable HTTP MCP, process/PTY, AT-SPI, lease arbitration and idempotency.

**Owner decision, 2026-09-07:** everything is local and unpublished, so there is no `/v1` prefix and no compatibility window. Routes change in place and their clients change with them.

---

## Prompt

```
You are implementing wave 1 of Yam's surface-first direction. The repository is at commit a7557ae on branch phase-14, with Draft 2.24 of the existing spec committed and nothing published.

Read, in this order, and treat them as the source of truth:
- docs/spec/surface-first/README.md
- docs/spec/surface-first/gap-analysis.md — the audit and its evidence
- docs/spec/surface-first/requirements.md — SF-01..SF-23
- docs/spec/surface-first/design.md — the shared control architecture and the operation catalogue
- docs/spec/surface-first/tasks.md — T01..T23; you implement the wave 1 subset below
- docs/spec/{requirements,hld,lld,tasks}.md — the existing spec you are reconciling with

THE MISSION. Yam's primary journey becomes connect -> inspect -> act -> verify, for a person and for an agent, against a live target, with no project, flow, binding, plan or model credential. Authoring and replaying automation stays, and becomes the secondary journey it builds on top.

Branching: create branch surface-first-wave-1 from a7557ae. Commit after each task with "T<nn>: <task title>".

WAVE 1 SCOPE, in order:

  T01  Reconcile the mission in the existing spec.
  T02  Freeze the operation catalogue.
  T03  Turn the audit's verified failures into regression cases.
  T04  Extract surface control from project loading (packages/surface-control).
  T05  Broker discovery and session lifecycle.
  T10' A narrow `yam surface` command family: the primary journey only.
  T11' A narrow MCP surface profile: the primary journey only.
  T0B  The six verified defects, each with the regression case from T03 going green.

Nothing else. No desktop navigation rebuild, no Streamable HTTP MCP, no process/PTY, no AT-SPI, no target discovery beyond what connect needs, no lease arbitration, no idempotency keys. Those are waves 2 and 3 and their tasks stay unchecked.

DECISIONS ALREADY MADE (do not re-open):

- No `/v1` prefix, no legacy compatibility window, no deprecation shims. Everything is local and unpublished. Change `POST /surface/:session/*` in place to the new dispatcher and update every client in the same commit: the generated app client, the SDK, the Python and Java clients, and the desktop Explorer. `design.md`'s migration section is written for a published product and does not apply.
- The operation catalogue is one machine-readable module that generates CLI parsing and help, MCP input and output schemas, and the service's routes and OpenAPI. Two hand-written switches are what let MCP and HTTP drift; there must be one.
- Intent becomes optional for direct control (SF-12). A trajectory line without an intent is written with the operation type and the caller's identity instead. `yam explore` and `yam trajectory compile` must still work: a call with no intent compiles to a step marked for review rather than failing the file. Do not fabricate an intent.
- Adapter selection becomes real. An adapter that is not registered, or that cannot run on this host, is refused before anything is launched, naming what is missing. Never silently fall back to the configured one.
- One session at a time per target stays the rule, as `POST /record` and `POST /capture` already enforce for the browser. Wave 1 does not add leases or handoff; it reports honestly when a target is busy.
- `yam surface conform` and `yam surface doctor` keep their current behaviour and their place in the command family.

THE SIX DEFECTS (T0B), all verified against a7557ae:

1. `yam surface snapshot` and `yam surface act` do not exist, yet three actions in packages/screens/src/registry.ts advertise them as their CLI equivalent, and the refusal still says "Phase 1 implements `surface conform`". T10' implements them; the message goes.
2. The desktop Explorer collects an adapter and an intent but never an action, so `explorer.act` always refuses with "Choose an action." Give it a minimal action control driven by the target's capabilities, and a typed argument field. Deliberately minimal: T15 replaces this screen.
3. `POST /surface/:session/open` types its body as `{ headed?: boolean }` and drops `adapter`, so a nonexistent adapter returns 200 and opens the configured Playwright surface.
4. A snapshot with no intent reaches the trajectory schema, fails `intent: z.string().min(1)` and escapes as a 500, while read returns 400 `missing-intent`. After T11' neither needs an intent at all, and a genuinely invalid request is a 400 with a domain code, never an uncaught validation error.
5. The service's surface dispatch drops `ref2` for drag, `name` for attribute reads, and every snapshot option except `interactiveOnly`, while the MCP tools pass all three. Drag and attribute reads are impossible over HTTP and possible over MCP.
6. docs/mcp.md tells people to run `npx yam`, which resolves to an unrelated package on the public registry. The package is `@svatah/yam` and its bin is `yam`. Fix every setup example in the docs, and add a repo check that no example names an unscoped `yam` package.

ONE MORE THING THE AUDIT ONLY GESTURES AT: every service surface call takes an internal `surface.snapshot({interactiveOnly: true})` before dispatching, to fill the trajectory line's snapshotHash (packages/cli/src/service-api.ts). That is a full page read on every read. Make the trajectory's evidence cheap or lazy, and record the cost you removed. It is also the mechanism behind design.md's warning that an internal snapshot must never retarget a caller's reference.

WORKING RULES:

1. T01 is the only task that edits docs/spec/{requirements,hld,lld,tasks}.md. Edit them so that no active acceptance criterion requires a project, a flow, a prose intent or a Flows landing for direct control, and so the two specs do not contradict each other. Name every superseded requirement in the amendment note. Preserve the automation semantics and every historical phase record.
2. Every other task follows its Do and Validate in docs/spec/surface-first/tasks.md literally. A task is complete when every Validate item is demonstrated by a test or a command a verifier can re-run.
3. Where the surface-first spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/surface-first/progress/wave-1.md with the section reference and the reason. Do not quietly change the spec.
4. User-facing strings contain no internal vocabulary (REQ-CLI-9); the repo check enforces it.
5. Import boundaries are enforced by eslint.config.js and tools/repo-checks. `packages/surface-control` must not import the compiler, the recorder, the gateway or the service. Update the boundary lists deliberately and say why in the commit.
6. Nothing is published. No push, no npm publish, no tag, no release dispatch. Ask the owner first.

THE JOURNEY THAT DEFINES DONE. In an empty directory, with no project, no credential and no flow:

    yam surface connect --url http://127.0.0.1:4173 --json
    yam surface snapshot --session <id> --json
    yam surface act --session <id> --ref <ref> --action click --json
    yam surface read --session <id> --kind title --json
    yam surface check --session <id> --input check.json --json
    yam surface close --session <id> --json

Each is a separate process against one session. Each prints exactly one JSON result on stdout and nothing else; progress goes to stderr. The same journey completes through a generic MCP SDK client over stdio against `yam mcp`, with no project and no intent, and the results validate against the published output schemas. The directory is empty afterwards.

EVIDENCE YOU MUST LEAVE:

- docs/spec/surface-first/progress/wave-1.md with, per task: status, the exact commands demonstrating each Validate item, observed results, Deviations and Known gaps.
- The transcript of the journey above, every command and every reply, run in an empty directory.
- A rerun of docs/spec/surface-first/evidence/dogfood.mjs, or its wave-1 successor, showing the audit's six defects now behaving correctly. Keep the original evidence; write the new run beside it rather than over it.
- Everything runnable from a clean checkout with: pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint, with no credential; the tree clean afterwards; pnpm docs:check clean.

When finished, print a table of the wave 1 tasks with status and commit hash, then stop.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `surface-first-wave-1`:

1. Run the six-command contract with no credential; confirm the tree is clean and `pnpm docs:check` passes.
2. Play the empty-directory journey by hand from the transcript, in a directory containing nothing, and confirm every reply matches and no file is left behind.
3. Drive the same journey with a generic MCP SDK client over a real stdio subprocess, with no project argument and no intent, and validate every result against its published output schema.
4. Reproduce each of the six defects against `a7557ae` and confirm the regression case fails there and passes on the branch.
5. Confirm one catalogue generates the CLI help, the MCP schemas and the service routes, by changing one operation's argument in the catalogue and observing all three change together.
6. Confirm `packages/surface-control` imports no compiler, recorder, gateway or service, and that a project with an unparseable flow file can still connect, snapshot and act.
