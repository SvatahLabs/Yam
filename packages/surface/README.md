# @svatah/yam-surface

The published agent surface (REQ-SURF-1..5, LLD §2): the `AgentSurface` interface
every adapter implements, the adapter registry, the typed errors, the snapshot
text renderer, the structural hash, and the role tables that normalise UIA, AX
and Appium trees onto the ARIA vocabulary.

**This is the only way down.** Nothing above it knows a locator, a protocol or a
platform: callers address elements by reference, or by handing a stored
`Candidate` to `locate`. An import-boundary lint and a dependency-graph test
enforce that (LLD §1, REQ-SURF-2).

## The interface

```ts
interface AgentSurface {
  readonly kind: "web" | "mobile" | "desktop" | "http";
  capabilities(): Capabilities;
  open(session: SessionInit): Promise<void>;
  close(): Promise<void>;

  snapshot(opts?): Promise<Snapshot>;              // a semantic tree with stable references
  act(action, ref?, args?, ref2?): Promise<ActResult>;
  read(kind, ref?, name?): Promise<unknown>;
  check(predicate, subject, ref?): Promise<CheckResult>;

  locate(candidate: Candidate): Promise<Ref[]>;    // 0, 1 or many — the resolver requires one
  describe(ref: Ref): Promise<ElementDescription>; // what synthesis and fingerprinting read
  screenshot(path, mask?): Promise<void>;
  state(): Promise<SessionState>;
  restore(state: SessionState): Promise<void>;
  trace?(start, path?): Promise<void>;
  request?(req, opts): Promise<ApiResponse>;
}
```

The full contract, including the role-mapping tables an adapter implementer needs,
is [`docs/agent-surface.md`](../../docs/agent-surface.md).

## Capabilities, not assumptions

An adapter publishes what it can do — `dialogs`, `frames`, `windows`, `upload`,
`drag`, `trace`, `webmcp`, `screenshot`, `restore` — and the executor checks a
plan against that **at start, not mid-run** (LLD §2.4). A missing feature is a
refusal to begin rather than a failure halfway through a flow.

## Typed errors

`LocateError`, `ActionabilityError`, `TimeoutError`, `CheckError`, `DialogError`,
`NavigationError`, `ScriptError`, `SessionError`, `DataError`. Each carries the
failure class the executor records, so LLD §8.4's mapping is data on the error
rather than a switch statement above the surface. Anything that is not a
`SurfaceError` classifies as `unknown` — an adapter leaking a native error is
visible in the results rather than silently miscategorised.

## Conformance

An adapter is **conformant** only when
[`@svatah/yam-conformance`](../conformance)'s surface suite passes against it
(REQ-SURF-3):

```bash
yam surface conform --adapter <name>
```

## Licence

Apache-2.0.
