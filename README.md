# Yam

Yam, from [Svatah Labs](https://github.com/SvatahLabs), is a **deterministic
automation runtime with a standard agent surface**. Describe a
behaviour once in plain language, compile it into a typed plan with element
bindings by driving the real platform, then replay that plan deterministically —
no model in the loop — on any platform an adapter exists for.

Yam is built in three layers:

| Layer | What it is |
|---|---|
| **Surface** | A published agent-native API — `snapshot` with stable references, `act` by reference, `read`, `check`, session state — implemented by adapters for Playwright, WebDriver BiDi, Appium, OS accessibility (UIA, AX, AT-SPI), HTTP and WebMCP. |
| **Determinism** | The step IR, the bindings store with fingerprints, the resolver, model-free relocalization, provenance, checkpoints and replay. This layer is the standard the project publishes. |
| **Behavior** | One plan, three ways to run it: **test** (a pass/fail oracle), **workflow** (a typed function with guards and checkpoints) and **tool** (a deterministic MCP tool an agent calls). |

The specification is the source of truth and lives in [`docs/spec/`](docs/spec/):
[requirements](docs/spec/requirements.md) · [HLD](docs/spec/hld.md) ·
[LLD](docs/spec/lld.md) · [tasks](docs/spec/tasks.md).

## Bindings in a plain Playwright project — start here

The first thing Yam ships is the piece you can adopt on its own: **bindings and
model-free healing for an existing Playwright project**. One dependency, one
import, no flow language, no compiler, and no model at any point (REQ-PKG-1,
REQ-PKG-2).

```bash
npm install --save-dev @svatah/yam-playwright-test
```

```ts
import { test, expect } from "@svatah/yam-playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");
  await (await bind("login.username-field", "the username field")).fill("me@example.com");
  await (await bind("login.sign-in-button")).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

`bind(id, phrase?)` returns a Playwright `Locator`, so everything you already do
with a locator still works. Record once by clicking the elements
(`YAM_MODE=record`); the bindings become reviewable YAML files you commit.
Replay reads those files and calls no model. When a front-end change breaks one,
`YAM_MODE=heal` finds the element again from its recorded fingerprint and
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

Six verbs, in order, and `yam` alone says which one is next:

```bash
yam init                       # start a project here
yam                            # where you are, and what to do next
yam check                      # read, lint and compile the flows; writes .yam/plan.json
yam record                     # bind the targets by driving the real application
yam run                        # replay the plan; the exit code is the verdict
yam heal                       # repair the bindings the interface moved, from the last run
yam ui --tmux                  # the cockpit, a shell, the run's events, your editor
```

Every failure names the verb that resolves it. `yam <command> --help` is one
command's options and exit codes; `yam help exit-codes`, `flows`, `bindings`,
`session`, `adapters` and `agents` are the topics. The same plan runs under
both hosts and produces identical results; `node scripts/compatibility.mjs`
demonstrates that over the four migrated fixtures, twice under each host, and is
what [`evals/conformance/runtime/`](evals/conformance/runtime) is a recording of.

Every sentence pattern and IR action is in
[`docs/flow-language.md`](docs/flow-language.md).

## Status

**0.1.0 is a release candidate.** Twelve phases built it and the Phase 12
verification accepted it at 9.3 of 10
([`docs/spec/progress/phase-12-verification.md`](docs/spec/progress/phase-12-verification.md));
every phase's record and verification are under
[`docs/spec/progress/`](docs/spec/progress/). Phase 13 named the product Yam,
removed the frozen Java project and moved the repository to GitHub before
anything was published, so no package has ever existed under another name.

What ships: module (a) for plain Playwright projects; the flow language and the
compiler with three tiers; the runtime with policies, guards, compensation,
checkpoints, resume and a redacted audit log; the three behaviors; the agent
surface over six adapters (Playwright, WebDriver BiDi, HTTP, Appium, Windows UI
Automation, macOS Accessibility) with a conformance suite; the recorder with
model grounding; Yam.app, the Electron desktop client over the local service with
installers for three operating systems; a Java conformance runtime; and Python
and Java clients generated from the service's description.

Known gaps, recorded rather than hidden (`CHANGELOG.md`): the Windows UI
Automation gate has never run for want of a host; the macOS Accessibility gate
is green by hand and needs a self-hosted runner in CI
([`docs/ci.md`](docs/ci.md)); the Tier 2 fine-tune missed its target and is
withdrawn; nineteen checks of the self-verification suite are still one-sided.
Phase 14, the front door, is built: `yam` says where you are and what is
next, `check`, one-screen help with per-command help and topics, diagnostics
that name the next verb, and the tmux workspace
([`docs/spec/progress/phase-14.md`](docs/spec/progress/phase-14.md)). Next is
Phase 15, the process adapter and the verification library.

### The packages

Every package is `@svatah/yam` or `@svatah/yam-<name>`, versioned together.
Module (a) is these eight. None of them resolves a module (b) package — the flow
language, the compiler, the executor, the recorder or the model gateway — and a
dependency-tree test holds that.

| Package | What it is |
|---|---|
| [`@svatah/yam-playwright-test`](packages/playwright-test) | The `bind()` fixture, and nothing else. **The one dependency you add.** |
| [`@svatah/yam-bindings`](packages/bindings) | Store, context hash, resolver, synthesis, fingerprints, relocalization |
| [`@svatah/yam-healer`](packages/healer) | Failure selection, repair, verification, diff |
| [`@svatah/yam-adapter-playwright`](packages/adapter-playwright) | The default web adapter |
| [`@svatah/yam-surface`](packages/surface) | The published `AgentSurface` interface and adapter registry |
| [`@svatah/yam-schema`](packages/schema) | The artifact contract, as Zod and as JSON Schema |
| [`@svatah/yam-conformance`](packages/conformance) | The suite an adapter must pass to be conformant |
| [`@svatah/yam-bindings-cli`](packages/bindings-cli) | `yam-bindings`: inspect, verify and heal the store from a terminal |

Module (b) is the command line and everything under it:

| Package | What it is |
|---|---|
| [`@svatah/yam`](packages/cli) | The `yam` CLI and MCP server. **The one dependency for the whole runtime.** |
| [`@svatah/yam-spec`](packages/spec), [`-steps`](packages/steps), [`-compiler`](packages/compiler) | The flow reader and grammar, Tier 0 typed steps, the tiered compiler and lint |
| [`@svatah/yam-runtime`](packages/runtime), [`-host-playwright`](packages/host-playwright) | The executor, and the Playwright Test host |
| [`@svatah/yam-workflow`](packages/workflow), [`-tool`](packages/tool), [`-trajectory`](packages/trajectory) | The workflow and tool behaviors, and trajectory capture |
| [`@svatah/yam-gateway`](packages/gateway), [`-recorder`](packages/recorder) | The model gateway and the recorder |
| [`@svatah/yam-adapter-http`](packages/adapter-http), [`-adapter-bidi`](packages/adapter-bidi), [`-adapter-appium`](packages/adapter-appium), [`-adapter-uia`](packages/adapter-uia), [`-adapter-ax`](packages/adapter-ax) | The other adapters |
| [`@svatah/yam-service`](packages/service), [`-sdk`](packages/sdk), [`-screens`](packages/screens), [`-ui`](packages/ui), [`-ui-tokens`](packages/ui-tokens), [`-tui`](packages/tui) | The local service, its typed client, the screen model and its two renderers |
| [`@svatah/yam-migrate`](packages/migrate) | v1 and v2 flows, and prototype databases, to v3 |

Not published: [`@svatah/yam-desktop`](apps/desktop), whose installers are attached to
the release; `sample-web`; and `@svatah/yam-repo-checks`.

## Repository layout

```
packages/     the TypeScript workspace, one package per component (HLD §12)
apps/         sample-web, the application the suites run against
examples/     plain-playwright (the ten-minute quick start), plus ci, cron and
              mcp-agent: the same plan run three ways (REQ-AGT-4)
evals/        compiler, grounding, healing and conformance suites
reports/      the published eval results (REQ-PKG-4)
docs/         the specification, the agent surface contract, the flow language
clients/      the Python and Java clients generated from the service description
runtimes/     the Java conformance runtime (REQ-STD-3)
tools/        repo-checks, the tests about the repository itself
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
outside it and red: `pnpm -r typecheck` failed in `@svatah/yam-workflow` for two
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

`.github/workflows/release.yml` contains no
publish. See [CHANGELOG.md](CHANGELOG.md).

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

A phase's evidence is **`yam eval self` green with its report**, plus whatever
that report lists as one-sided (REQ-SELF-2, LLD §13.9).

```
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build \
  && pnpm -r typecheck && pnpm -r test && pnpm lint     # the tree, on two Node LTSes
pnpm --filter @svatah/yam-desktop package                        # the conformance target
node packages/cli/dist/bin.js eval self --update    # or `pnpm self`
```

`yam eval self` runs **both sides of every check** in
`evals/self/checks.yaml` and compares their verdicts: Yam's own flows through
the desktop, web, HTTP and SDK adapters on one side; the Playwright cases, the
pseudo-terminal captures, the generated clients' smoke and the scripts on the
other. It **passes only at 100 percent agreement** over the checks both sides
reach — a disagreement means one oracle is wrong, and the report names both
pieces of evidence.

What the report also publishes, and what a reader should look at first, is the
**one-sided list**: every check only one side can reach, each naming the adapter
or the sentence Yam lacks. That list is Yam's own shortcomings, and it is
expected to shrink phase by phase.

Without `--update` the gate writes every report — its own and the two its
sources produce — to a temporary directory and says where, so a checkout is as
clean after the contract's own gate as it was before it. `--update` refreshes
the committed `reports/self-parity.md`, `reports/adapter-ax.md` and
`reports/eval-healing.md`, which is what a phase's record wants.

Three oracles stay external on purpose (REQ-SELF-3) and the report says so: the
healing eval's ground-truth keys, axe-core on the component sheet, and the
renderer-versus-adapter tree agreement. They sit below the surface Yam
drives, and they are what keeps the gate from grading its own homework.
