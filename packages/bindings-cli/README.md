# @svatah/yam-bindings-cli

The `yam-bindings` executable — the module (a) half of the Yam command
line.

Module (a) is the part of Yam a plain Playwright user can adopt on its own:
the bindings store, model-free healing, the Playwright adapter, and the `bind()`
fixture. None of it needs the flow language, the compiler, or the executor
(REQ-PKG-1). This package gives that half a command line of its own, so someone
who installed `@svatah/yam-playwright-test` and nothing else can still inspect,
verify, and repair their bindings.

It holds:

| Command | Purpose |
|---|---|
| `yam-bindings bindings list\|show\|verify\|prune` | Read and dry-resolve the store |
| `yam-bindings heal --from-bind-failures` | Repair bindings from `.yam/bind-failures.jsonl` |
| `yam-bindings surface conform --adapter playwright` | Run the surface conformance suite |
| `yam-bindings eval healing --no-model` | Run the relocalization eval and write its report |

`@svatah/yam` depends on this package and mounts the same commands under
`yam`, so a project that has all of Yam installed gets one executable and
one implementation rather than two that drift apart.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits
and [`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it
must respect — in particular that it must not import `spec`, `steps`,
`compiler`, or `runtime`.
