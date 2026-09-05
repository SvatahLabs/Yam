# @svatah/bindings-cli

The `svatah-bindings` executable — the module (a) half of the Svatah command
line.

Module (a) is the part of Svatah a plain Playwright user can adopt on its own:
the bindings store, model-free healing, the Playwright adapter, and the `bind()`
fixture. None of it needs the flow language, the compiler, or the executor
(REQ-PKG-1). This package gives that half a command line of its own, so someone
who installed `@svatah/playwright-test` and nothing else can still inspect,
verify, and repair their bindings.

It holds:

| Command | Purpose |
|---|---|
| `svatah-bindings bindings list\|show\|verify\|prune` | Read and dry-resolve the store |
| `svatah-bindings heal --from-bind-failures` | Repair bindings from `.svatah/bind-failures.jsonl` |
| `svatah-bindings surface conform --adapter playwright` | Run the surface conformance suite |
| `svatah-bindings eval healing --no-model` | Run the relocalization eval and write its report |

`@svatah/cli` depends on this package and mounts the same commands under
`svatah`, so a project that has all of Svatah installed gets one executable and
one implementation rather than two that drift apart.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits
and [`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it
must respect — in particular that it must not import `spec`, `steps`,
`compiler`, or `runtime`.
