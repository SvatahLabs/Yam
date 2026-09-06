# The agent surface

The surface is the one interface through which anything, a person's test, a
workflow, an agent, reads and acts on a computer. It is small on purpose.

```ts
interface AgentSurface {
  readonly kind: "web" | "mobile" | "desktop" | "http";
  capabilities(): Capabilities;
  open(session: SessionInit): Promise<void>;
  close(): Promise<void>;
  snapshot(opts?): Promise<Snapshot>;            // the tree, with stable refs
  act(action, ref?, args?, ref2?): Promise<ActResult>;
  read(kind, ref?, name?): Promise<unknown>;
  check(predicate, subject, ref?): Promise<CheckResult>;
  locate(candidate): Promise<Ref[]>;             // used by the resolver
  describe(ref): Promise<ElementDescription>;    // used by synthesis
  screenshot(path, mask?): Promise<void>;
  state(): Promise<SessionState>;
  restore(state): Promise<void>;
}
```

## Why a snapshot with references

A snapshot is the accessibility tree normalised across platforms: every node
has an ARIA role, a name, states, a box and a reference that is stable within
the snapshot. Actions take a reference, not a selector, so an agent reads the
tree, decides, and acts on what it read. The same snapshot shape comes back
from a browser, a native window and a mobile app, which is what makes a plan
portable and a fingerprint comparable.

## Why capabilities

Platforms differ. Dialogs, frames, windows, upload, drag, tracing, WebMCP,
screenshots and restore are declared, and the executor refuses a plan that
needs a missing one before it starts rather than in the middle. The
conformance suite skips the cases an adapter declares it cannot do and fails
the rest.

## Why typed errors

`LocateError`, `ActionabilityError`, `TimeoutError`, `DialogError`,
`NavigationError`, `ScriptError` and `SessionError` are the whole vocabulary an
adapter may throw. The executor maps them to failure classes, so a result line
says `locator` or `timeout` whatever the platform.

## The standard, not an implementation

The interface, the snapshot shape and the wire messages are published as
TypeScript and as JSON Schema, and a conformance suite holds every adapter to
them. That is what lets a third party write an adapter for a platform this
project has never seen and run every plan on it. The full contract, with the
role mapping tables, is [the agent surface reference](../agent-surface.md).
