# Phase 2 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. It applies the Phase 1 corrections from `docs/spec/progress/phase-1-verification.md`, then implements Phase 2 (module (b): flow language, compiler, executor, test behavior, local service).

---

## Prompt

```
You are continuing the Svatah implementation. Phase 1 is on branch phase-1 (tip beb8b53), verified at 8.1/10 with corrections required. You will apply the Draft 2.3 spec amendments, the corrections, then implement Phase 2.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-0.md and docs/spec/progress/phase-1.md (what exists)

Branching: create branch phase-2 from phase-1. Commit after each item with "Spec 2.3: <title>", "P1-F<n>: <title>", or "T2.<n>: <task title>".

SPEC AMENDMENTS (Draft 2.3, authorized by the verifier). Apply verbatim as the first commit and touch no other spec text.

hld.md, §12 layout block: replace the line
    playwright-test/      host: bind() fixture, generated spec per flow, dual results ← module (a) + (b)
with
    playwright-test/      bind() fixture for plain Playwright tests                   ← module (a)
    bindings-cli/         svatah-bindings bin: bindings, heal, conform, eval healing  ← module (a)
    host-playwright/      flow host: svatah fixture, generated spec per flow, reporter ← module (b)
hld.md, §12: replace the paragraph beginning "Published npm modules:" with
Published npm modules (Draft 2.3; no aggregate packages, each package publishes individually): module (a) = `@svatah/schema`, `@svatah/surface`, `@svatah/adapter-playwright`, `@svatah/bindings`, `@svatah/healer`, `@svatah/playwright-test`, `@svatah/bindings-cli`, `@svatah/conformance`; module (b) = `@svatah/spec`, `@svatah/steps`, `@svatah/compiler`, `@svatah/gateway`, `@svatah/recorder`, `@svatah/runtime`, `@svatah/host-playwright`, `@svatah/workflow`, `@svatah/tool`, `@svatah/trajectory`, `@svatah/service`, `@svatah/migrate`, `@svatah/cli`; module (c) = the schema and conformance packages consumed by foreign runtimes. `runtime` stays in module (b); module (a) reaches replay only through the healer's `Replayer` plugin (LLD §10). Other adapters are separate packages.

lld.md, §1 dependency graph: replace the four lines from "bindings ─► surface, schema" through "playwright-test ─► runtime, bindings, adapter-playwright, healer" with
bindings ─► surface, schema
healer ─► bindings, surface, schema, [runtime via the Replayer plugin, gateway via the Regrounder plugin, see §10]
runtime ─► bindings, surface, schema
playwright-test ─► bindings, adapter-playwright, healer, surface, schema        (module (a); never runtime)
bindings-cli ─► bindings, healer, conformance, adapter-playwright, surface, schema   (module (a))
host-playwright ─► runtime, playwright-test, adapter-playwright, schema           (module (b))
lld.md, §1 boundary bullet: replace "- `bindings`, `healer`, `playwright-test` must not import `spec`, `steps`, `compiler` (module (a) independence, REQ-PKG-1)." with
- `bindings`, `healer`, `playwright-test`, `bindings-cli` must not import `spec`, `steps`, `compiler`, or `runtime` (module (a) independence, REQ-PKG-1); `cli` may depend on `bindings-cli` and mounts its commands under `svatah`.
lld.md, §6.5 example: replace `import { test } from "@svatah/bindings/playwright";` with `import { test } from "@svatah/playwright-test";`
lld.md, §9 heading: "## 9. Playwright Test host (package `host-playwright`, module (b))"; in §9.1's generated spec replace `from "@svatah/playwright-test"` with `from "@svatah/host-playwright"`; in §9.2 replace "Provided by the same package for plain tests (§6.5)." with "Provided by `@svatah/playwright-test` (module (a), §6.5); the host re-exports it so a flow project imports one package."
lld.md, §10: after the Regrounder paragraph add
The same pattern covers replay. `healer` defines `interface Replayer { toFailure(input: { runDir?: string; bindFailure?: BindFailure }, surface: AgentSurface): Promise<"reached" | "unreachable"> }`. Module (a)'s default restores the session state recorded with the failure (URL, storage state) and returns `unreachable` when the page needs a login that state does not carry. Module (b) registers a runtime-backed implementation that replays the story to the failing step. `healer` therefore never imports `runtime`.
lld.md, §12: replace "Algorithm unchanged from Draft 1 §10 with two changes: the model step goes through the `Regrounder` plugin (§10), and input comes" with "Algorithm unchanged from Draft 1 §10 with three changes: the model step goes through the `Regrounder` plugin (§10); the replay to the failing point goes through the `Replayer` plugin (§10), which in module (a) restores the recorded session state and in module (b) replays the story through the runtime; and input comes"
lld.md, §16: after the "Evals:" bullet add
- Healing eval ground truth (Draft 2.3). `apps/sample-web` stamps every interactive element with `data-svatah-eval="<stable key>"`, identical across all variants. The eval reads that key outside the surface (a page script, never `describe()`), records it per binding at variant 0, and after relocalization compares the key of the proposed element with the recorded one. Outcomes: `recovered` only when the keys match and a re-synthesised candidate resolves uniquely; `wrong-element` when the keys differ; `not-found`, `ambiguous` as before. `bindings.ignoreAttributes` (config, default `["data-svatah-eval"]`) removes the attribute from synthesis, fingerprints, and `native` so it can never help relocalization. The published percentage is over bindings that lost at least one candidate; the count that stopped resolving entirely is reported alongside, and both populations (with and without test-id attributes) are reported.
lld.md, §3.5 Config: replace "  bindings: { dir: string; testIdAttributes: string[] }; data: { file: string }; api: { dir: string };" with
  bindings: { dir: string; testIdAttributes: string[]; ignoreAttributes?: string[]; matchHost?: boolean };   // ignoreAttributes default ["data-svatah-eval"]; matchHost false → urlPattern is path-only
  data: { file: string }; api: { dir: string };
lld.md, §17: add as first bullet
- Draft 2.3 (after Phase 1 verification): `runtime` stays in module (b); `Replayer` plugin in the healer (§10, §12); `playwright-test` is module (a) `bind()` only, the flow host moves to `host-playwright` (§1, §9); `bindings-cli` package for module (a) commands (§1); `bind()` import path corrected (§6.5); healing eval must verify recovery against a ground-truth key and report both populations (§16); `bindings.ignoreAttributes` config.
requirements.md, REQ-HEAL-5 row: append to the requirement text: " A repair counts as recovered only when the repaired binding resolves to the ground-truth element; the denominator is bindings that lost at least one candidate, with bindings that stopped resolving entirely reported alongside."
requirements.md, §7 change log: add before the Draft 2.1 line: "- Draft 2.3 (after Phase 1 verification): `REQ-HEAL-5` defines recovery against the ground-truth element and the denominator."
tasks.md, T2.8 Do: replace with "In the module (b) package `host-playwright`: `svatah` fixture, `host generate`, reporter writing Svatah results, retry policy gating, annotations with failure class; re-export `bind()` from `@svatah/playwright-test`. `@svatah/playwright-test` itself gains nothing and keeps no runtime dependency."
tasks.md, after T2.11 add:
### T2.12 Module (a) command line and healer replay plugin
**Refs:** REQ-PKG-1, 2, REQ-HEAL-1, LLD §1, §10, HLD §12 · **Est:** 2
**Do:** Create `@svatah/bindings-cli` (bin `svatah-bindings`) holding `bindings list|show|verify|prune`, `heal --from-bind-failures`, `surface conform`, and `eval healing`, moved out of `@svatah/cli`; `@svatah/cli` depends on it and mounts the same commands under `svatah`. Add the `Replayer` plugin interface to `@svatah/healer` with the session-state default; register a runtime-backed `Replayer` from `@svatah/cli` for flow runs.
**Validate:** The dependency-tree test covers `bindings-cli` as module (a); a clean install of the module (a) tarballs exposes `svatah-bindings`; `svatah heal --run <id>` on a Phase 2 run directory replays to the failing step through the runtime, while `svatah-bindings heal --from-bind-failures` still works with no module (b) package installed.
tasks.md, traceability row REQ-PKG-1: append ", T2.12". Estimate table: Phase 2 becomes 32.5 and "Module (b) 0.1: prose flows, test behavior in Playwright Test; local service; module (a) CLI and replay plugin"; total 170.5. Change log: add "- Draft 2.3 (after Phase 1 verification): T2.8 targets the new `host-playwright` package; T2.12 added for `bindings-cli` and the healer `Replayer` plugin. Total 170.5 ideal days."

PHASE 1 CORRECTIONS (before any Phase 2 task):
F1 Healing ground truth. Implement LLD §16 as amended: `data-svatah-eval` keys in apps/sample-web on every interactive element, stable across variants; `bindings.ignoreAttributes` in config and honoured by synthesis, fingerprinting, and the adapter's `native`; the eval reads keys through a page script outside the surface, compares after relocalization, and emits `wrong-element` on mismatch. Re-run `pnpm eval:healing`, commit the new report with both populations, and update README numbers. If the number drops below 0.60 the gate fails; publish it anyway and say so.
F2 Contract command. Add root script `browsers` = `pnpm --filter @svatah/adapter-playwright exec playwright install chromium` and add `playwright` to root devDependencies from the catalog so `pnpm exec playwright` also works at the root. The documented contract becomes: pnpm install && pnpm browsers && pnpm -r build && pnpm -r test. Update the packaging test that checks the README says a browser must be installed.
F3 Quick start side effect and port in URL patterns. `pnpm quick-start` must leave `git status --porcelain examples/` empty; record into a temporary copy and assert cleanliness in the script. Separately, the committed example bindings carry `context.pattern: "http://127.0.0.1:65431/login"`, an ephemeral port. Make `urlPattern` path-based by default (`/login`, with host only when `bindings.matchHost` is set), re-record the three example bindings, and add a test that no committed binding pattern contains a port number.
F4 Package skeletons. Create packages/bindings-cli and packages/host-playwright (skeleton index, package.json, README) so the HLD §12 layout test passes after the amendment; the real content lands in T2.8 and T2.12.
F5 Residual boundary note. State in eslint.config.js and the import-boundaries test description that computed dynamic specifiers and createRequire are not lintable and that the transitive-closure test is the guard.
F6 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-1.md: the Node 22 result from verification, the root install failure, and the reworded eval verification sentence.

PHASE 2 SCOPE: tasks T2.1 through T2.12 in docs/spec/tasks.md, in order. Nothing from Phase 3. Phase 2 delivers module (b)'s test behavior: prose flows compile to plans and run deterministically, inside Playwright Test for web, with the local service as the integration point.

Decisions already made (do not re-open):
- Tier 1 grammar is peggy (LLD §4.2); Tier 0 custom steps are matched before it (LLD §5); Tier 2 and 3 are pluggable no-ops in Phase 2 (LLD §4.1).
- Executor core is runner-agnostic (LLD §8); the Playwright Test host is the separate `host-playwright` package (LLD §9). Guards, checkpoints, audit, and policies are implemented in the executor now (T2.7), even though workflow behavior ships in Phase 5.
- The compatibility run (T2.10) uses the Phase 1 recorder-less path: seed bindings completed by the programmatic picker or by hand; no model exists yet.
- The local service (T2.11) is Fastify on 127.0.0.1 with a bearer token and publishes GET /openapi.json (LLD §13.5); no business logic in handlers.
- Migration (T2.9) must reproduce the four fixture flows from the legacy originals byte-for-byte except comments; the fixtures are the golden output.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-2.md with the section reference and reason. Do not edit the spec beyond the amendments above.
3. No model calls anywhere in Phase 2. No network beyond package and browser installation.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-2.md with, per correction F1..F6 and per task T2.1..T2.12: status, the exact commands demonstrating each Validate item, observed results; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install && pnpm browsers && pnpm -r build && pnpm -r test.
- The compatibility milestone: the four migrated fixtures compile with zero errors, run against apps/sample-web under `svatah run --host playwright` and `--host none`, twice each, with identical statuses and identical results.jsonl minus timestamps; the run directory committed under evals/conformance/runtime as the first runtime conformance fixture.
- Byte-stability evidence: two compiles of the fixtures produce identical plan.json (sha256 in the progress file).
- `svatah migrate legacy/src/test/resources evals/tmp` output compared byte-for-byte to evals/fixtures/flows (test).
- Service contract tests and an OpenAPI document committed at packages/service/openapi.json.
- The new healing report with ground-truth verification and both populations under reports/.
- Module (a) tarballs still install without module (b) (dependency-tree test extended to bindings-cli).

When finished, print a summary table of F1..F6 and T2.1..T2.12 with status and commit hash, then stop. Do not begin Phase 3.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-2`:

1. Run `pnpm install && pnpm browsers && pnpm -r build && pnpm -r test`, also on Node 22.
2. Confirm the spec diff `phase-1..phase-2` is exactly the Draft 2.3 amendments.
3. Re-run the healing eval and confirm `wrong-element` is populated when the eval is run with ground-truth keys deliberately shuffled (a negative control the verifier will construct).
4. Compile the fixtures twice and compare hashes; run the compatibility milestone twice under both hosts and diff results.
5. Run migration on the legacy originals and diff against the fixtures.
6. Exercise the service: unauthenticated refusal, a run streamed over the event stream, results identical to the CLI run.
7. Confirm module (a) tarballs install without module (b) and `svatah-bindings` works alone.
8. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
