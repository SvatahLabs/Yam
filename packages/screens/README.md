# `@svatah/yam-screens`

The headless screen model behind every Yam builder surface (REQ-ADE-10,
REQ-ADE-13, LLD §13.7).

> The ADE and the terminal cockpit `yam ui` are two renderers of one headless
> screen model, and both are views over the local service and nothing else.

Three things live here and nowhere else:

- **Twelve screens.** `flows`, `record`, `runs`, `run`, `heal`, `bindings`,
  `agents`, `api`, `data`, `explorer`, `import`, `settings`. A screen is
  `{ id, title, load(service, params), actions, keys }` and its `load` turns
  service responses into rows. No DOM, no terminal, no `process`.
- **The action registry.** One list behind the ADE's command palette, `yam
  ui`'s palette, `@svatah/yam-sdk`'s `actions`, and — through each action's `cli`
  string — the command line. `tools/repo-checks/test/action-parity.test.ts`
  fails when the registry, the CLI's command table and `fixtures/palette.json`
  disagree.
- **The key bindings** both renderers read, written as the mockups write them
  (`⌘↵`, `R`) with the terminal's equivalent beside each.

## Using it

```ts
import { screenById, ACTIONS } from "@svatah/yam-screens";

const state = await screenById("run").load(client, { runId: "comp" });
const action = ACTIONS.find((one) => one.id === "heal.run")!;
if (action.availableWhen(state)) await action.run(client, { runId: state.runId });
```

`client` is anything satisfying `ScreenService` — `@svatah/yam-sdk`'s client, the
ADE's generated one, or `fakeService()` from this package.

## The fake service, and why its answers are real

`fakeService(responses)` is `ScreenService` over a bag of recorded responses.
`test/fixtures/fixtures-project.json` is what a real `yam serve` answered for
`evals/fixtures` and for the `comp` run of `guards-and-compensation.flow` — the
run the `Run` artboard is drawn from, six passed and one failed, exit 11.

```console
$ node scripts/record-screen-fixtures.mjs           # re-record
$ node scripts/record-screen-fixtures.mjs --check   # fail on drift
```

A hand-written stub would let a screen pass a test against numbers no service
ever produced. This is the difference between "the model works" and "the model
agrees with the service".

## What it may not import

The service client is an *interface* it is handed, never a package it reaches
for: `@svatah/yam-sdk` is generated from the service's description and takes its
`actions` from here, so an import the other way would make the graph cyclic.
Neither renderer imports a runtime package, and neither does this one
(`eslint.config.js` holds all three rules).
