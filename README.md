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

## Status

Phase 1 (module (a): bindings and model-free healing for Playwright users).
See [`docs/spec/progress/phase-1.md`](docs/spec/progress/phase-1.md) for what is
built and how each item was verified, and
[`phase-0.md`](docs/spec/progress/phase-0.md) for the foundation.

### The packages

Module (a) is these eight, published together at 0.1.0. None of them resolves a
module (b) package — the flow language, the compiler, the executor, the recorder
or the model gateway — and a dependency-tree test holds that.

| Package | What it is |
|---|---|
| [`@svatah/playwright-test`](packages/playwright-test) | The `bind()` fixture. **The one dependency you add.** |
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
examples/     plain-playwright, the ten-minute quick start as a runnable project
evals/        compiler, grounding, healing and conformance suites
reports/      the published eval results (REQ-PKG-4)
docs/         the specification, the agent surface contract, the flow language
legacy/       the frozen Java project, kept until the Java conformance runtime exists
```

## Working on it

Requires **Node 22 LTS** and pnpm.

```bash
pnpm install
pnpm exec playwright install chromium   # the adapter and host tests drive a real browser
pnpm -r build
pnpm -r test
```

Other checks:

```bash
pnpm lint                 # includes the LLD §1 import boundaries
pnpm check:licenses       # REQ-PKG-3: every dependency must be permissively licensed
pnpm conform:playwright   # REQ-SURF-3: the surface conformance suite
pnpm eval:healing         # REQ-HEAL-5: the healing numbers above
pnpm quick-start          # REQ-PKG-2: the ten-minute quick start, timed
```

The frozen Java project builds on its own:

```bash
cd legacy && ./gradlew compileJava
```

## Documentation

- [Agent surface contract](docs/agent-surface.md) — what an adapter must implement.
- [Flow language reference](docs/flow-language.md) — every sentence pattern and IR action.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
