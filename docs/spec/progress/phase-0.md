# Phase 0 — progress and verification

Branch: `phase-0` · Date: 2026-09-02 · Scope: T0.1 … T0.6 of
[`../tasks.md`](../tasks.md). Phase 1 was not started.

## Summary

| Task | Title | Status | Commit |
|---|---|---|---|
| T0.1 | Freeze the Java project and clean the branch | done | `16e1a11` |
| T0.2 | Workspace skeleton and boundaries | done | `ca1502c` |
| T0.3 | Schema package with automation fields | done | `fa10b80` |
| T0.4 | Agent surface spec | done | `048bd60` |
| T0.5 | Sample web application with variants | done | `d1c77da` |
| T0.6 | Language reference and golden seed | done | `913d07c` |

Everything below was re-run from a **clean clone of `phase-0`** into an empty
directory, not from the working tree.

The four spec documents were not modified. `docs/spec/{requirements,hld,lld,tasks}.md`
are byte-identical to the source they were committed from, and
`git log -- docs/spec/requirements.md docs/spec/hld.md docs/spec/lld.md docs/spec/tasks.md`
lists only `16e1a11`, the commit that added them.

## The contract

```bash
pnpm install && pnpm -r build && pnpm -r test
```

Observed, on a fresh clone:

```
pnpm install   Done in 1.7s using pnpm v10.30.2                      exit 0
pnpm -r build  26 packages built (tsup, ESM + d.ts)                  exit 0
pnpm -r test   Test Files 13 passed (13)                             exit 0
               packages/schema      135 passed (135)
               packages/surface     133 passed (133)
               apps/sample-web      170 passed (170)
               tools/repo-checks    314 passed (314)
               ────────────────────────────────────
               752 tests, 0 failed
```

### Additional commands a Validate item needs

Each is listed again under the task that needs it.

| Command | What it demonstrates |
|---|---|
| `pnpm lint` | T0.2 — the LLD §1 import boundaries and the workspace lint. |
| `pnpm -r typecheck` | T0.2 — strict TypeScript across every package. |
| `pnpm check:licenses` | T0.2 — REQ-PKG-3. |
| `cd legacy && ./gradlew compileJava` | T0.1 — the frozen Java project still compiles. |
| `pnpm --filter sample-web start` | T0.5 — the sample app on port 4173. |
| `node scripts/eval-reports.mjs --out reports` | T0.2 — the release workflow's report step. |

Environment used: Node v25.6.1, pnpm 10.30.2, OpenJDK 17.0.12, macOS (darwin
25.3.0). The project targets Node 22 LTS (`.nvmrc`, `engines`, CI matrix); it was
verified here on the newer runtime that was available. See **Known gaps**.

---

## T0.1 — Freeze the Java project and clean the branch

**Status: done.** Commit `16e1a11`.

The Java project moved wholesale to `legacy/`. The eight uncommitted parser
classes and `PARSER_IMPROVEMENTS.md` are in `legacy/experiments/`, outside any
Gradle source set, with a `README.md` recording what each was and what superseded
it. The Draft 2 spec is committed under `docs/spec/`.

| Validate item | Command | Observed |
|---|---|---|
| `./gradlew compileJava` green from `legacy/` | `cd legacy && ./gradlew --no-daemon compileJava` | `BUILD SUCCESSFUL in 3s`, exit 0 |
| `git status` clean | `git status --short` | empty |
| HLD §12 matches the layout | `pnpm --filter @svatah/repo-checks test` → `test/layout.test.ts` | 30 assertions pass; the expected package list is parsed out of the HLD's own §12 block, so the test fails in either direction |

Additional assertions in `layout.test.ts` covering this task:

- `legacy/build.gradle` and `legacy/src/main/java` exist; `build.gradle` and `src/`
  no longer exist at the repository root.
- `legacy/experiments/` exists, holds `PARSER_IMPROVEMENTS.md`, and
  `legacy/src/main/java/.../parser/StepParser.java` does **not** exist — the
  experiments are frozen outside the compiled source set.
- `legacy/build.gradle` declares no `stanford-corenlp`, `onnxruntime` or
  `com.google.guava` dependency.

Note on the three dependencies: T0.1 says to remove them "if unreferenced". They
were never committed — they existed only in the uncommitted working tree the spec
was written against, alongside the parser classes. Since the parser classes are
the only thing that referenced them and those are now outside the source set, the
end state T0.1 asks for is reached by not introducing them. The layout test
asserts their absence so a future change cannot reintroduce them silently.

---

## T0.2 — Workspace skeleton and boundaries

**Status: done.** Commit `ca1502c`.

pnpm workspace at the repository root with all 24 packages from HLD §12 (each an
`src/index.ts` skeleton, a `package.json`, a `tsconfig.json` extending
`tsconfig.base.json`, and a `README.md`), `apps/sample-web`, and the four `evals/`
directories. One shared `tsup.config.ts` at the root, referenced by every package
as `tsup --config ../../tsup.config.ts`. vitest per package. Apache-2.0
throughout, with the licence text in `LICENSE`.

| Validate item | Command | Observed |
|---|---|---|
| CI green on three OSes | *not executable here* — see **Known gaps** | every step of `.github/workflows/ci.yml` was run locally instead, results below |
| A throwaway import from `bindings` to `compiler` fails the lint | `pnpm --filter @svatah/repo-checks test` → `test/import-boundaries.test.ts` | pass — the test writes the file, lints it, asserts the boundary error, deletes it |
| A throwaway import from `runtime` to `gateway` fails the lint | same | pass |
| Licence check passes | `pnpm check:licenses` | `Licence check OK — 304 package(s), 7 distinct licence(s): Apache-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, ISC, MIT, Python-2.0` |

The boundary failure, reproduced by hand from the clean checkout:

```
$ cat > packages/bindings/src/__probe__.ts <<'EOF'
import * as forbidden from "@svatah/compiler";
export const probe = forbidden;
EOF
$ cat > packages/runtime/src/__probe2__.ts <<'EOF'
import * as forbidden from "@svatah/gateway";
export const probe = forbidden;
EOF
$ pnpm exec eslint packages/bindings/src/__probe__.ts packages/runtime/src/__probe2__.ts
```

```
packages/bindings/src/__probe__.ts
  1:1  error  '@svatah/compiler' import is restricted from being used by a pattern.
             @svatah/bindings must not import @svatah/compiler. LLD §1: replay and module (a)
             packages must stay model-free and authoring-free (REQ-RUN-1)     no-restricted-imports
  1:1  error  '@svatah/compiler' import is restricted from being used by a pattern.
             @svatah/bindings must not import @svatah/compiler. LLD §1: module (a) must not
             depend on module (b)'s flow language (REQ-PKG-1)                 no-restricted-imports

packages/runtime/src/__probe2__.ts
  1:1  error  '@svatah/gateway' import is restricted from being used by a pattern.
             @svatah/runtime must not import @svatah/gateway. LLD §1: replay and module (a)
             packages must stay model-free and authoring-free (REQ-RUN-1)     no-restricted-imports

✖ 3 problems (3 errors, 0 warnings)
```

`import-boundaries.test.ts` also asserts the other two boundaries of LLD §1
(module (a) must not import the flow language; nothing above the surface may
import an adapter, except `cli` and `playwright-test` for the Playwright adapter
only), and — importantly — that the workspace **as committed** produces no
boundary error, so a rule that rejected everything could not pass.

Every CI step, run locally on the clean checkout:

| CI step | Command | Observed |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Build | `pnpm -r build` | exit 0, 26 packages |
| Typecheck | `pnpm -r typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0, no output |
| Licences | `pnpm check:licenses` | exit 0, `Licence check OK` |
| Test | `pnpm -r test` | exit 0, 752 tests |
| Legacy Java | `cd legacy && ./gradlew --no-daemon compileJava` | `BUILD SUCCESSFUL`, exit 0 |

The release workflow's report step:

```
$ node scripts/eval-reports.mjs --out reports
wrote reports/eval-compiler.md
wrote reports/eval-grounding.md
wrote reports/eval-healing.md
wrote reports/eval-conformance.md
```

---

## T0.3 — Schema package with automation fields

**Status: done.** Commit `fa10b80`.

`@svatah/schema` holds Zod definitions for every artifact in LLD §3 and the
agent-surface wire shapes of LLD §2, plus `canonicalJson` / `canonicalYaml` /
`canonicalHash` / `planHash` / `bindingsHash`. 32 JSON Schemas are generated at
build into `packages/schema/json/` and committed.

| Validate item | Command | Observed |
|---|---|---|
| Round-trip tests per schema | `pnpm --filter @svatah/schema test` → `test/round-trip.test.ts` | 79 pass — 19 artifacts × (parses, canonical-JSON round trip byte for byte, canonical-YAML round trip, rejects an unknown field) |
| Committed generated schemas with a drift test | `test/schema-drift.test.ts` | 42 pass — every registered schema is committed, nothing else is, each file matches the generator byte for byte, generation is deterministic |
| A binding without provenance is rejected | `test/provenance.test.ts` | pass |
| A Tier 2 step without provenance is rejected | `test/provenance.test.ts` | pass, for tiers 2 and 3; tiers 0 and 1 are accepted without it |
| `schemaVersion` constant `1.0.0` | `test/schema-drift.test.ts` | pass; also asserted on every generated file's `x-svatah-schema-version` and `$id` |

Total for the package: **135 tests, 0 failed.**

The automation fields Draft 2 added are asserted individually against the
*generated* files, not only the Zod objects: `guard`, `custom`, `invoke`,
`sideEffect`, `onlyIf`/`unless` in `ir.schema.json`; `signature`, `onFailure`,
`compensate`, `idempotent`, `secret` in `story.schema.json`; `aborted` and the
`guard` failure class in `results.schema.json`; `accessibilityId`, `resourceId`,
`automationId`, `controlPath`, `webmcp`, `coords` in `candidate.schema.json`;
`desktop` and `window` in `target-ref.schema.json`.

The 32 published schemas:

```
audit  binding-entry  bindings  candidate  checkpoint  config  fingerprint
invoker  ir  plan  predicate  proposal  provenance  results  signature  story
summary  target-ref  value-ref
surface.act  surface.api-request  surface.api-response  surface.capabilities
surface.capabilities-flags  surface.check  surface.element-description
surface.locate  surface.read  surface.session-init  surface.session-state
surface.snapshot  surface.snapshot-node
```

Reproduce the generation and confirm no drift:

```bash
pnpm --filter @svatah/schema build   # regenerates packages/schema/json/
git diff --exit-code packages/schema/json/
```

---

## T0.4 — Agent surface spec

**Status: done.** Commit `048bd60`.

`@svatah/surface` holds the `AgentSurface` interface exactly as LLD §2.1, the
adapter registry, the nine typed errors with their LLD §8.4 failure classes, the
snapshot text renderer, and the UIA / AX / Appium role tables.
`docs/agent-surface.md` is the contract for adapter implementers.

| Validate item | Command | Observed |
|---|---|---|
| Wire schemas committed | `ls packages/schema/json/surface.*.schema.json` | 13 files (see T0.3) |
| A mock adapter passes registry and error-type tests | `pnpm --filter @svatah/surface test` → `test/registry.test.ts` | 25 pass |
| The doc lists every method and every capability flag (test greps) | `test/doc-coverage.test.ts` | 92 pass |

Total for the package: **133 tests, 0 failed.**

`doc-coverage.test.ts` greps `docs/agent-surface.md` for all 14 surface methods
(each with its own row in the method table), all 9 capability flags, all 36
surface actions, all 17 candidate kinds, and all 9 error classes. It additionally
re-renders the three role tables from `packages/surface/src/roles.ts` and asserts
they are byte-identical to the blocks in the document, so the contract adapter
authors read cannot drift from the code adapters run.

`registry.test.ts` covers registration and selection by configuration, sorted
listing, the refusal to replace a registration silently, deliberate replacement
after `unregisterAdapter`, the error naming what *is* registered when the
configured adapter is missing, async factories, every required method present on
the mock, the mock's snapshot / act / describe / state output validating against
the published wire schemas, `locate` returning 0 / 1 / many, every error's failure
class, non-`SurfaceError` values classified `unknown`, and the capability gate.

---

## T0.5 — Sample web application with variants

**Status: done.** Commit `d1c77da`.

Ten pages, a plain `node:http` server, port 4173, twenty variants documented in
`apps/sample-web/VARIANTS.md`.

| Validate item | Command | Observed |
|---|---|---|
| Smoke test per page and variant | `pnpm --filter sample-web test` → `test/smoke.test.ts` | 59 pass — every page served, every variant × every page served, `/api/active-count`, the widgets LLD §16 requires |
| Each variant changes at least one binding-relevant property (DOM diff test) | `test/variant-diff.test.ts` | 65 pass |
| VARIANTS.md documents the twenty | `test/variants-doc.test.ts` | 46 pass |

Total for the app: **170 tests, 0 failed.**

Starting it, from the clean checkout:

```
$ pnpm --filter sample-web start
sample-web listening on http://127.0.0.1:4173
  10 pages, 20 variants (?variant=1..20)

$ curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4173/          → 200
$ curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4173/login     → 200
$ curl http://127.0.0.1:4173/api/active-count
{"activeCount":3,"updatedAt":"2026-09-02T10:00:00.000Z"}
$ curl 'http://127.0.0.1:4173/login?variant=5' | grep -o 'id="user-password"'
id="user-password"
```

The DOM diff compares a **binding signature** of every element — tag, `id`,
`name`, `data-testid`, `role`, `aria-label`, `placeholder`, `alt`, `title`,
`type`, `value`, `for`, classes, own text, sibling index and ancestor path,
which is exactly what LLD §3.3 candidates and fingerprints are built from. Three
assertions per variant: it changes at least one such property, it changes only
the pages it declares, and it changes every page it declares. Two more across the
set: no two variants make the same set of changes, and the set as a whole touches
`id`, `testid`, `ownText`, `classes`, `placeholder`, `labelFor`, `type`, `value`,
`tag`, `ancestorPath`, `siblingIndex` and `presence`.

The pages the four sample flows drive (home, login, dashboard shell with sidebar,
Schedule Build) are present, as are the widgets LLD §16 names: native
alert/confirm/prompt, single and multiple selects, an iframe with its own served
document, a link that opens a new tab, a file input, a drag pair, a canvas-only
control with no accessibility node, and `GET /api/active-count`.

---

## T0.6 — Language reference and golden seed

**Status: done.** Commit `913d07c`.

`docs/flow-language.md` (1,738 lines), `evals/compiler/golden.jsonl` (151
entries, 148 of them `tier: 1`), and the four hand-migrated fixtures under
`evals/fixtures/flows/` with their `data.yaml` and `api/active-count.yaml`.

| Validate item | Command | Observed |
|---|---|---|
| Every golden entry validates | `pnpm --filter @svatah/repo-checks test` → `test/golden.test.ts` | 151 per-entry assertions pass — each is parsed against `goldenEntrySchema`, materialised into a full `Step`, and validated against `ir.schema.json` |
| The doc names every `Action` value (test) | same file | 39 assertions pass, one per `Action`; also 24 for every predicate kind |
| At least 120 `tier: 1` entries | `grep -c '"tier":1' evals/compiler/golden.jsonl` | `148` |
| Patterns 1–30 with two examples each | `test/golden.test.ts` | pass — the doc has 30 `### Pattern N —` sections, each with at least two "compiles to" blocks, and every example in the doc is an entry in `golden.jsonl` |
| Hand-migrated v3 fixtures for the four sample flows | `test/golden.test.ts` | pass — each is free of sigils, inline locators, locator-type prefixes and v1 variable forms once comment lines are stripped, and each preserves the original's story and scenario names |

`tools/repo-checks` total: **314 tests, 0 failed** (boundaries, licences, layout,
golden, flow-language doc, fixtures).

Coverage of the golden set, asserted by the test rather than claimed here: all 30
patterns with ≥2 entries each, all 39 `Action` values, every predicate kind, every
kind of value reference (`literal`, `var`, `data`, `input`, `template`), and a
secret-bearing step. `custom` appears only at `tier: 0`, since no grammar can
produce it.

---

## Post-verification corrections

Phase 0 was verified after `71a009b`. The verifier ran the contract on **Node 22
LTS**, closing K2 below: `pnpm install && pnpm -r build && pnpm -r test` and the
additional commands all passed on Node 22, so the Node 25 result recorded above
is not the only evidence the workspace runs on its declared runtime. The three
operating systems of K1 were not closed — there is still no GitHub remote — and
that gap is narrowed, not removed, by F5.

The verification required four corrections, and the branch owner authorised two
spec amendments (Draft 2.2, applied to `docs/spec/lld.md` in `d436177`) to make
two of them expressible. Six commits on `phase-1` carry them:

| # | Correction | Commit | What it closed |
|---|---|---|---|
| F1 | Boundary bypasses | `31e6db8` | A relative import `../../gateway/src/index.js` from `packages/runtime/src`, and `await import("@svatah/gateway")` from the same place, both passed `pnpm lint` on `71a009b`. Reproduced first, then fixed with a TypeScript-aware import resolver, `no-restricted-syntax` selectors for dynamic imports, and a package.json dependency-graph test. Both probes are now cases in `tools/repo-checks/test/import-boundaries.test.ts`. |
| F2 | `execution.flow` | `f93289f` | The migration had renamed three of the original's seven scenarios and added a `cancel booking` scenario with `onFailure=compensate` metadata and compose/run blocks that the original never had. The original names and one-step-per-step order are restored; the compensation showcase moved to `evals/fixtures/flows/booking-compensation.flow`; the name-preservation test now parses the legacy originals instead of reading a hardcoded list. |
| F3 | Custom-step targets | `2827bea` | A Tier 0 `target` placeholder was encoded as a literal in `custom.params`, where the recorder never grounds it and the resolver never resolves it. `Step.custom.targets` added (Draft 2.2 §3.2, §5), JSON Schemas regenerated, two refinements added, `g-149`/`g-150` and `docs/flow-language.md` §6 corrected. |
| F4 | Read steps | `26aba10` | `g-083` carried the attribute name in `args.attribute` as well as in `capture.attribute`. `args` removed; the reference now states that `capture.attribute` is the only encoding; a golden assertion enforces it. |
| F5 | CI | `6c3c6a9` | `bitbucket-pipelines.yml` mirrors the Linux job of `.github/workflows/ci.yml`, with a test that keeps the two in step. K1 is narrowed: the workspace job is now runnable on the repository's own remote. macOS and Windows stay unverified. |
| F6 | This section | *this commit* | — |

Two further points the corrections make, recorded here so they are not lost:

- **The two boundary probes T0.2 shipped were the only shapes the configuration
  caught.** They were both static imports by package name. That is the shape
  `no-restricted-imports` sees, and it is the shape a developer writes by
  accident; it is not the shape that would be written to get around the rule.
  The dependency-graph test added in F1 is the guard that holds regardless of how
  an import is written, because under pnpm's strict isolation a package can only
  resolve what its `package.json` declares.
- **K5 is now closed by measurement, not by fixture.** The relocalization number
  the twenty variants were built for is measured in T1.5 and published by T1.8;
  see `phase-1.md`.

The rest of this document is the record as it stood at verification and has not
been edited: where a statement here contradicts one above, this section is the
later one.

---

## Deviations

Each is the closest faithful option, with the section it departs from and why.

### D1 — The `phase-0` branch includes the `dependency-updates-and-refactor` commit

*Working rule 1, T0.1.* The branch this session started on (`claude/session-f3646c`)
was at `master`, whose `build.gradle` uses Gradle 3.3, `jcenter()` and the removed
`compile` configuration. `./gradlew compileJava` cannot succeed there on any
supported JDK, so T0.1's first Validate item would be unreachable.

T0.1's text — "remove `stanford-corenlp` (three artifacts), `onnxruntime` and
`guava` from `build.gradle`" and "do not commit the six uncommitted parser
classes" — describes the working tree of the `dependency-updates-and-refactor`
branch, which is one commit ahead of `master` and modernises the Gradle build to
8.5 with current dependencies. That is the tree the spec was written against.

`phase-0` was therefore created from the current branch and fast-forwarded to
that single commit before T0.1's own work began. No content was invented; the
commit is the repository's own, already on `origin`.

### D2 — `gradle-wrapper.jar` is now committed, and `.gitignore` was corrected

*T0.1.* The wrapper jar was never tracked: `.gitignore` had `!gradle-wrapper.jar`
but a later `*.jar` rule overrode it. `./gradlew` therefore could not run from any
clean checkout. The negation was moved after `*.jar` and the jar force-added, so
T0.1's Validate item is reproducible by a verifier.

### D3 — Surface wire shapes are defined in `packages/schema`, re-exported by `packages/surface`

*LLD §2.5, T0.4.* T0.4 says the wire schemas are generated from Zod in
`packages/surface`; HLD §7 publishes them at
`packages/schema/json/surface.*.schema.json`, and LLD §1's dependency graph runs
`schema ◄── surface`.

Defining them in `surface` and emitting into `schema`'s directory would invert the
dependency, and `Checkpoint.session` (LLD §3.4) embeds `SessionState`, which
`schema` would then have to import from `surface`. The shapes are therefore
defined in `@svatah/schema` alongside every other published contract, and
`@svatah/surface` re-exports them and adds the interface, registry, errors,
renderer and role tables. The generated files land exactly where HLD §7 says.

### D4 — Sentence patterns 1–26 are derived, not transcribed

*LLD §4.2.* LLD §4.2 says "Patterns 1–26 are unchanged from Draft 1 and listed in
`docs/flow-language.md`". Draft 1 is not in the document set and
`docs/flow-language.md` did not exist, so there was nothing to transcribe.

They were derived from the two sources the LLD points at: the `Action` set of LLD
§3.2, and the synonym vocabulary in
`legacy/src/main/java/com/svatah/automator/mappers/ActionSynonyms.java` and
`SeleniumActionMapper.java`, which REQ-COMP-2 requires Tier 1 to accept. The 26
patterns cover every `Action` except `custom` (Tier 0, §6 of the document) and the
four Draft 2 additions, which are patterns 27–30 exactly as LLD §4.2 specifies.
The migration table in §8 maps each legacy action name onto its v3 sentence, so
the derivation is auditable against the Java source.

### D5 — Element id generation and a few silent shapes were chosen

*"Where the LLD is silent, choose the simplest option and record it."*

| Thing | LLD | Choice |
|---|---|---|
| Element id from a target phrase | §4.3 defers to Draft 1 | Drop a leading article, lower-case, replace runs of non-alphanumerics with `-`. *the sign in button* → `sign-in-button`. Documented in `docs/flow-language.md` §4. |
| `SessionState` | §2.1 says "url/window/frame/dialog; restorable subset" | `{ kind, url?, windowTitle?, windowIndex?, frame?, dialog?, storageState? }` |
| `ActArgs`, `ActResult`, `CheckResult`, `ElementDescription` | named but not shaped | The smallest shapes that carry what §6.4 relocalization, §7.4 synthesis and §8.2 execution read |
| `ApiRequest` / `ApiResponse` | REQ-ADP-2 lists the fields | One field per item in REQ-ADP-2's list |
| `Proposal` | HLD §6.6 names the artifact | An envelope carrying the flow draft, an optional compiled story, unverified bindings and mandatory provenance |
| Package names | HLD §12 names directories | `@svatah/<directory>`. The aggregate published modules of HLD §12 (`@svatah/bindings`, `@svatah/flow`) are assembled at publish time in T1.9. |
| Golden entry shape | not specified | `{ id, tier, pattern, rule, text, step }`, where `step` is the part the sentence determines; documented in `evals/compiler/README.md` |

### D6 — Two additions to the layout of HLD §12

*HLD §12.* Two directories exist that HLD §12 does not list:

- **`tools/repo-checks`** — a private, unpublished package holding the checks that
  span package directories: the import-boundary probes T0.2 requires, the licence
  check, the layout check, and the golden-set and documentation checks of T0.6.
  It exists so those run under `pnpm -r test` (the verification contract's only
  command) without putting repository tooling inside a product package. HLD §12
  describes the product packages; this is infrastructure. `layout.test.ts` still
  asserts that `packages/` contains exactly what HLD §12 lists and nothing else.
- **`scripts/`** — `check-licenses.mjs` (REQ-PKG-3) and `eval-reports.mjs`
  (REQ-PKG-4, the release workflow's report step).

`goldenEntrySchema` and the golden reader live in `tools/repo-checks/src/golden.ts`
for Phase 0 because no compiler exists yet. T4.4 builds `svatah eval compiler`, at
which point they move into `@svatah/compiler`; the file says so.

### D7 — `execution.flow`'s targets were rewritten

*REQ-LANG-11, REQ-NFR-8, T0.6.* Migration must preserve names and step order. It
did: every scenario name and every step of `execution.flow` is present, in order.
Its targets could not be preserved literally — the original drove a third-party
booking site entirely through inline XPaths (`~xpath://li[43]~`) against pages
that are not reproducible. Since v3 forbids locators in flows and the fixture must
be recordable against `apps/sample-web`, the targets are rewritten as the phrases
the equivalent controls carry there. `evals/fixtures/README.md` states this.

### D8 — `engines` is `>=22.0.0` rather than pinned to 22.x

*Working rule 5, REQ-NFR-7.* Node 22 LTS is the target: `.nvmrc` says `22`, the CI
matrix uses 22 on all three operating systems, and every `tsup` build targets
`node22`. `engines` is written `>=22.0.0` rather than `>=22 <23` so the repository
still installs on a newer runtime for local work; `engine-strict` is off. The
runtime this session had available was Node 25, which is why the distinction
mattered here.

---

## Known gaps

### K1 — The CI workflow cannot be shown passing on this branch

T0.2's Validate item is "CI green on three OSes" and the verification contract
asks for "the CI workflow from T0.2 present and passing on the branch".

`.github/workflows/ci.yml` is present and runs install, build, typecheck, lint,
licences and tests on `ubuntu-latest`, `macos-latest` and `windows-latest` on Node
22, plus a job compiling the frozen Java project. It cannot be observed passing
from here, for two independent reasons:

1. The repository's only remote is `git@bitbucket.org:a_t_u_l/automator.git`.
   There is no GitHub remote, so a GitHub Actions workflow has nowhere to run.
2. This session has no network access and no `gh` CLI, so nothing could be pushed
   or observed even if a GitHub remote existed.

What was done instead: every step of the workflow was executed locally against a
clean clone of `phase-0`, and the results are in the T0.2 table above. Windows and
macOS runners are the untested part — the work is pure TypeScript, Node and a
Gradle build with no native dependencies, but that is an argument, not evidence.

**To close this:** add a GitHub remote and push `phase-0`, or port the workflow to
Bitbucket Pipelines. The commands are unchanged either way.

*Update (F5):* the Bitbucket port exists — `bitbucket-pipelines.yml`, mirroring
the Linux job, with a test that keeps the two files in step. The Linux half of
this gap is closed on a runner the repository actually has; macOS and Windows are
still unverified.

### K2 — Verified on Node 25, not Node 22 LTS

The available runtime was Node v25.6.1. Everything targets and declares Node 22
(`.nvmrc`, `engines`, `tsup` `target: node22`, the CI matrix), but no Node 22
execution was observed *in this session*.

*Update:* the verifier ran the contract on Node 22 LTS and it passed, so the gap
is closed as a matter of evidence. `bitbucket-pipelines.yml` (F5) pins `node:22`,
so it stays closed on every push.

### K3 — Nothing executes a flow yet, by design

The four migrated fixtures under `evals/fixtures/flows/` are asserted to be
sigil-free, locator-free v3 files that preserve the originals' names — they are
**not** asserted to compile, because no compiler exists until T2.4/T2.5, or to run,
because no executor exists until T2.7. REQ-NFR-8's end-to-end run against
`apps/sample-web` is closed by T2.10, not by Phase 0.

The same applies to the golden set: its entries are validated against
`ir.schema.json`, not compared against compiler output. T2.4 is the first task that
can measure exact match, and `svatah eval compiler` arrives in T4.4.

### K4 — The eval reports are placeholders

`scripts/eval-reports.mjs` writes one Markdown report per suite and the release
workflow attaches them, so REQ-PKG-4's mechanism is wired and exercised from Phase
0. The reports currently say the suite is not yet runnable and name the task that
makes it so (T1.8 healing, T3.4 grounding, T4.4 compiler, T1.2 conformance). Each
of those tasks replaces its placeholder with the real `svatah eval` invocation.

### K5 — The 20 variants are not yet a measured healing number

`apps/sample-web` ships the variants and asserts each one breaks something a
binding reads. Whether relocalization actually recovers ≥60 % of bindings across
them is measured in T1.5 and published in T1.8. Phase 0 provides the fixture, not
the number.

*Update:* T1.5 and T1.8 are in Phase 1. The measured number and the per-variant
table are in `phase-1.md` and in the committed report under `reports/`.
