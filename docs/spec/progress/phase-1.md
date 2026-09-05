# Phase 1 — progress and verification

Branch: `phase-1` (from `phase-0` at `71a009b`) · Date: 2026-09-02 · Scope: the
six Phase 0 corrections and T1.1 … T1.9 of [`../tasks.md`](../tasks.md). Phase 2
was not started.

## Summary

| Item | Title | Status | Commit |
|---|---|---|---|
| — | Spec 2.2: custom step targets and boundary hardening | done | `d436177` |
| F1 | Boundary bypasses | done | `31e6db8` |
| F2 | `execution.flow` | done | `f93289f` |
| F3 | Custom-step targets | done | `2827bea` |
| F4 | Read steps | done | `26aba10` |
| F5 | CI | partial — see K1 | `6c3c6a9` |
| F6 | Progress file | done | `d0473c3` |
| T1.1 | Playwright adapter | done | `d09653c` |
| T1.2 | Surface conformance suite (web) | done | `12f03eb` |
| T1.3 | Bindings store, context hash, resolver | done | `cb7c067` |
| T1.4 | Synthesis and fingerprinting | done | `ae6c822` |
| T1.5 | Relocalization | done | `77b625d` |
| T1.6 | `bind()` fixture with record, run and heal modes | done | `412d912` |
| T1.7 | Model-free healer job and diff | done | `b71f0ae` |
| T1.8 | Healing eval (relocalize-only) and publish | partial — see K2 | `2209f32` |
| T1.9 | Module (a) release | done | `1c533e4` |

The four spec documents were not modified beyond the Draft 2.2 amendments the
verifier authorised, which are `d436177` and touch `lld.md` only:

```
$ git log --format='%h %s' phase-0..HEAD -- docs/spec/requirements.md docs/spec/hld.md docs/spec/tasks.md
(nothing)
$ git log --format='%h %s' phase-0..HEAD -- docs/spec/lld.md
d436177 Spec 2.2: custom step targets and boundary hardening
```

## The contract

Everything below was re-run from a **clean clone of `phase-1`** into an empty
directory, not from the working tree.

```bash
pnpm install && pnpm exec playwright install chromium && pnpm -r build && pnpm -r test
```

Observed:

```
pnpm install --frozen-lockfile                         Done in 5.4s          exit 0
pnpm --filter @svatah/adapter-playwright \
     exec playwright install chromium                                        exit 0
pnpm -r build                                          27 packages built     exit 0
pnpm -r test                                                                 exit 0
    packages/schema             142 passed
    apps/sample-web             170 passed
    packages/surface            133 passed
    tools/repo-checks           399 passed
    packages/bindings           116 passed
    packages/conformance         10 passed
    packages/cli                 36 passed
    ──────────────────────────────────────  vitest      1,006 passed
    packages/adapter-playwright 179 passed  (45.4s)
    packages/playwright-test     34 passed  (1.3m)
    examples/plain-playwright     9 passed  (4.0s)
    ──────────────────────────────────────  Playwright    222 passed
                                            total       1,228 passed, 0 failed
```

**`pnpm exec playwright install chromium` is required**, and is the one addition
to Phase 0's contract: the adapter, host and example tests drive a real browser
(LLD §1: "Playwright Test for adapter and host tests"). Without it those three
suites fail with a message naming the command.

### Additional commands a Validate item needs

Each is listed again under the item that needs it. All were run from the clean
clone.

| Command | What it demonstrates | Observed |
|---|---|---|
| `pnpm lint` | F1 — the hardened LLD §1 import boundaries | exit 0, no output |
| `pnpm -r typecheck` | strict TypeScript across every package | exit 0 |
| `pnpm check:licenses` | REQ-PKG-3 | `Licence check OK — 316 packages, 7 licences` |
| `pnpm conform:playwright` | T1.2 — `svatah surface conform --adapter playwright` | 16 passed, 0 failed, 0 skipped, 72 checks |
| `pnpm eval:healing` | T1.5, T1.8 — REQ-HEAL-5's number | relocalize-only **92.3 %** (48/52), threshold 60 %: met |
| `pnpm quick-start` | T1.6 — REQ-PKG-2's ten minutes | 8.2 s of a 10-minute budget |
| `cd legacy && ./gradlew --no-daemon compileJava` | the frozen Java project still compiles | `BUILD SUCCESSFUL in 5s` |

Environment: Node v25.6.1, pnpm 10.30.2, Playwright 1.62.1 (chromium 1234),
OpenJDK 17, macOS (darwin 25.3.0). The project targets Node 22 LTS. See
**Known gaps**.

---

# Part 1 — the Phase 0 corrections

## F1 — Boundary bypasses

**Status: done.** Commit `31e6db8`.

**Reproduced first.** Both shapes passed `pnpm lint` on `phase-0`:

```bash
$ cat > packages/runtime/src/__probe_rel__.ts <<'EOF'
import * as forbidden from "../../gateway/src/index.js";
export const probeRel = forbidden;
EOF
$ cat > packages/runtime/src/__probe_dyn__.ts <<'EOF'
export async function probeDyn(): Promise<unknown> { return await import("@svatah/gateway"); }
EOF
$ pnpm exec eslint packages/runtime/src/__probe_rel__.ts packages/runtime/src/__probe_dyn__.ts
ESLINT EXIT=0          ← both accepted
```

The first is a resolver gap: `import/no-restricted-paths` works on *resolved*
paths, and with no TypeScript-aware resolver the `.js` specifier ESM requires
resolves to nothing, so the rule skips it silently. The second is a rule gap:
`no-restricted-imports` does not visit import expressions at all.

After the fix, the same two files:

```
packages/runtime/src/__probe_dyn__.ts
  2:23  error  @svatah/runtime must not import @svatah/gateway. LLD §1: replay and
               module (a) packages must stay model-free …          no-restricted-syntax

packages/runtime/src/__probe_rel__.ts
  1:28  error  Unexpected path "../../gateway/src/index.js" imported in restricted zone.
               @svatah/runtime must not import @svatah/gateway …   import/no-restricted-paths

✖ 2 problems (2 errors, 0 warnings)          ESLINT EXIT=1
```

| Validate item | Command | Observed |
|---|---|---|
| A TypeScript-aware import resolver | `pnpm lint` | `eslint-import-resolver-typescript` (ISC) configured on the block that owns `import/no-restricted-paths`; relative specifiers, static and dynamic, now resolve onto the `.ts` files |
| Dynamic imports of restricted specifiers forbidden | `pnpm --filter @svatah/repo-checks test` → `import-boundaries.test.ts` | a `no-restricted-syntax` selector pair per package, generated from the same `BOUNDARIES` list, covering `import("@svatah/x")` and `require("@svatah/x")` |
| A repo-check test on `package.json` dependency fields | same | `describe("package.json dependency graph")` — every `packages/*/package.json`, all four dependency fields |
| Both probes are cases in `import-boundaries.test.ts` | same | 38 tests, including the relative import, the dynamic import, and a relative *dynamic* import |

`BOUNDARIES` is exported from `eslint.config.js` (with `eslint.config.d.ts` for
strict consumers) so the lint and the test read one list and cannot drift.

The dependency-graph test is the guard that holds at run time, and the commit
message says why: under pnpm's strict isolation a package can only resolve what
its `package.json` declares, so a forbidden import fails at run time however it
is written. The lint is the guard that *names* the rule.

## F2 — `execution.flow`

**Status: done.** Commit `f93289f`.

The first migration renamed three of the original's seven scenarios, added a
scenario it never had, hung `onFailure=compensate` on three of them, and appended
compose and test blocks.

| Validate item | Command | Observed |
|---|---|---|
| The original scenario names, exactly | `pnpm --filter @svatah/repo-checks test` → `golden.test.ts` | pass — the names are parsed out of `legacy/src/test/resources/sample/execution.flow`, not read from a list |
| One step per original step, in order | same | pass — per-scenario step counts compared against the original |
| The compensation showcase moved | same | pass — `execution.flow` has no `onFailure`, no `compose:` and no `test:`; `booking-compensation.flow` has all three |
| `evals/fixtures/README.md` corrected | review | the new fixture is in the table, and the section explains that it is not a migration |

The name-preservation test derives its expectations. Verified by renaming one
scenario and watching it fail:

```
$ sed -i '' 's/^scenario: select car and login$/scenario: select slot and login/' \
      evals/fixtures/flows/execution.flow
$ pnpm --filter @svatah/repo-checks test
→ execution.flow lost the name "select car and login" from the original
```

The full rename and step mapping is deviation **D9** below.

## F3 — Custom-step targets

**Status: done.** Commit `2827bea`.

| Validate item | Command | Observed |
|---|---|---|
| Zod `Step` schema gains `custom.targets` | `pnpm --filter @svatah/schema test` | 142 pass, including 7 new cases for the targets map |
| `packages/schema/json` regenerated | `pnpm --filter @svatah/schema build && git diff --exit-code packages/schema/json/` | exit 0 — `ir`, `plan`, `story` and `proposal` carry `custom.targets` |
| A refinement rejects a target as a literal in `params` | `provenance.test.ts` | pass — a name in both maps, and a `params` literal repeating an element id or phrase the step already grounds |
| `g-149`/`g-150` and `docs/flow-language.md` §6 | `golden.test.ts` | pass — `from` and `to` are TargetRefs with `status: "unbound"` |

Verified the golden assertion catches a regression by putting `g-149` back to
literals:

```
→ g-149: custom.params.from is the literal "accounts.current", which is shaped like
  an element id. A target placeholder belongs in custom.targets.
```

`g-148` is a Tier 1 click with no placeholders and `g-151`'s only placeholder is a
string, so neither changed; the two entries in the range that had target
placeholders are the two that moved.

The refinement is **exact**, not a value-shape heuristic, and deviation **D10**
explains why.

## F4 — Read steps

**Status: done.** Commit `26aba10`.

| Validate item | Command | Observed |
|---|---|---|
| `args.attribute` removed from every Pattern 22 entry | `pnpm --filter @svatah/repo-checks test` → `golden.test.ts` | pass — `g-083` was the only one; a new assertion rejects `args.attribute` on any read step |
| The reference states the encoding | review of `docs/flow-language.md` Pattern 22 | says `capture.attribute` is the only encoding, and shows the attribute example's IR |

## F5 — CI

**Status: partial.** Commit `6c3c6a9`. See **K1**.

| Validate item | Command | Observed |
|---|---|---|
| `bitbucket-pipelines.yml` mirrors the Linux job | `pnpm --filter @svatah/repo-checks test` → `ci.test.ts` | 7 pass — every shell command in the GitHub workspace job appears, in order, in the Bitbucket workspace step; the Java job exists in both; both pin Node 22; the GitHub matrix still names three operating systems |
| A GitHub remote exists → push and record the run URL | `git remote -v` | `origin  git@bitbucket.org:a_t_u_l/automator.git` — **no GitHub remote**, so nothing was pushed and there is no run URL |
| macOS and Windows | — | **unverified.** Bitbucket's hosted runners are Linux only |

Both files gained a `quick-start` job during T1.6 and a chromium install before
the tests; `ci.test.ts` holds them in step.

## F6 — Progress file

**Status: done.** Commit `d0473c3`.

`docs/spec/progress/phase-0.md` gained a "Post-verification corrections" section
listing F1..F6 with their commits and what each closed, and the verifier's Node 22
LTS result. K1, K2 and K5 there carry dated updates rather than being rewritten,
and the new section says it is the later one where the two disagree.

---

# Part 2 — Phase 1

## T1.1 — Playwright adapter

**Status: done.** Commit `d09653c`.

`AgentSurface` on Playwright: session, snapshot with references, `locate` for
every candidate kind including `coords`, `describe`, every action, `check` for
every predicate, dialogs, windows, frames, masked screenshots, `state`/`restore`,
tracing, capabilities.

```bash
pnpm --filter @svatah/adapter-playwright test        # 179 passed
```

| Validate item | How | Observed |
|---|---|---|
| One test per action and predicate on `apps/sample-web` | `test/actions.spec.ts`, `test/predicates.spec.ts` | every one of the 36 surface actions and all 24 predicate kinds, each test run twice — once per snapshot mechanism |
| Snapshot refs resolve back to the same element | `test/snapshot.spec.ts` | asserted for **every node of every sample page**, not a sample; and for acting through a snapshot reference |
| `restore` returns to URL and storage state | `test/session.spec.ts` | both — a cookie is written, cleared, and restored from a storage-state file |
| Capabilities match the implementation | `test/session.spec.ts` | each claimed flag is paired with the call that proves it; `webmcp` is asserted **false** until REQ-ADP-9 |

Coverage is read from the test titles, not from a hand-kept list: each test tags
what it exercises in `[brackets]`, and three tests grep the spec's own source
against `SURFACE_ACTIONS`, `PREDICATE_KINDS` and `CANDIDATE_KINDS` from the
schema. A vocabulary cannot grow without a test appearing.

**The two snapshot mechanisms** (LLD §7.1) are both implemented and both tested,
which is HLD §14's mitigation for "Playwright internal snapshot API changes" made
real rather than promised:

- `playwright` — Playwright's ref-producing ARIA snapshot, resolved back through
  the public `aria-ref=` selector engine;
- `own` — a walker injected into the page assigning `rN` in document order over
  an in-page registry, using no Playwright internal at all.

`SVATAH_PW_SNAPSHOT=own|playwright|auto` selects; `auto` probes and falls back,
so removing the internal call degrades rather than breaks.
`test/snapshot.spec.ts` additionally holds the own-refs walker's roles and names
against Playwright's public `ariaSnapshot()`.

firefox and webkit: **not run.** Only chromium is required for Phase 1
(deviation **D11**). Both are declared as Playwright projects behind
`SVATAH_PW_BROWSERS=all`.

## T1.2 — Surface conformance suite (web)

**Status: done.** Commit `12f03eb`.

```bash
pnpm conform:playwright
#   16 passed, 0 failed, 0 skipped (72 checks, 0 failed) in 6942 ms
#   "playwright" is conformant.
```

Or against any deployment:

```bash
svatah surface conform --adapter playwright --base-url http://127.0.0.1:4173
```

| Validate item | How | Observed |
|---|---|---|
| The Playwright adapter passes | `packages/adapter-playwright/test/conformance.spec.ts` | 16 cases, 72 checks, 0 skipped, on **both** snapshot mechanisms; the report is attached whether or not it passed |
| A deliberately broken mock adapter fails with a readable report | `packages/conformance/test/surface-suite.test.ts` | 10 pass — eight named faults, and the test asserts the report names *each one* with its expectation and its observation, not merely that something failed |

That the broken-adapter half needs no browser is itself the evidence for
REQ-SURF-3: the suite is handed an `AgentSurface` and knows nothing else.

This shook two real gaps out of T1.1: Playwright's snapshot renders `[checked]`
only when true and never renders `required` or `readonly`, so `unchecked` is now
derived in the parser and the other two are read from the elements; and a case an
adapter's capabilities exclude is **skipped with a reason**, never silently
passed.

## T1.3 — Bindings store, context hash, resolver

**Status: done.** Commit `cb7c067`.

```bash
pnpm --filter @svatah/bindings test        # 116 passed
```

| Validate item | How | Observed |
|---|---|---|
| Round-trip byte identity | `test/store.test.ts` | write, load, rewrite: **nothing is rewritten**; two stores built in different orders produce identical files and identical hashes |
| Resolver matrix with a stub surface | `test/resolver.test.ts` | 17 cases — ordering, cardinality, `nth` in and out of range, per-candidate timeout, a throwing candidate, the `webmcp` preference in its three states, and the error's contents |
| Hash invariance to text, sensitivity to structure | `test/context.test.ts` | names within a bucket, values, references and boxes do not move it; an added, removed, reordered or re-roled node, a changed state and an inserted wrapper do |

Two things the tests assert that are worth reading as claims rather than checks:

- Two structurally identical nodes swapped deliberately do **not** move the hash.
  They are indistinguishable by shape, and a hash that moved there would report
  drift on every page whose fields were reordered without being renamed. Telling
  them apart is the fingerprint's job (LLD §6.4), not the context hash's.
- Depth is recomputed from the parent chain rather than read off the node, so an
  adapter that miscounts cannot fake a context.

The structural hash primitive moved to `@svatah/surface` — an adapter fills in
`Snapshot.hash` and `@svatah/bindings` hashes a subtree, and `surface` is the one
package both may depend on (LLD §1). Deviation **D12**.

## T1.4 — Synthesis and fingerprinting

**Status: done.** Commit `ae6c822`.

```bash
pnpm --filter @svatah/bindings test           # the pure functions
pnpm --filter @svatah/playwright-test test    # the browser-backed half
```

| Validate item | How | Observed |
|---|---|---|
| For every interactive element on every sample page, the top candidate resolves uniquely to that element | `packages/playwright-test/test/synthesis.spec.ts` | **106 elements across 8 pages**, each verified to resolve to one element *and* to the same element — not merely to one |
| Fingerprints stable across reloads | same | every element on every page, keyed by an identity that survives a reload since references do not |
| Snapshot of bundles committed for review | `packages/playwright-test/test/__snapshots__/candidate-bundles.json` | 106 bundles, with a drift test; `SVATAH_UPDATE_BUNDLES=1` rewrites it |

The ranking is the substance: testid, id, role + name, label, placeholder, name,
alt, title, text, anchored CSS, relative XPath, ordered by how much of the
application has to change before each stops being true. A candidate matching more
than one element is dropped (REQ-REC-3), and so is one that uniquely matches the
*wrong* element — which is worse, because it would resolve at replay and act on
something else.

The adapter now puts `cssPath`, `xpath` and `stableClasses` into `native`, which
is exactly the use LLD §2.2 reserves it for. The paths are anchored at the
nearest ancestor with a stable identity:

```
[data-testid="builds"] > tbody:nth-of-type(1) > tr:nth-of-type(2) > td:nth-of-type(1)
```

rather than a chain from `body` that breaks whenever anything above it moves.

## T1.5 — Relocalization

**Status: done.** Commit `77b625d`.

```bash
pnpm --filter @svatah/bindings test          # component tests
pnpm eval:healing                            # the variant measurement
```

| Validate item | How | Observed |
|---|---|---|
| Component tests on synthetic descriptions | `packages/bindings/test/relocalize.test.ts` | 30 cases over the five measures, the threshold, the margin and the three outcomes |
| Record on 0, relocalize on 1..20: ≥ 60 % recovered | `packages/playwright-test/test/relocalize.spec.ts`, and `pnpm eval:healing` | **48 of 52 degraded bindings recovered — 92.3 %.** Zero wrong-element repairs |
| No false accept on the duplicate-buttons variant | same | two tests, below |

The weights are LLD §6.4's exactly: `0.30·attrs + 0.25·text + 0.20·neighbours +
0.15·rolePath + 0.10·box`, threshold 0.72, margin 0.10.

**The duplicate-buttons variant needed two tests, and the reason matters.**
Variant 9's duplicate sits in a sticky footer, so the fingerprint's role path and
neighbour text still separate the two — relocalization *should* find the original,
and the requirement "no false accept" has two acceptable answers: find the
original, or refuse. The first test asserts it never lands on the duplicate. The
second clones the button in place, inside the same form, where nothing in the
fingerprint can choose, and asserts it refuses (`ambiguous`).

Variant 7 (logout became an icon-only button) is the one relocalization does not
survive: 0 of 4. It removes the text, which four of the five measures were
reading. It is in the per-variant table rather than smoothed away.

## T1.6 — `bind()` fixture with record, run and heal modes

**Status: done.** Commit `412d912`.

```bash
pnpm --filter example-plain-playwright test    # 9 passed
pnpm quick-start                               # 8.2s of a 10-minute budget
pnpm --filter @svatah/cli test                 # the bindings CLI
```

| Validate item | How | Observed |
|---|---|---|
| A plain Playwright project records three bindings by picker | `examples/plain-playwright/tests/lifecycle.spec.ts` phase 1 | 3 recorded, each written as a reviewable YAML file with `provenance.model: "human"` |
| Replays headless with the model endpoint blocked | phase 2 | **enforced, not asserted**: `fetch` is replaced for the duration with one that throws for any host but the application, so a model call is impossible rather than merely absent |
| Breaks on `?variant=3`, heals inline | phase 3 | the binding fails, relocalization finds the field, the test continues |
| The annotation reads `healed` | phase 3 | `testInfo.annotations` carries `type: "healed"` naming the element |
| Quick start under ten minutes, from a fresh checkout | `pnpm quick-start`, and a CI job in both workflow files | 8.2 s; the job then runs `git diff --exit-code` on the committed bindings, so re-recording must reproduce them byte for byte |
| `svatah bindings list\|show\|verify\|prune` | `packages/cli/test/bindings.test.ts`, and by hand against the example | 13 tests; `verify` dry-resolved all three bindings against a live application |

**One thing the example had to be honest about.** Variant 3 does *not* break a
fully synthesised binding — it invalidates the CSS path and the XPath, and the
bundle carries six other candidates. A test asserting it did would have been a
lie. So the spec asserts that favourable fact directly, and then heals the binding
a project arriving from hand-written locators actually has: one XPath, the shape
`svatah migrate` will produce from a v1 `.locator` file, which variant 3 does
break. The test proves that XPath resolved before the change and does not after,
so the repair is a repair and not a coincidence.

`SVATAH_PICK` is documented in three places as a test affordance rather than a
feature — reaching for it in a real project means writing selectors again.

## T1.7 — Model-free healer job and diff

**Status: done.** Commit `b71f0ae`.

```bash
pnpm --filter @svatah/playwright-test test    # heal-job.spec.ts — 8 of the 34
pnpm --filter @svatah/cli test                # heal.test.ts
```

| Validate item | How | Observed |
|---|---|---|
| Failure, heal, diff applies with `git apply`, re-run passes | `packages/playwright-test/test/heal-job.spec.ts` | in a throwaway git repository: `git apply --check`, then `git apply`, then the repaired binding resolves on the broken page and resolves to the right element |
| Unrepairable reported | same | a fingerprint for an element not on the page comes back `not-found` with a sentence saying why, an empty diff, and a report section headed "Not repaired" |
| Plan and flows untouched | same | `git diff --name-only` returns exactly `bindings/login/username-field.yaml` |
| `Regrounder` plugin with a no-op default | same | the default returns `null`; a registered stand-in is used and reported, proving the seam carries |

Also verified by hand through the CLI, which is the path a person uses:

```bash
$ svatah heal --from-bind-failures --base-url http://127.0.0.1:4173
wrote .svatah/heal/bindings.diff and .svatah/heal/report.md
Heal — 1 locator failure from bindings

  ok    login.username-field  repaired  1.000 (runner-up 0.622)
          now: testid, id, role, label, placeholder, name, css, xpath

  1 repaired by relocalization, 0 re-grounded, 0 unrepaired.
  No model was used: relocalization only, with the no-op Regrounder (LLD §10).
  The unrepaired are reported, not dropped.

$ git apply --check .svatah/heal/bindings.diff && git apply .svatah/heal/bindings.diff
$ git diff --stat
 bindings/login/username-field.yaml | 68 ++++++++++++++++++++++++++++++-----
```

**This found a real bug, and the fix is the substance of the task.** A repaired
entry's context hash has moved — the page's shape changed, which is *why* the
binding broke — so `BindingsStore.put` treated it as a new context and kept both
entries, with the broken one first. LLD §6.3 selects by hash, then pattern, then
position, so the next run would have resolved the broken entry and failed exactly
as before: a repair that repaired nothing. The first run of the CLI check
produced a file with two entries and `102 insertions(+)`; after the fix it is one
entry and `63 insertions(+), 5 deletions(-)`. `put` now takes `replaces`, and two
tests hold it.

## T1.8 — Healing eval (relocalize-only) and publish

**Status: partial.** Commit `2209f32`. See **K2**.

```bash
pnpm eval:healing
#   healing eval — relocalize-only 92.3% (48/52 degraded bindings recovered),
#   threshold 60%: met
```

| Validate item | How | Observed |
|---|---|---|
| Threshold 0.60 met | `svatah eval healing --no-model` | **92.3 %** |
| A Markdown report | `reports/eval-healing.md` | committed; `tools/repo-checks/test/reports.test.ts` holds it to being a real result with a stated method, all twenty variants, and no model |
| The release workflow attaches it | `.github/workflows/release.yml` | `node scripts/eval-reports.mjs --out reports` now delegates the healing suite to the CLI; the attach step and the browser install are asserted by `reports.test.ts` |
| Report artifact present on a tagged pre-release | — | **not shown.** No GitHub remote to tag. See **K2** |

The report is written and printed *before* the threshold gate exits, and
`scripts/eval-reports.mjs` collects failures and exits non-zero only after every
report is on disk. That order is HLD §14's mitigation for "healing numbers
disappoint" — publish anyway — made operative.

The report's numbers, from the clean clone:

| | |
|---|---|
| Bindings recorded at variant 0 | 106 |
| Locator cases examined (candidate × variant) | 2,825 |
| Locators broken | 66 |
| Bindings that stopped resolving entirely | **0** |
| Bindings degraded (at least one candidate broken) | 52 |
| Recovered by relocalization | 48 (92.3 %) |
| Not found | 4 |
| Refused as ambiguous | 0 |
| Proposed but unverifiable | 0 |

Two decisions in the method were forced by measurement rather than chosen, and
both are deviations: **D13** (the number is taken over *degraded* bindings,
because no binding ever stopped resolving) and **D14** (recording is done with
test-id attributes disabled).

## T1.9 — Module (a) release

**Status: done.** Commit `1c533e4`.

Nothing was published to npm. The seven packages pack and install:

```bash
for p in schema surface adapter-playwright bindings healer playwright-test conformance; do
  pnpm --filter @svatah/$p exec pnpm pack --pack-destination /tmp/svatah-pack
done
```

| Tarball | Bytes | Dependencies |
|---|---|---|
| `svatah-schema-0.1.0.tgz` | 86,583 | `yaml`, `zod`, `zod-to-json-schema` |
| `svatah-adapter-playwright-0.1.0.tgz` | 64,748 | `playwright`, `@svatah/surface`, `@svatah/schema` |
| `svatah-bindings-0.1.0.tgz` | 45,277 | `yaml`, `@svatah/schema`, `@svatah/surface` |
| `svatah-healer-0.1.0.tgz` | 35,610 | `@svatah/bindings`, `@svatah/surface`, `@svatah/schema` |
| `svatah-playwright-test-0.1.0.tgz` | 21,476 | `playwright`, `@svatah/adapter-playwright`, `@svatah/bindings`, `@svatah/healer`, `@svatah/surface`, `@svatah/schema`; **peer** `@playwright/test >=1.50.0` |
| `svatah-conformance-0.1.0.tgz` | 21,253 | `@svatah/surface`, `@svatah/schema` |
| `svatah-surface-0.1.0.tgz` | 19,832 | `@svatah/schema` |

| Validate item | How | Observed |
|---|---|---|
| `npm install` in a clean Playwright project works | by hand, commands below | record and run both pass |
| Module (a) has no dependency on module (b) (test inspects the dependency tree) | `tools/repo-checks/test/packaging.test.ts` | three tests: each package's transitive closure holds no module (b) package; module (a) is closed under its own dependencies; nothing but the adapter and the host brings a browser runner |
| README with the quick start and the healing numbers | `README.md`, asserted by `packaging.test.ts` | both, with a link to the method |

The clean install, reproducible:

```bash
mkdir clean-pw && cd clean-pw
npm install --save-dev @playwright/test@1.62.1 \
  /tmp/svatah-pack/svatah-{schema,surface,adapter-playwright,bindings,healer,playwright-test}-0.1.0.tgz
# → node_modules/@svatah/ holds exactly: adapter-playwright bindings healer
#   playwright-test schema surface — and no module (b) package
SVATAH_MODE=record SVATAH_PICK='{"login.username-field":"username", …}' npx playwright test   # 1 passed
SVATAH_MODE=run npx playwright test                                                           # 1 passed
```

Packing found two real faults, fixed in this commit: three module (a) packages
declared `@svatah/runtime`, which HLD §12 publishes inside module (b); and
`@svatah/playwright-test` had `@playwright/test` as a dependency as well as a
peer. See deviation **D15** for the first, which is not fully resolved.

---

## Deviations

Each is the closest faithful option, with the section it departs from and why.
D1–D8 are in [`phase-0.md`](phase-0.md); this file continues the numbering.

### D9 — `execution.flow`: the rename and step mapping

*F2, D7, REQ-LANG-11.* Every scenario name is the original's verbatim and there
is one step per original step, in order. Only the targets are rewritten, as D7
already licensed, because the original drove a third-party booking site through
inline XPaths against pages that are not reproducible.

| # | Original scenario | v3 scenario | Steps |
|---|---|---|---|
| 1 | `start zoomcar booking` | *unchanged* | 1 |
| 2 | `perform search` | *unchanged* | 5 |
| 3 | `select date and time` | *unchanged* | 7 |
| 4 | `select car and login` | *unchanged* | 5 |
| 5 | `checkout the selected car` | *unchanged* | 2 |
| 6 | `initiate payment` | *unchanged* | 9 |
| 7 | `logout` | *unchanged* | 2 |

Step by step, original → v3:

| Scenario | Original step | v3 step |
|---|---|---|
| start zoomcar booking | `+click+ … search tab … ~linkText:Start your wonderful journey~` | `Click the Book a slot link` |
| perform search | `+click+ … search bar ~xpath://input[@type='text']~` | `Click the location field` |
| | `+clear+ the search bar …` | `Clear the location field` |
| | `+type+ … *indra* in the search bar …` | `Type "indra" into the location field` |
| | `+click+ … suggested location as Indranagar …` | `Click the Indiranagar suggestion` |
| | `+click+ … next button ~xpath://button~` | `Click the next button` |
| select date and time | `+click+ … ~xpath://div[3]/div[2]/div[3]~` (start date) | `Click the slot date field` |
| | `+click+ … slider time ~xpath://li[43]~` | `Click the 09:00 slot time` |
| | `+click+ … next button` | `Click the next button` |
| | `+click+ … ~xpath://div[3]/div[2]/div[3]~` (end date) | `Click the slot date field` |
| | `+click+ … slider time ~xpath://li[19]~` | `Click the 18:00 slot time` |
| | `+click+ … next button` | `Click the next button` |
| | `user then +waits+ for *8* seconds` | `Wait 8 seconds` |
| select car and login | `+click+ … ~link:book-now~` | `Click the Book now button` |
| | `+click+ … user email field …` | `Click the username field` |
| | `+type+ the user email *atul.sharma@zoomcar.com* …` | `Type {data.user.email} into the username field` |
| | `+click+ … next button ~cssSelector:img.zc-auth-next-icon~` | `Click the login button` |
| | `+type+ password *aabc581321* …` | `Type {data.user.password} into the password field` |
| checkout the selected car | `+click+ … ~xpath://form/div[3]/img~` | `Click the booking result` |
| | `+click+ … ~id:checkoutButton~` | `Click the Checkout link` |
| initiate payment | `+click+ … ~id:card~` | `Click the card number field` |
| | `+click+ … ~id:expiry-month~` | `Click the expiry month select` |
| | `+type+ … enter month as *08*` | `Select "08" in the expiry month select` |
| | `+click+ … ~id:expiry-year~` | `Click the expiry year select` |
| | `+type+ … enter year as *2019*` | `Select "2027" in the expiry year select` |
| | `+click+ … ~id:cvv~` | `Click the CVV field` |
| | `+type+ the cvv as *123* …` | `Type {data.card.cvv} into the CVV field` |
| | `+click+ … ~xpath://input[@type='text']~` | `Click the card number field` |
| | `+type+ … enter card number *5123 4567 8901 2346*` | `Type {data.card.number} into the card number field` |
| logout | `+click+ … menu icon ~id:user_name_header~` | `Click the sidebar toggle` |
| | `+click+ … logout button ~linkText:LOGOUT~` | `Click the logout link` |

Three notes on the mapping:

- The two `+type+` steps on the expiry selects become `Select … in …`. The
  original typed into what were text inputs on that site; on `apps/sample-web`
  the same controls are `<select>` elements, so the sentence names the action
  that control actually supports. This is a consequence of the target rewrite D7
  licensed, not an extra liberty.
- `2019` becomes `2027`: the sample application's expiry select offers 2026 and
  2027, and a fixture that selects a year the control does not have would fail
  the moment T2.10 runs it.
- Literals moved to `data.yaml` (`{data.user.email}`, `{data.card.cvv}`) because
  v3 forbids credentials in flows (REQ-REC-7, REQ-NFR-6).

`booking-compensation.flow` is a **new** fixture, not a migration, and says so in
its own header: it is the fixture for `onFailure=compensate:<story>`
(REQ-AUTO-4), which no legacy flow could express.

### D10 — The custom-step refinement is exact, not a value-shape heuristic

*F3, LLD §5 (Draft 2.2).* The correction asks for "a refinement that a custom
step's target placeholders appear in `targets` and never as literals in
`params`". Which placeholder is a `target` is declared in the Tier 0 step
definition (`steps/*.ts`), which the schema cannot see — that matcher is T2.3.

The obvious substitute, rejecting a `params` literal that *looks like* an element
id, would reject `"fixture.json"`, `"example.com"` and `"app.config"`, all of
which are legitimate arguments. Shipping that would be trading one wrong
behaviour for a worse one.

`stepSchema` therefore enforces the two rules that are exact:

1. a placeholder name may not appear in both `params` and `targets`;
2. a `params` literal may not repeat an element id or a phrase the same step
   already grounds as a target — the double encoding.

The shape heuristic is applied where it is safe, in the golden-set test over
committed data, where a false positive costs a test edit rather than a user's
flow. `packages/schema/test/provenance.test.ts` asserts `"fixture.json"` and
`"example.com"` still pass. The exact rule arrives with the Tier 0 matcher in
T2.3.

### D11 — Only chromium is exercised

*T1.1, REQ-ADP-1.* REQ-ADP-1 names Chromium, Firefox and WebKit. Phase 1 runs
chromium only, as the phase's own scope permits. `playwright.config.ts` in both
`adapter-playwright` and `playwright-test` declares all three behind
`SVATAH_PW_BROWSERS=all`, and the browsers install with
`pnpm --filter @svatah/adapter-playwright exec playwright install firefox webkit`.

Reason: the two additional downloads roughly triple a clean checkout's setup, and
nothing in the adapter is browser-specific except the snapshot mechanism — whose
fallback path (`own`) is browser-independent by construction and is tested. Firefox
and WebKit are a Phase 2 gate, not a Phase 1 one.

### D12 — The structural hash lives in `@svatah/surface`

*LLD §6.2, T1.3.* LLD §6.2 describes the context hash under the bindings package.
Two callers need it and they are in different packages: an adapter, which fills in
`Snapshot.hash`, and `@svatah/bindings`, which hashes the subtree under an element
to get `BindingContext.hash`. `@svatah/surface` is the one package both may depend
on (LLD §1's graph), so the primitive lives there and `@svatah/bindings` keeps the
scoping — finding the landmark ancestor, taking the subtree. There is one
implementation, and the two hashes cannot drift.

### D13 — The healing number is taken over *degraded* bindings

*T1.5, T1.8, REQ-HEAL-5.* The obvious denominator is "bindings the variant
broke". Measured, it is **zero**: across 2,825 locator cases, not one binding
stopped resolving on any variant. A synthesised bundle carries five to eight
independent candidates, and none of the twenty single-property changes takes them
all.

That is a real and favourable result about T1.4's synthesis, and it is reported
prominently — but it leaves REQ-HEAL-5's percentage with an empty denominator.
The number is therefore taken over bindings that **degraded**: those that lost at
least one candidate and with it their redundancy, which is the state the healer
exists to repair. Both counts are in the report, and the method says which the
percentage is over.

### D14 — Recording for the eval disables test-id attributes

*T1.8, REQ-HEAL-5.* An application that carries a `data-testid` on every control
barely needs healing: the binding anchored on one survives almost every front-end
change. Measuring on `apps/sample-web` as it is would have produced a percentage
over 19 cases, most of them trivially recovered.

The eval therefore records with test-id attributes disabled — in the *adapter* as
well as in synthesis, so the population is coherently "an application with no test
ids" and the CSS and XPath paths are not anchored on a `data-testid` either. That
is the harder and more representative population, and it is what took the sample
from 19 cases to 52. The report states it in the method and in a `population`
field. `--with-test-ids` runs the easier population for contrast.

### D15 — `runtime` is not a module (a) dependency, and the spec is inconsistent here

*T1.9, REQ-PKG-1, HLD §12, LLD §1.* HLD §12 publishes `runtime` inside module (b)
(`@svatah/flow`). LLD §1's dependency graph draws `healer ─► bindings,
runtime(replay)` and `playwright-test ─► runtime, bindings, adapter-playwright,
healer`. REQ-PKG-1 says module (a) has no dependency on module (b). The three
cannot all hold.

Phase 1 resolves it the only way that is true today: nothing in module (a) uses
the executor, because the executor is T2.7, so the `@svatah/runtime` declarations
that the Phase 0 skeleton left in `healer`, `playwright-test` and `conformance`
are removed, and `runtime` is in the dependency-graph test's module (b) list.

This is not settled. Phase 2 has to choose before the healer's "replay to the
failing point" needs it, and the options are:

1. publish `runtime` with module (a) — it is the determinism layer (HLD §5.2 D6),
   which is the standard, and both the healer and the host need it;
2. keep the healer's replay behind a plugin, as the `Regrounder` already keeps its
   model step, so module (a) works without it;
3. amend HLD §12's module split.

### D16 — `bind()` is imported from `@svatah/playwright-test`

*LLD §6.5, T1.6.* LLD §6.5's example imports from `@svatah/bindings/playwright`.
A subpath of `@svatah/bindings` that imports Playwright would put an adapter
inside the bindings package, which LLD §1 forbids: nothing above the surface may
import an `adapter-*` package except the CLI and `playwright-test`.

The fixture lives in `@svatah/playwright-test`, which is where LLD §9.2 ("provided
by the same package") and HLD §12 ("playwright-test/ — host: bind() fixture") both
put it. REQ-PKG-2's promise is unaffected: it is still one dependency and one
import.

HLD §12 also describes a published aggregate — "`@svatah/bindings` (bindings +
healer + playwright-test host) = module (a)" — under which
`@svatah/bindings/playwright` would be a subpath of that aggregate. Phase 1
publishes the seven packages individually rather than assembling the aggregate,
because an aggregate re-exporting from a package that depends on it is a cycle in
the published graph. If the aggregate is wanted, T2.x should build it deliberately
rather than have it fall out of a workaround.

### D17 — The healer returns to the failing page by URL, not by replay

*T1.7, LLD §12.* LLD §12 has the healer replay to the failing point: through the
runtime for a flow, and by re-running the named Playwright test for a
bind-failure. Neither exists in Phase 1 — the executor is T2.7 — so the session is
put back on the URL the failure recorded, which is the page state the repair needs.

A page reachable only through a login is reported `unreachable` rather than
silently mis-repaired, and `--base-url` with a storage state gets there. The
bind-failure line already carries the session state, so the replay path can be
added in Phase 2 without a format change.

### D18 — Adapter tests run under Playwright Test, and `pnpm -r test` runs both runners

*LLD §1, the verification contract.* LLD §1 says "vitest unit tests, Playwright
Test for adapter and host tests", so `packages/adapter-playwright`,
`packages/playwright-test` and `examples/plain-playwright` set `"test":
"playwright test"` while every other package runs vitest. `pnpm -r test` runs
both, so the contract's single command is unchanged; the totals in this document
are given per runner because the two report differently.

---

## Known gaps

### K1 — CI still cannot be shown passing on a branch

F5 narrows Phase 0's K1 but does not close it.

`bitbucket-pipelines.yml` mirrors the Linux job of `.github/workflows/ci.yml`
step for step, on the same `node:22` image, and a test keeps the two in step. That
makes the workspace job runnable on the repository's own remote. What is still
missing:

1. **No GitHub remote.** `git remote -v` shows only
   `git@bitbucket.org:a_t_u_l/automator.git`, so the GitHub matrix has nowhere to
   run. `phase-1` was not pushed and there is no run URL to record.
2. **macOS and Windows are unverified.** Bitbucket's hosted runners are Linux
   only. The work is TypeScript, Node, a browser download and a Gradle build with
   no native code of its own, but that is an argument, not evidence.

Everything both workflows run was executed locally against a clean clone, and the
results are in the contract table above.

**To close this:** add a GitHub remote and push, or accept Linux-only
verification and say so in the release notes.

### K2 — The eval report has not been attached to a tagged release

T1.8's second Validate item is "report artifact present on a tagged pre-release".

`.github/workflows/release.yml` generates the reports on a `v*` tag, uploads them
as build artifacts, and attaches the Markdown to the release. Every part of that
was exercised except the tag: `node scripts/eval-reports.mjs --out reports` was
run and wrote all four reports, the healing one with real numbers, and
`reports.test.ts` asserts the workflow's generate and attach steps exist and that
it installs the browser the suite needs.

The tag itself needs the GitHub remote of K1.

### K3 — Verified on Node 25, not Node 22 LTS

The available runtime was Node v25.6.1. Everything targets and declares Node 22
(`.nvmrc`, `engines`, `tsup` `target: node22`, both CI files), but no Node 22
execution was observed **in this session**. Phase 0's verifier ran that phase's
contract on Node 22; Phase 1's has not been. Closing K1 closes this, since both
CI files pin 22.

### K4 — Firefox and WebKit are not exercised

See deviation **D11**. Only chromium is run. The suites are written to run on all
three (`SVATAH_PW_BROWSERS=all`), and nothing in them is chromium-specific, but
they have not been run there.

### K5 — The `webmcp` candidate kind is inert

REQ-ADP-9 is P2. The Playwright adapter reports `webmcp: false`, `locate` returns
nothing for a `webmcp` candidate, and the resolver's preference branch is
therefore never taken against it. The branch itself is implemented and tested
against a stub surface in all three of its states — capability absent, tool
declared, declaration gone — so the P2 work is an adapter change rather than a
resolver change.

### K6 — `heal --run <id>` has no producer inside this repository

REQ-HEAL-1's first input is a Svatah run directory. `readRunFailures` reads
`runs/<id>/results.jsonl`, selects only the `locator` failures, and is tested
against the published `results.schema.json` shape — but the executor that writes
that file is T2.7. A foreign runtime could produce one today; nothing here does.

### K7 — Variant 7 is not recovered

Relocalization recovers 0 of 4 degraded bindings on variant 7 (logout became an
icon-only button). It removes the visible text, which the text, neighbour and
role-path measures were all reading. This is in the published report by name
rather than averaged away. It is the case the model half of REQ-HEAL-5 exists for,
and it arrives in Phase 3.
