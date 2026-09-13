# Developer guide

For people working on Yam itself. If you want to send one change, read
[CONTRIBUTING.md](../CONTRIBUTING.md) instead. This page is the map.

## How the repository is laid out

```
packages/     one package per component
apps/         the desktop app, and the sample site the tests drive
tools/        repo-checks, the tests about the repository itself
examples/     runnable examples
evals/        the suites that measure healing, grounding and Yam driving itself
docs/         this documentation, and the specification under docs/spec
clients/      Python and Java clients, generated from the service
scripts/      the commands behind the pnpm scripts
```

## The three layers

Yam is built in three layers. Knowing which layer your change is in tells you
what it may depend on.

| Layer | What it is | Packages |
|---|---|---|
| **Surface** | How Yam talks to a target. Snapshot, act, read, check. | `surface`, `adapter-*`, `surface-control` |
| **Determinism** | What makes a replay a replay. Bindings, fingerprints, the resolver, healing. | `bindings`, `healer`, `schema` |
| **Behavior** | What a plan is for. Test, workflow, tool. | `runtime`, `workflow`, `tool` |

Read [Three layers](concepts/three-layers.md).

## Two modules, one boundary

The most important rule in the repository.

**Module (a)** is bindings for a plain Playwright project. Eight packages. A
person installs `@svatah/yam-playwright-test` and gets element bindings and
healing, with no flow language, no compiler and no model.

**Module (b)** is everything else: the flow language, the compiler, the
executor, the recorder, the model gateway.

Module (a) must never import module (b). A test walks the dependency tree and
fails if it does. The reason is a promise to users: adopting bindings must not
drag in the whole runtime.

These eight are module (a):

| Package | What it is |
|---|---|
| [`@svatah/yam-playwright-test`](../packages/playwright-test) | The `bind()` fixture. The one thing a user adds. |
| [`@svatah/yam-bindings`](../packages/bindings) | The store, the resolver, fingerprints, relocalization. |
| [`@svatah/yam-healer`](../packages/healer) | Choosing failures, proposing repairs, verifying them. |
| [`@svatah/yam-adapter-playwright`](../packages/adapter-playwright) | The default web adapter. |
| [`@svatah/yam-surface`](../packages/surface) | The `AgentSurface` interface and the adapter registry. |
| [`@svatah/yam-schema`](../packages/schema) | The artifact contract, as Zod and as JSON Schema. |
| [`@svatah/yam-conformance`](../packages/conformance) | The suite an adapter must pass. |
| [`@svatah/yam-bindings-cli`](../packages/bindings-cli) | `yam-bindings`, for reading the store from a terminal. |

## Building and testing

```bash
pnpm install
pnpm -r build       # topological, about two minutes
pnpm -r test        # about ten minutes
pnpm -r typecheck
pnpm lint
```

One package while you work:

```bash
pnpm --filter @svatah/yam-compiler test
pnpm --filter @svatah/yam-compiler test -- --watch
```

The desktop app is separate, because its tests drive a packaged build:

```bash
pnpm --filter @svatah/yam-desktop package
cd apps/desktop && npx playwright test
```

### If the build fails from a clean checkout

`pnpm -r build` orders packages by their dependencies. It cannot order a cycle,
so it builds the members of a cycle at the same time, and one of them reads the
other's types before they exist.

`tools/repo-checks/test/build-order.test.ts` fails when the workspace graph has
a cycle. If you need package A's tests to use package B, and B already depends
on A, put the link in the workspace root's `devDependencies` instead. The root
is not part of the build.

## The screen model

The desktop app and the terminal cockpit are two renderers over one model. A
screen is a function from a service response to a state. A renderer draws that
state and nothing else.

This is why the two cannot disagree. If you add a screen, you add it to
`@svatah/yam-screens` and both renderers get it.

A screen may not call the network. The shell holds the client and hands the
model its responses. A test enforces this.

## The broker

Sessions outlive the commands that make them. `yam surface connect` exits, and
the session it opened is still there for `yam surface snapshot` in the next
process.

That works because of the broker: one process per machine, holding the sessions.
The first client that needs one starts it.

Three things to know:

1. **It is one per machine by default.** Two Yams on one computer share it, on
   purpose, so a person and an agent can see the same session.
2. **Tests must not share it.** Each test suite sets `YAM_BROKER_STATE_DIR` to
   its own directory and reaps its own broker afterwards. A suite that killed
   every broker by name used to close other suites' sessions, which looked like
   a flaky test for months.
3. **It refuses a mismatched build.** The broker publishes a fingerprint derived
   from the operation list. A client that speaks a different one replaces it
   rather than talking to it.

## Adapters

An adapter teaches Yam a new kind of target. It implements `AgentSurface` and
passes the conformance suite in `@svatah/yam-conformance`.

Two rules that are easy to get wrong:

**References are stable, positions are not.** `snapshot` hands out references.
`act` takes a reference. Never a screen coordinate, because the window moves.

**A driver is never imported at the top of a file.** Playwright is 19 MB and
WebDriverIO is 4 MB. They are optional peers, loaded with `await import()` when
the adapter is actually used. A check fails when an `adapter-*` package imports
one at module load, because that quietly puts the driver back into everybody's
install.

Read [Add an adapter](guides/add-an-adapter.md).

## Tests

Four kinds, in four places.

| Kind | Where | What it does |
|---|---|---|
| Unit | `packages/*/test` | One package, no network. |
| Repository | `tools/repo-checks/test` | Facts about the repo: layout, boundaries, docs, packaging. |
| App | `apps/desktop/test/*.spec.ts` | Playwright against the packaged app. |
| Eval | `evals/` | Measures healing, grounding, and Yam driving itself. |

### Shown to bite

A check that passes on the broken version and the fixed version measures
nothing. Many checks here carry a case built from the exact text or shape that
was wrong, so the check proves it can fail.

When you write a check, write the failing case too.

### The self suite

`yam eval self` drives Yam with Yam. It runs both sides of every check in
`evals/self/checks.yaml` and compares the verdicts: Yam's own flows on one side,
Playwright cases and scripts on the other. It passes only when both sides agree.

The report also lists the checks only one side can reach. That list is Yam's own
shortcomings, and it is meant to shrink.

```bash
pnpm self
```

It needs a packaged app and, on a Mac, the Accessibility permission. It clears
the machine's broker on purpose, so do not run it beside `pnpm -r test`.

## Generated files

Do not edit these. Run the command instead.

| Files | Command |
|---|---|
| `docs/reference/generated/**` | `pnpm docs` |
| `packages/ui-tokens/tokens.css` | `pnpm --filter @svatah/yam-ui-tokens build` |
| `clients/**` | `pnpm app:client` |
| `packages/tui/test/golden/**` | `UPDATE_GOLDEN=1 pnpm --filter @svatah/yam-tui test` |
| `reports/app-*.png` | `node scripts/shoot-app.mjs --update` |

A golden file updated without being read is a golden file that has stopped
checking anything. Read the diff.

## Design tokens

Colours, type sizes and spacing live in `@svatah/yam-ui-tokens`. Both renderers
read them, and so does the terminal, which turns them into ANSI colours at
whatever depth it supports.

The palette is the product's own website. A check reads the site's stylesheet
and fails when the two drift.

Never write a colour in a component. Ask for the token.

## Debugging

```bash
yam surface doctor            # what this machine can drive
yam runs tail                 # the last run, as it happens
YAM_APP_DEBUG=1               # the desktop app writes a debug log
yam surface broker            # run the broker in the foreground and watch it
```

The app writes `app-debug.log` into its user data directory.

## Before you send a change

```bash
pnpm -r build && pnpm -r typecheck && pnpm lint && pnpm -r test
pnpm docs --check
```

If you touched the app, package it and run its suite. If you touched an adapter,
run the conformance suite for it.

## Where the rules are written down

- [`docs/spec/requirements.md`](spec/requirements.md), what the product must do.
- [`docs/spec/hld.md`](spec/hld.md), the shape of it.
- [`docs/spec/lld.md`](spec/lld.md), the detail, including package boundaries.
- [`docs/spec/progress/`](spec/progress/), what each phase built and what an
  adversarial review found afterwards.

The progress records are worth reading before you change something that looks
odd. Most odd things here are load-bearing, and the record says why.
