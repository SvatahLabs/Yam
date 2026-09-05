# Phase 1 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. It first applies the Phase 0 corrections from `docs/spec/progress/phase-0-verification.md`, then implements Phase 1 (module (a)). The verifier will check the evidence described in the contract at the end.

---

## Prompt

```
You are continuing the Svatah implementation. Phase 0 is on branch phase-0 (tip 71a009b) and was verified with four corrections required. You will apply the corrections, then implement Phase 1.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-0.md (what Phase 0 delivered)

Branching: create branch phase-1 from phase-0. Commit after each item below with the message "P0-F<n>: <title>" for corrections and "T1.<n>: <task title>" for tasks.

SPEC AMENDMENTS (Draft 2.2, authorized by the verifier). Apply these to docs/spec/lld.md verbatim as your first commit, "Spec 2.2: custom step targets and boundary hardening", and touch no other spec text:
1. In §3.2, replace the `custom?:` line of `interface Step` with:
   custom?: { id: string; params: Record<string, ValueRef>; targets?: Record<string, TargetRef> };   // action === "custom"; `target` placeholders land in `targets`, never in `params`
2. In §5, replace the bullet beginning "IR: `action: "custom"`" with:
   - IR: `action: "custom"`, `custom.id` = file path plus export name, `custom.params` holds the `string|number|boolean|value` placeholders as ValueRefs, `custom.targets` holds the `target` placeholders as TargetRefs (so the recorder grounds them and the resolver resolves them exactly like `step.target`), `sideEffect` from the definition. A `target` placeholder must never be encoded as a literal in `params`.
3. In §1, after the bullet "Nothing above `surface` may import an `adapter-*` package directly ...", add:
   - The lint must resolve TypeScript sources for relative imports (an `eslint-import-resolver-typescript` or equivalent) and must also cover dynamic `import()` expressions; and a repository test must assert that no package's `package.json` declares a forbidden package under `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies`. With pnpm's strict isolation, the dependency-graph test is the guard that holds at run time; the lint is the guard that names the rule.
4. In §17, add as the first bullet:
   - Draft 2.2 (after Phase 0 verification): `Step.custom.targets` for Tier 0 `target` placeholders (§3.2, §5); import boundaries must resolve TypeScript sources, cover dynamic imports, and be backed by a package.json dependency-graph test (§1).

PHASE 0 CORRECTIONS (do these before any Phase 1 task):
F1 Boundary bypasses. Reproduce first: a relative import `../../gateway/src/index.js` from packages/runtime/src and `await import("@svatah/gateway")` from packages/runtime/src both pass `pnpm lint` today. Fix per LLD §1 as amended: add a TypeScript-aware import resolver; forbid dynamic imports of restricted specifiers (generate a no-restricted-syntax selector per package from BOUNDARIES in eslint.config.js); add a repo-check test that no packages/*/package.json declares a forbidden package in any dependency field; add both probes to tools/repo-checks/test/import-boundaries.test.ts so they must fail lint.
F2 execution.flow. Restore the original scenario names exactly (`start zoomcar booking`, `perform search`, `select date and time`, `select car and login`, `checkout the selected car`, `initiate payment`, `logout`) and one step per original step, in order; targets may be rephrased for apps/sample-web as D7 already states. Move the compensation showcase (cancel booking, onFailure=compensate, compose/test) to a new fixture evals/fixtures/flows/booking-compensation.flow. Change the name-preservation test to derive expected names by parsing the legacy originals under legacy/src/test/resources/sample, not from a hardcoded list. Correct evals/fixtures/README.md and record the full rename and step mapping under Deviations in the progress file.
F3 Custom-step targets. Update the Zod Step schema for custom.targets, regenerate packages/schema/json, add a refinement that a custom step's target placeholders appear in targets and never as literals in params, and fix golden entries g-148..g-150 and the docs/flow-language.md §6 example so `from`/`to` are TargetRefs with status "unbound".
F4 Read steps. Remove args.attribute from every Pattern 22 golden entry and the reference; capture.attribute is the only encoding.
F5 CI. Add bitbucket-pipelines.yml mirroring the Linux job of .github/workflows/ci.yml (install, build, typecheck, lint, licences, test, legacy compileJava). If a GitHub remote exists when you start, also push phase-1 and record the run URL. Otherwise record macOS and Windows as unverified.
F6 Progress file. Add the corrections and the verifier's Node 22 result to docs/spec/progress/phase-0.md under a "Post-verification corrections" section.

PHASE 1 SCOPE: tasks T1.1 through T1.9 in docs/spec/tasks.md, in order. Nothing from Phase 2. Phase 1 is module (a): @svatah/bindings for plain Playwright users, releasable on its own.

Decisions already made (do not re-open):
- Playwright is an adapter behind the published AgentSurface; the snapshot-with-refs mechanism is isolated in packages/adapter-playwright/src/snapshot.ts with the public ariaSnapshot() fallback (LLD §7.1).
- Module (a) must not import spec, steps, compiler, gateway, recorder, or trajectory (LLD §1). The healer's model step is the Regrounder plugin with a no-op default (LLD §10).
- bind() record mode in module (a) uses a headed interactive picker with provenance.model "human" (LLD §6.5). For CI, also provide a programmatic pick (an env var or fixture option naming the element by test id) so record mode is testable headless; document it as a test affordance, not a user feature.
- Playwright browsers: run `pnpm exec playwright install chromium` once; CI installs with --with-deps. Only chromium is required for Phase 1 validation; firefox and webkit action tests may be skipped with a recorded reason.
- Healing eval in T1.8 publishes the relocalize-only number honestly even if it is below 0.60; a number below threshold fails the eval gate but the report must still be produced and attached.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-1.md with the section reference and reason. Do not edit the four spec documents beyond the amendments above.
3. No model calls anywhere in Phase 1. No network beyond package and browser installation.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-1.md with, per correction F1..F6 and per task T1.1..T1.9: status (done | partial | blocked), the exact commands demonstrating each Validate item, and observed results; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install && pnpm exec playwright install chromium && pnpm -r build && pnpm -r test. Any extra command a Validate item needs is listed in the progress file.
- examples/plain-playwright: a project with no dependency on module (b) that records three bindings by programmatic pick, replays them headless with SVATAH_MODE=run, breaks on ?variant=3, and heals inline in SVATAH_MODE=heal with the annotation "healed" — as a test the verifier can run.
- The surface conformance suite passing for adapter-playwright: `svatah surface conform --adapter playwright` (or the pnpm script that wraps it).
- evals/healing report from `svatah eval healing --no-model` committed under reports/ with the relocalize-only number and the per-variant table.
- A dependency-tree test proving @svatah/bindings, @svatah/healer, @svatah/playwright-test, @svatah/adapter-playwright, @svatah/surface, @svatah/schema, @svatah/conformance resolve no module (b) package.
- Publishable 0.1.0 packages (pnpm pack output listed in the progress file); do not publish to npm.

When finished, print a summary table of F1..F6 and T1.1..T1.9 with status and commit hash, then stop. Do not begin Phase 2.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-1`:

1. Run `pnpm install && pnpm exec playwright install chromium && pnpm -r build && pnpm -r test`.
2. Re-run every command in `docs/spec/progress/phase-1.md` and compare observed to claimed results.
3. Re-run the F1 probes (relative `.js` import and dynamic import) and expect lint failures; inspect the dependency-graph test.
4. Confirm `execution.flow` scenario names and step count equal the legacy original by an independent parse.
5. Confirm the spec diff on the branch is exactly the four Draft 2.2 amendments.
6. Run the plain-playwright example in record, run, and heal modes; block the network to any model endpoint during run and heal.
7. Run the surface conformance suite and the healing eval independently and compare the relocalize-only number to the committed report.
8. Score on the same ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
