# Phase 0 — adversarial verification

Verifier: separate session · Date: 2026-09-02 · Subject: branch `phase-0` at `71a009b`
Method: clean detached worktree of `phase-0`; every claim in `docs/spec/progress/phase-0.md` re-run or probed; nothing taken from the implementer's transcript.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r test` | install ok, 26 packages built, 752 tests passed, 0 failed |
| `pnpm lint`, `pnpm -r typecheck`, `pnpm check:licenses` | all clean |
| `pnpm --filter @svatah/schema build && git status packages/schema/json` | no drift |
| `cd legacy && ./gradlew --no-daemon compileJava` | BUILD SUCCESSFUL |
| Same test suite on Node v22.23.2 | 752 passed (closes the report's K2) |
| Spec documents on the branch vs the verifier's copies | byte-identical |
| Sample app on port 4199: 10 pages, `/api/active-count`, variants 5, 9, 20 | behave as documented (renamed id, duplicate button, modal dialog role) |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 10 | Clean checkout, one command, all green; also green on Node 22 |
| 2 | Schema fidelity to LLD §3 | 9 | Every field, enum, and required list matches; provenance refinements enforced. One gap is in the LLD itself (custom-step targets, amended in Draft 2.2) |
| 3 | Test integrity | 7 | Drift, provenance, layout, boundary, variant-diff tests check real things. The fixture name-preservation test hardcodes the *new* names of `execution.flow`, so it cannot detect the rename it was written to prevent |
| 4 | Import boundary enforcement | 6 | Static `@svatah/*` imports and resolvable deep paths are caught. Two bypasses lint clean: a relative `../../gateway/src/index.js` import (node resolver cannot map `.js` to `.ts`, so the zone rule skips it) and `await import("@svatah/gateway")`. Both fail `tsc` today only by accident (`rootDir`, undeclared dependency), not by the rule the spec names |
| 5 | Migration fidelity of fixtures | 6 | `simple`, `svatah`, `natural_language_login`: names and step counts preserved. `execution.flow`: three scenarios renamed, one scenario added, `compose`/`test` blocks added, steps changed; the report and README state names and step count were preserved. The redesign is defensible; the claim is false and the deviation is unrecorded |
| 6 | Golden set and language reference | 8 | 151 entries, all 30 patterns, all 39 actions, all predicate kinds, 1,738-line reference with examples cross-checked by test. Tier 0 example encodes `target` placeholders as literals, contradicting the reference's own prose one paragraph above; `read`+`capture` entries duplicate the attribute in `args` and `capture` |
| 7 | Sample application and variants | 9 | All required widgets present including canvas-only control; 20 variants each verified to break a binding-relevant property; served and probed live |
| 8 | Report accuracy and candour | 7 | Unusually thorough, with honest known gaps (CI unobserved, Node 25). Marked down for the false `execution.flow` preservation claim repeated in three places |
| 9 | Workspace, layout, CI hygiene | 8 | 24 packages match HLD §12 by parsing the HLD; CI workflow correct on paper but unobserved (Bitbucket remote only); extra `tools/` and `scripts/` recorded as D6 |
| 10 | Deviation discipline and traceability | 8 | D1–D8 are precise and justified; the `execution.flow` redesign and the boundary limitations are the two deviations that should have been recorded and were not |

**Overall: 7.8 / 10.** Phase 0 is accepted with four corrections that must land before Phase 1's module (a) release (T1.9).

## Findings

**F1 — Import boundary bypasses (LLD §1, REQ-SURF-2, REQ-PKG-1).** Reproduce from a clean checkout:
```
printf 'import * as g from "../../gateway/src/index.js";\nexport const p = g;\n' > packages/runtime/src/__p1.ts
printf 'export const p = await import("@svatah/gateway");\n' > packages/runtime/src/__p5.ts
pnpm exec eslint packages/runtime/src/__p1.ts packages/runtime/src/__p5.ts   # exits 0, no errors
```
Fix: add a TypeScript-aware import resolver so zone rules see relative `.js` imports; forbid dynamic imports of restricted specifiers (`no-restricted-syntax` on `ImportExpression`, generated per package from `BOUNDARIES`); add a repo-check test that no `packages/*/package.json` declares a forbidden package in any dependency field; add both probes to `import-boundaries.test.ts`. LLD §1 was amended (Draft 2.2) to require this.

**F2 — `execution.flow` is a redesign reported as a migration (REQ-LANG-11, REQ-NFR-8, T0.6).** Renames: `start zoomcar booking`→`start booking`, `select car and login`→`select slot and login`, `checkout the selected car`→`checkout the selected slot`; added scenario `cancel booking`, `compose: book and pay`, `test: book and pay`, `onFailure=compensate:` metadata on three scenarios; several steps changed beyond target phrases. `evals/fixtures/README.md`, the progress report, and D7 all say names and steps were preserved; `golden.test.ts` line 221 asserts the new names. Fix: restore the original scenario names and one-to-one steps in `execution.flow` (targets may still be rephrased for the sample app, as D7 says); move the compensation showcase to a new fixture `booking-compensation.flow` for Phase 5; derive the name-preservation test's expected names from the legacy originals; record the rename mapping and every non-1:1 step in the deviations.

**F3 — Tier 0 `target` placeholders have nowhere to go (LLD §5 vs §3.2).** `custom.params` is `Record<string, ValueRef>`; the reference says a `target` placeholder "becomes a TargetRef", then encodes it as `{"kind":"literal","value":"accounts.current"}`. LLD §3.2 and §5 are amended (Draft 2.2): `custom.targets?: Record<string, TargetRef>`. Fix: update the Zod schema and regenerate, update golden entries g-148..g-150 and the §6 example so `from`/`to` are TargetRefs with `status: "unbound"`, and add a refinement that a `custom` step never carries a target phrase as a literal.

**F4 — Duplicate attribute encoding in `read` steps (LLD §3.2).** Pattern 22 entries carry both `args.attribute` and `capture.attribute`. Keep only `capture.attribute`; update the golden entries and the reference so the compiler has a single canonical shape.

**F5 — CI unobserved (REQ-NFR-7, T0.2).** The repository's only remote is Bitbucket. Either add a GitHub remote and push `phase-0` so the three-OS matrix runs, or add `bitbucket-pipelines.yml` mirroring the Linux job and record macOS/Windows as unverified until a GitHub remote exists. This is the owner's decision; the implementer should add the Bitbucket pipeline regardless.

**F6 — Report corrections.** Record F2's full mapping under Deviations; record F1 as a known limitation now closed; note the Node 22 run from this verification.

## What was confirmed beyond the report

- The `tools/repo-checks` layout test parses HLD §12 from the document, so a package added without a spec change fails.
- Every generated surface schema matches LLD §2.2 (node fields, ten states, capability flags).
- `legacy/src/main/java/.../parser` contains only the four original parser classes; the eight experiments are outside the source set and `legacy/build.gradle` is byte-identical to the committed original.
- The gitignore fix (`!legacy/gradle/wrapper/gradle-wrapper.jar` after `*.jar`) is what makes the Gradle validate item reproducible.
