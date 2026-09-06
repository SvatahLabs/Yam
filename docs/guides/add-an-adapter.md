# Add an adapter and pass conformance

An adapter implements the agent surface for one platform. Nothing above the
surface knows a locator, a protocol or a platform, so an adapter that passes
the conformance suite runs every plan. The contract is
[the agent surface reference](../agent-surface.md); the existing adapters are
`packages/adapter-*`.

## 1. Implement the interface

```ts
import type { AgentSurface } from "@svatah/yam-surface";

export class MySurface implements AgentSurface {
  readonly kind = "web";
  capabilities() { return { dialogs: true, frames: false, windows: false, upload: false, drag: false, trace: false, webmcp: false, screenshot: true, restore: true }; }
  async open(session) { … }
  async close() { … }
  async snapshot(opts) { … }      // normalised roles, names, states; stable refs
  async act(action, ref, args, ref2) { … }
  async read(kind, ref, name) { … }
  async check(predicate, subject, ref) { … }
  async locate(candidate) { … }   // candidate → refs: 0, 1 or many
  async describe(ref) { … }       // what synthesis and fingerprints read
  async screenshot(path, mask) { … }
  async state() { … }
  async restore(state) { … }
}
```

- Return honest `capabilities()`. The executor refuses a plan whose actions
  need a missing capability at start, and the conformance suite skips, rather
  than fails, the cases that need one.
- Normalise roles onto the ARIA vocabulary with the tables in the reference;
  map unknowns to `generic`, never drop them.
- Build snapshots with `buildSnapshot` so the text rendering matches every
  other adapter.
- Implement the candidate kinds your platform has and return `[]` for the rest.
- Throw the typed errors: `LocateError`, `ActionabilityError`, `TimeoutError`,
  `DialogError`, `NavigationError`, `ScriptError`, `SessionError`. Never a bare
  `Error`; the executor maps them to failure classes.

## 2. Register it from the CLI only

```ts
import { registerAdapter } from "@svatah/yam-surface";
registerAdapter("mine", (config) => new MySurface(config));
```

Only the CLI registers adapters; the import-boundary lint forbids every other
package from importing an adapter. Registering a name twice is an error.

## 3. Pass the suite

```bash
yam surface conform --adapter mine --base-url http://127.0.0.1:4173 --report reports/adapter-mine.md
```

The suite in `@svatah/yam-conformance` is a fixed script of surface calls per
page of the sample application with expected snapshot invariants, effects and
error types. It is handed an `AgentSurface` and knows nothing else, which is
what lets you run it against your own adapter. Every failing check carries what
it expected and what it saw. Exit `0` is conformant.

Desktop adapters have their own case list driven against the ADE; see
`scripts/desktop-conformance.mjs` and [`reports/adapter-ax.md`](../../reports/adapter-ax.md)
for the shape of a passing report, including the per-node cost line.
