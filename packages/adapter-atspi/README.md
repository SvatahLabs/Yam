# @svatah/yam-adapter-atspi

Linux AT-SPI accessibility adapter (T23, SF-23).

**Implemented and unvalidated.** The role table, reference scope, state
inversion, action selection and every refusal are pure functions of an
`AtspiNode[]` and are driven by `test/tree.test.ts` against recorded trees. The
bridge's conversation with a live accessibility bus has never been run, because
no Linux runner is provisioned for this repository — the generated
[support matrix](../../docs/reference/generated/support-matrix.md) says so, with
the four conditions that would change it.

See [`docs/spec/hld.md`](../../docs/spec/hld.md) §12 for where this package sits and
[`docs/spec/lld.md`](../../docs/spec/lld.md) §1 for the import boundaries it must respect.
