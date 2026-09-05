# @svatah/host-playwright

The Playwright Test host for Svatah flows (LLD §9).

A Svatah flow is prose compiled to a plan. This package runs that plan *inside*
Playwright Test rather than beside it, so a flow inherits the runner a web team
already has: its fixtures, projects, sharding, retries, reporters, and the trace
viewer.

It holds:

- the worker-scoped `svatah` fixture, which creates the Playwright adapter over
  the test's `context`, loads the plan and bindings, and owns the scope for a
  flow so captures cross stories inside one worker;
- `svatah host generate`, which writes `.svatah/specs/<flow>.spec.ts` — one
  `test()` per story, in order, under a serial `describe`;
- the reporter that writes Svatah `results.jsonl` and `summary.json` alongside
  Playwright's own output, so the same run is readable by both;
- retry gating: retries stay off unless the flow's policy is `continue` or the
  story is marked `idempotent`.

This is module (b): it depends on `@svatah/runtime`. The module (a) `bind()`
fixture lives in `@svatah/playwright-test` and is re-exported here, so a flow
project that also writes plain Playwright tests imports one package.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 and
[`docs/spec/lld.md`](../../docs/spec/lld.md) §1, §9.
