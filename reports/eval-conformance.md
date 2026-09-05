# Adapter conformance

Run at 2026-09-03T19:45:27.959Z.

An adapter is **conformant** only when every case in the published surface suite
passes (REQ-SURF-3, LLD §14). A case whose capability the adapter declares `false`
is skipped rather than failed — a phone has no windows, and refusing to report on
one would be reporting on the wrong thing.

| Adapter | Result | Detail |
|---|---|---|
| `playwright` | conformant | 16 passed, 0 failed, 0 skipped (72 checks) |
| `bidi` | conformant | 16 passed, 0 failed, 0 skipped (72 checks) — driving `firefox 153.0 (launched)` |

## Regenerate

```bash
node scripts/adapter-conformance.mjs --report reports/eval-conformance.md
```

`appium` is absent because it needs a device: see
`packages/adapter-appium/README.md` for the emulator gate and its commands.
