# Phase 1 — adversarial verification

Verifier: separate session · Date: 2026-09-02 · Subject: branch `phase-1` at `beb8b53`
Method: clean detached worktree of `phase-1`; every claim in `docs/spec/progress/phase-1.md` re-run or probed; nothing taken from the implementer's transcript.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ok |
| `pnpm exec playwright install chromium` (the contract's literal root command) | **fails**: `Command "playwright" not found`. The report substitutes `pnpm --filter @svatah/adapter-playwright exec playwright install chromium`. The suite passed here only because Chromium was already in the local Playwright cache |
| `pnpm -r build` | 27 packages, no errors |
| `pnpm -r test` | 1,228 passed, 0 failed (vitest 1,006; Playwright 222) |
| Same suite on Node v22.23.2 | 1,228 passed (closes the report's K3) |
| `pnpm lint`, `pnpm -r typecheck`, `pnpm check:licenses` | clean |
| `pnpm conform:playwright` | 16 cases, 72 checks, conformant |
| `pnpm eval:healing` | relocalize-only 92.3 percent (48/52), identical to the committed report apart from the timestamp |
| `pnpm quick-start` | 5.0 s of the 10-minute budget; leaves the three committed example bindings modified (`recordedAt`) |
| Spec diff `phase-0..phase-1` | `lld.md` only, exactly the four Draft 2.2 amendments |
| `execution.flow` vs legacy original (independent parse) | 7 scenario names identical, 31 steps each, block count identical |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 8 | Everything green on a clean checkout and on Node 22, but the contract's own browser-install line does not run at the root; a machine without a cached Chromium fails the contract as written |
| 2 | Spec fidelity | 8 | Surface, resolver, synthesis order and scores, relocalization weights and thresholds, binding files, and the `bind()` modes match the LLD. Three deviations (D15 runtime in module (a), D16 import path, D17 healer replay) are spec inconsistencies the implementer identified correctly; resolved in Draft 2.3 |
| 3 | Test integrity | 9 | Action and predicate coverage asserted from the schema constants; `git apply` exercised in a real repository; network guard enforced by replacing `fetch`; boundary probes live in the test suite; layout still parsed from the HLD |
| 4 | Import boundary enforcement | 9 | Both Phase 0 bypasses now fail lint; the dependency-graph and transitive-closure tests are the run-time guard. Computed specifiers and `createRequire` remain unlintable by nature and are caught only by the dependency tests, which is acceptable and should be stated |
| 5 | Phase 0 corrections | 9 | F1–F4 done and independently confirmed; F5 partial for want of a GitHub remote, with a Bitbucket pipeline and a parity test added |
| 6 | Healing eval honesty | 5 | Denominator and population choices are transparent and defensible, variant 7's zero is named. But `recovered` is granted whenever a re-synthesised candidate from the relocalized element is unique; the relocalized element is never compared with the ground-truth element, although the eval already computes an identity key at baseline. The 92.3 percent is therefore an upper bound, and the report's sentence "the score alone is never taken as proof" overstates what is checked |
| 7 | Module (a) adoption wedge | 8 | One dependency, one import, 5-second quick start, seven tarballs that install without module (b). No command-line path for module (a) users; the commands live in `@svatah/cli`, which depends on every module (b) stub |
| 8 | Report accuracy and candour | 8 | K1–K7 and D9–D18 are precise and candid, including the spec inconsistency in D15. Marked down for the eval wording in parameter 6 and for not stating that the root install line fails |
| 9 | Workspace, layout, CI hygiene | 8 | Bitbucket pipeline mirrors the Linux job with a parity test; CI still unobserved on any remote; Node 22 confirmed by the verifier |
| 10 | Deviation discipline | 9 | Every departure recorded with section references; D15 escalates a real spec contradiction instead of hiding it |

**Overall: 8.1 / 10.** Phase 1 is accepted. The healing number must be re-measured against ground truth before it is cited anywhere.

## Findings

**F1 — Healing recovery is not verified against ground truth (REQ-HEAL-5, T1.5, T1.8).** `packages/healer/src/eval.ts` marks a case `recovered` when relocalization proposes an element and a candidate re-synthesised from it resolves to exactly one element. Nothing compares that element with the one the binding pointed at on variant 0. On the duplicate-button variant, a confident relocalization to the wrong button counts as recovered. Fix per LLD §16 as amended: stamp `data-svatah-eval` keys in the sample app, read them outside the surface, compare after relocalization, exclude the attribute from synthesis and fingerprints through `bindings.ignoreAttributes`, re-run, and republish. Report both populations.

**F2 — The contract's root install command fails (T1.9, verification contract).** Add `playwright` to the root `devDependencies` from the catalog, or add a root script `pnpm browsers` and change the documented contract to `pnpm install && pnpm browsers && pnpm -r build && pnpm -r test`. The test that says a browser must be installed should also assert the documented command exists.

**F3 — `pnpm quick-start` mutates committed example bindings.** It records into `examples/plain-playwright/bindings`, rewriting `recordedAt` and, worse, the context `pattern`, which now carries the random port of that run (`http://127.0.0.1:65431/login`). A committed binding whose URL pattern embeds an ephemeral port is wrong on its own: the example should record `pattern` as a path (`/login`) or the configured base URL, and the quick start should record into a temporary copy and assert `git status --porcelain examples/` is empty at the end.

**F4 — Spec inconsistencies the implementer flagged (D15, D16, D17).** Resolved in Draft 2.3: `runtime` stays in module (b); the healer gets a `Replayer` plugin whose module (a) default is session-state restore; `playwright-test` is module (a) `bind()` only and the flow host moves to a new `host-playwright` package; `bind()` is imported from `@svatah/playwright-test`; a `bindings-cli` package gives module (a) users `svatah-bindings`. HLD §12 lists the two new packages, so the layout test requires their skeletons.

**F5 — Residual boundary limitations should be stated.** Computed dynamic specifiers and `createRequire` cannot be linted; the transitive-closure test is the guard. Add one sentence to `eslint.config.js` and to the import-boundaries test description.

**F6 — Report corrections.** Note the Node 22 result, the root install failure, and reword the eval's verification sentence until F1 lands.

## What was confirmed beyond the report

- The relative-`.js` and dynamic-import probes now fail lint with the boundary message; a resolvable deep path into `dist` also fails.
- `heal-job.spec.ts` initialises a git repository, applies `bindings.diff` with `git apply --check` and `git apply`, and re-runs the test.
- The lifecycle example replaces `fetch` for the process and refuses every host except the sample application, so "no model call" is enforced, not asserted.
- The candidate-kind breakage table (xpath 28, css 11, role 10) is consistent with the synthesis ranking; no reordering is warranted yet.
