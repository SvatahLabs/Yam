# Svatah

A **deterministic automation runtime with a standard agent surface**. Describe a
behaviour once in plain language, compile it into a typed plan with element
bindings by driving the real platform, then replay that plan deterministically —
no model in the loop — on any platform an adapter exists for.

Svatah is built in three layers:

| Layer | What it is |
|---|---|
| **Surface** | A published agent-native API — `snapshot` with stable references, `act` by reference, `read`, `check`, session state — implemented by adapters for Playwright, WebDriver BiDi, Appium, OS accessibility (UIA, AX, AT-SPI), HTTP and WebMCP. |
| **Determinism** | The step IR, the bindings store with fingerprints, the resolver, model-free relocalization, provenance, checkpoints and replay. This layer is the standard the project publishes. |
| **Behavior** | One plan, three ways to run it: **test** (a pass/fail oracle), **workflow** (a typed function with guards and checkpoints) and **tool** (a deterministic MCP tool an agent calls). |

The specification is the source of truth and lives in [`docs/spec/`](docs/spec/):
[requirements](docs/spec/requirements.md) · [HLD](docs/spec/hld.md) ·
[LLD](docs/spec/lld.md) · [tasks](docs/spec/tasks.md).

## Bindings in a plain Playwright project — start here

The first thing Svatah ships is the piece you can adopt on its own: **bindings and
model-free healing for an existing Playwright project**. One dependency, one
import, no flow language, no compiler, and no model at any point (REQ-PKG-1,
REQ-PKG-2).

```bash
npm install --save-dev @svatah/playwright-test
```

```ts
import { test, expect } from "@svatah/playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");
  await (await bind("login.username-field", "the username field")).fill("me@example.com");
  await (await bind("login.sign-in-button")).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

`bind(id, phrase?)` returns a Playwright `Locator`, so everything you already do
with a locator still works. Record once by clicking the elements
(`SVATAH_MODE=record`); the bindings become reviewable YAML files you commit.
Replay reads those files and calls no model. When a front-end change breaks one,
`SVATAH_MODE=heal` finds the element again from its recorded fingerprint and
annotates the test `healed` — never `passed`.

The ten-minute quick start, with the record and heal passes explained, is
[`examples/plain-playwright/README.md`](examples/plain-playwright/README.md).
`pnpm quick-start` runs it and fails if it takes longer than ten minutes.

### The healing numbers

Published, because a healing claim without a number is a slogan (REQ-HEAL-5,
REQ-PKG-4). Over the twenty deliberate UI changes in `apps/sample-web`:

| | `no-test-ids` (headline) | `with-test-ids` |
|---|---|---|
| **Relocalize-only recovery** | **92.3 %** (48 of 52 degraded) | 78.9 % (15 of 19) |
| Repairs onto the **wrong element** | 0 | 0 |
| Repairs that could not be verified | 0 | 0 |
| Bindings recorded at variant 0 | 106 | 106 |
| Bindings that stopped resolving entirely | 0, on any variant | 0, on any variant |
| Model calls | none | none |

Threshold (REQ-HEAL-5): 60 %. The headline is the population *without* test-id
attributes, because an application that carries a `data-testid` on every control
barely needs healing and a number taken on it measures the application rather
than the healer. Both are published so the gap is visible.

A repair counts as recovered only when the element relocalization proposed
carries the same ground-truth key as the element the binding was recorded on —
not merely when the proposal is findable. The sample application stamps that key
on every interactive element, identical across all variants, and
`bindings.ignoreAttributes` keeps it out of `describe()`, `native`, synthesis and
fingerprints so it can never help relocalization find anything.

The method, the per-variant table, and the one change relocalization does *not*
survive are in [`reports/eval-healing.md`](reports/eval-healing.md). Regenerate it
with `pnpm eval:healing`.

## Writing a flow

Module (b) is the rest of the runtime: the flow language, the compiler that turns
it into a typed plan, and the executor that replays that plan. A flow is plain
sentences with a signature, and it compiles to an artifact you can read.

```
story (tags=smoke): Sign in
inputs: username: string, password: secret
  Go to "/login"
  Type {input.username} into the username field
  Type {input.password} into the password field
  Click the sign in button
  The dashboard heading should be visible

test: Sign in
```

```bash
svatah compile                    # flows -> plan.json, byte-stable
svatah lint                       # long sleeps, unused captures, side effects in tools
svatah run --host playwright      # or --host none for the runner-agnostic executor
svatah migrate ./legacy ./flows   # v1/v2 flows and prototype databases
svatah serve                      # the local HTTP and event-stream service
```

The same plan runs under both hosts and produces identical results — statuses and
matched candidates alike. `node scripts/compatibility.mjs` demonstrates that over
the four migrated fixtures, twice under each host, and is what
[`evals/conformance/runtime/`](evals/conformance/runtime) is a recording of.

Every sentence pattern and IR action is in
[`docs/flow-language.md`](docs/flow-language.md).

## Status

Phase 2 (module (b): the flow reader, the Tier 0 and Tier 1 compilers, the
executor, both hosts, migration, the CLI and the local service). See
[`docs/spec/progress/phase-2.md`](docs/spec/progress/phase-2.md) for what is
built and how each item was verified, and
[`phase-1.md`](docs/spec/progress/phase-1.md) and
[`phase-0.md`](docs/spec/progress/phase-0.md) for what came before.

Not built yet, and honest about it: `svatah record`, the model gateway and the
Tier 2 and Tier 3 compilers, the workflow and tool runners, and every adapter
except Playwright and HTTP. Those packages exist as skeletons so the layout and
the import boundaries are enforced from the start; they are Phases 3 and 4.

### The packages

Module (a) is these eight, published together at 0.1.0. None of them resolves a
module (b) package — the flow language, the compiler, the executor, the recorder
or the model gateway — and a dependency-tree test holds that.

| Package | What it is |
|---|---|
| [`@svatah/playwright-test`](packages/playwright-test) | The `bind()` fixture, and nothing else. **The one dependency you add.** |
| [`@svatah/bindings`](packages/bindings) | Store, context hash, resolver, synthesis, fingerprints, relocalization |
| [`@svatah/healer`](packages/healer) | Failure selection, repair, verification, diff |
| [`@svatah/adapter-playwright`](packages/adapter-playwright) | The default web adapter |
| [`@svatah/surface`](packages/surface) | The published `AgentSurface` interface and adapter registry |
| [`@svatah/schema`](packages/schema) | The artifact contract, as Zod and as JSON Schema |
| [`@svatah/conformance`](packages/conformance) | The suite an adapter must pass to be conformant |
| [`@svatah/bindings-cli`](packages/bindings-cli) | `svatah-bindings`: inspect, verify and heal the store from a terminal |

## Repository layout

```
packages/     the TypeScript workspace, one package per component (HLD §12)
apps/         sample-web, the application the suites run against
examples/     plain-playwright (the ten-minute quick start), plus ci, cron and
              mcp-agent: the same plan run three ways (REQ-AGT-4)
evals/        compiler, grounding, healing and conformance suites
reports/      the published eval results (REQ-PKG-4)
docs/         the specification, the agent surface contract, the flow language
legacy/       the frozen Java project, kept until the Java conformance runtime exists
```

## Working on it

Requires **Node 22 LTS** and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm browsers      # the adapter and host tests drive a real browser
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
```

Those six are the whole contract (LLD §16, Draft 2.8): a clean checkout that
runs them, with no model credential, on the current and the previous Node LTS,
has run everything. `pnpm browsers` is `playwright install chromium` in the
adapter's workspace. Playwright is also a root dev dependency, so
`pnpm exec playwright install chromium` works from the repository root too.

`typecheck` and `lint` joined the contract in Draft 2.8 because they were
outside it and red: `pnpm -r typecheck` failed in `@svatah/workflow` for two
phases while every other gate was green, which is what a check nobody has to
run looks like (K9; Phase 6 verification, F5).

Other checks:

```bash
pnpm check:licenses       # REQ-PKG-3: every dependency must be permissively licensed
pnpm conform:playwright   # REQ-SURF-3: the surface conformance suite
pnpm eval:healing         # REQ-HEAL-5: the healing numbers above
pnpm quick-start          # REQ-PKG-2: the ten-minute quick start, timed

node scripts/compatibility.mjs         # REQ-RUN-2, REQ-BEH-5, REQ-COMP-7
node scripts/compile-fixtures.mjs --check   # the committed fixture plan is current
node scripts/migrate-legacy.mjs --check     # migration output is unchanged
```

## The 0.1.0 release candidate

Packed tarballs, and nothing published (T7.6):

```bash
pnpm release:dry-run      # packs every publishable package and lists its contents
pnpm quick-start:packed   # installs the module (a) tarballs into an empty
                          # Playwright project outside this workspace, runs
                          # record/run/heal there, and checks the licences of
                          # what was installed
```

`pnpm quick-start` runs the same three steps *inside* the workspace, where every
`@svatah/*` import resolves through pnpm's links. `pnpm quick-start:packed` is
the one that checks what REQ-PKG-1 actually promises: that a Playwright user who
has never seen this repository can install four packages and be running. A
workspace hides exactly the failures that matter to that — a missing `files`
entry, a `dist` nobody built, a `workspace:*` that escaped into a tarball.

Neither `.github/workflows/release.yml` nor `bitbucket-pipelines.yml` contains a
publish. See [CHANGELOG.md](CHANGELOG.md).

The frozen Java project builds on its own:

```bash
cd legacy && ./gradlew compileJava
```

## Documentation

- [Behaviors](docs/behaviors.md) — one plan run as a test, a workflow or an agent tool,
  and why orchestration is external.
- [Agent surface contract](docs/agent-surface.md) — what an adapter must implement.
- [Flow language reference](docs/flow-language.md) — every sentence pattern and IR action.
- [Examples](examples/) — the same plan from CI, from cron, and from an MCP client.
- [The local model (Tier 2)](docs/local-model.md) · [Privacy mode](docs/privacy.md) ·
  [MCP](docs/mcp.md) · [REPL](docs/repl.md).
- [Continuous integration](docs/ci.md) — what runs today, and the twenty minutes
  that turn the two desktop gates and the installer matrix green.

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## The verification contract (from Phase 11 on)

A phase's evidence is **`svatah eval self` green with its report**, plus whatever
that report lists as one-sided (REQ-SELF-2, LLD §13.9).

```
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build \
  && pnpm -r typecheck && pnpm -r test && pnpm lint     # the tree, on two Node LTSes
pnpm --filter @svatah/ade package                        # the conformance target
node packages/cli/dist/bin.js eval self --update    # or `pnpm self`
```

`svatah eval self` runs **both sides of every check** in
`evals/self/checks.yaml` and compares their verdicts: Svatah's own flows through
the desktop, web, HTTP and SDK adapters on one side; the Playwright cases, the
pseudo-terminal captures, the generated clients' smoke and the scripts on the
other. It **passes only at 100 percent agreement** over the checks both sides
reach — a disagreement means one oracle is wrong, and the report names both
pieces of evidence.

What the report also publishes, and what a reader should look at first, is the
**one-sided list**: every check only one side can reach, each naming the adapter
or the sentence Svatah lacks. That list is Svatah's own shortcomings, and it is
expected to shrink phase by phase.

Without `--update` the gate writes every report — its own and the two its
sources produce — to a temporary directory and says where, so a checkout is as
clean after the contract's own gate as it was before it. `--update` refreshes
the committed `reports/self-parity.md`, `reports/adapter-ax.md` and
`reports/eval-healing.md`, which is what a phase's record wants.

Three oracles stay external on purpose (REQ-SELF-3) and the report says so: the
healing eval's ground-truth keys, axe-core on the component sheet, and the
renderer-versus-adapter tree agreement. They sit below the surface Svatah
drives, and they are what keeps the gate from grading its own homework.
