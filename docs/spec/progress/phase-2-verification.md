# Phase 2 — adversarial verification

Verifier: separate session · Date: 2026-09-03 · Subject: branch `phase-2` at `3d285f9`
Method: clean detached worktree of `phase-2`; every claim in `docs/spec/progress/phase-2.md` re-run or probed; the verification contract's own probes constructed independently.

## Contract

| Command | Result |
|---|---|
| `pnpm install && pnpm browsers && pnpm -r build && pnpm -r test` | 29 packages built; 2,003 tests passed, 0 failed |
| Same suite on Node v22.23.2, twice | first run: 1 failure in `compiler/test/grammar.test.ts` (the 1,000-steps-in-1-s timing test) under parallel browser load; second run and three isolated runs: all pass |
| `pnpm lint`, `pnpm -r typecheck`, `pnpm check:licenses` | clean |
| Spec diff `phase-1..phase-2` | exactly the Draft 2.3 amendments; branch documents identical to the verifier's copies apart from bullet order in LLD §17 |
| `node scripts/compatibility.mjs` | plan byte-stable at `d81e7c7a…`; `--host none` twice and `--host playwright` twice identical over 40 steps; both hosts identical statuses and matches; 21 passed, 4 failed, 15 skipped; committed conformance fixture unchanged |
| `node scripts/migrate-legacy.mjs --check` and an independent `svatah migrate` of the legacy originals followed by `svatah compile` | check clean; 14 stories migrated; compile `ok: true`, zero diagnostics; original scenario names preserved |
| Module (a) packed (8 tarballs) and installed into an empty npm project with `@playwright/test` | only module (a) packages under `node_modules/@svatah`; `npx svatah-bindings --help` works |
| `pnpm quick-start` | 10.2 s; `examples/` unchanged |
| Healing eval, independent re-run | 92.3 % (48/52) no-test-ids, 0 wrong-element; identical to the committed report |
| **Negative control** (variant pages stamped with shuffled ground-truth keys) | 0 recovered, **48 wrong-element** — the ground-truth comparison is real |
| Local service | unauthenticated and wrong-token requests 401; `/health` and `/openapi.json` open; SSE stream carries `run.started`, `step.result`, `run.summary`; a four-flow run with story inputs supplied is step-for-step identical to the CLI fixture (40 steps) |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on a clean checkout on Node 25 and Node 22; one timing test is load-sensitive |
| 2 | Spec fidelity | 8 | Fourteen deviations, each grounded (run-block semantics read from the legacy parser, host context scoping, service injection). D6 departs from an explicit prompt decision with a sound argument; accepted and now written into the spec |
| 3 | Test integrity | 9 | 2,003 tests; the failing set of the compatibility run is held to exactly four by a repo check; the conformance fixture is canonical and diffed in CI; the ground-truth check survives a hostile control |
| 4 | Boundaries and packaging | 9 | Module (a) closed under its own dependencies and usable alone from tarballs; the service avoids a workspace cycle by injection |
| 5 | Phase 1 corrections | 9 | All six done and independently confirmed |
| 6 | Healing end to end | 5 | The eval is honest now, but `svatah heal --run <id>` cannot repair a real flow failure: the runtime replayer returns "reached" for a first step without navigating to the base URL, so relocalization runs on a blank page and reports `not-found`; the module (a) replayer reports `unreachable` because run results carry no session state. The report's K5 named the missing demonstration; the demonstration fails |
| 7 | Compiler and executor | 8 | Tier 1 at 148/148, byte-stable plans, policies, guards, checkpoints, audit redaction, and a sub-millisecond per-step overhead all verified. A malformed binding YAML crashes `svatah run` with a raw stack trace and no exit code |
| 8 | Local service | 7 | Auth, stream, run, and results verified identical to the CLI. A run of a story with required inputs and none supplied surfaces only as a failed pseudo-step `#0`; the service neither validates up front nor exposes signatures, which the ADE needs |
| 9 | Report accuracy and candour | 8 | Thorough and honest, including K5 and the four documented failures. Overstates that the `Replayer` "is unit-tested in both implementations" when neither implementation reaches a page from a run directory |
| 10 | Deviation discipline | 9 | D1–D14 precise with section references and reasons |

**Overall: 8.1 / 10.** Phase 2 is accepted with corrections. The heal cycle defect must be fixed and demonstrated before Phase 3's model-backed healing builds on it.

## Findings

**F1 — `heal --run` never reaches the failing page (REQ-HEAL-1, LLD §10, §12).** Reproduce: copy `evals/fixtures`, corrupt every candidate of `bindings/home/sign-in-button.yaml`, run `simple.flow` with `--host none` (step 1 fails with class `locator`), then `svatah heal --run r1 --base-url <app>`. Result: `not-found — nothing on the page scored above the threshold`, because `packages/cli/src/replayer.ts` returns `"reached"` when the failing step is the story's first without opening the flow's base URL, and `runStory` on a prefix never performs the flow-start navigation either. The module (a) `svatah-bindings heal --run r1` returns `unreachable` because `results.jsonl` failure records carry no session state (only a line in the message). Fix per LLD §10 and §3.4 as amended: both replayers perform the flow-start navigation with the configured storage state before replaying, and the executor writes `failure.session`. Add the end-to-end cycle (break, run, heal, apply, re-run green) as a test for both `svatah heal --run` and `svatah-bindings heal --run`.

**F2 — Malformed binding file crashes the run (REQ-RUN-9).** A binding YAML that fails to parse throws `DataError` out of `svatah run` as an uncaught exception with a stack trace and no results. Report it as a diagnostic naming the file, exit with the config-error code, and write nothing partial.

**F3 — Load-sensitive timing test (REQ-COMP-2).** `grammar.test.ts`'s 1,000-step budget failed once when the compiler suite ran alongside the Playwright suites on Node 22 and passed on every isolated run. Apply LLD §16 as amended: timing assertions run isolated from browser suites or use at least three times the requirement's budget.

**F4 — Service runs with missing inputs (REQ-ADE-1, REQ-AUTO-5).** `POST /run` on a story with required inputs and none supplied starts the run and reports a failed pseudo-step `#0` with class `data`. Per LLD §13.5 as amended: validate inputs against the signatures of directly invoked stories before starting, answer 400 with the missing names, and expose signatures in `GET /project`.

**F5 — Report correction.** State plainly that the heal-from-run cycle did not work in Phase 2 and record the two causes; remove the sentence implying the replayers were proven.

**F6 — Spec deviations absorbed (Draft 2.4).** D1, D2 (run-block semantics), D4 (`unverified`), D7 (host context), D8 (executor injection), D9 (service injection) are written into the spec so they stop being deviations. The ADE is developed in-repo under `apps/ade` until its first release.

## What was confirmed beyond the report

- The negative control is the decisive check: with keys shuffled on every variant page, every one of the 48 recoveries became `wrong-element`; the published number therefore measures correct relocalization.
- Migration on the raw legacy originals produces a project that compiles clean with every scenario name preserved, independent of the committed expected output.
- The service run is identical to the CLI run step for step once the same inputs are supplied, and the SSE stream delivers every step result in order.
- `svatah-bindings` runs from tarballs with no module (b) package installed.
