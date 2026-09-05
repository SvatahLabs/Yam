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

## Status

Phase 0 (foundation). See [`docs/spec/progress/phase-0.md`](docs/spec/progress/phase-0.md)
for what is built and how each item was verified.

## Repository layout

```
packages/     the TypeScript workspace, one package per component (HLD §12)
apps/         sample-web, the application the suites run against
evals/        compiler, grounding, healing and conformance suites
docs/         the specification, the agent surface contract, the flow language
legacy/       the frozen Java project, kept until the Java conformance runtime exists
```

## Working on it

Requires **Node 22 LTS** and pnpm.

```bash
pnpm install
pnpm -r build
pnpm -r test
```

Other checks:

```bash
pnpm lint             # includes the LLD §1 import boundaries
pnpm check:licenses   # REQ-PKG-3: every dependency must be permissively licensed
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
