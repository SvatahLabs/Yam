# @svatah/cli

The `svatah` command line (LLD §15), and the only package that registers
adapters — which is why the import-boundary lint lets it, and only it and the
Playwright Test host, import an `adapter-*` package (LLD §1).

## Phase 1

```
svatah surface conform --adapter <name> [--base-url <url>] [--headed]
                       [--only <ids>] [--report <path.md>] [--json]
```

The rest of the table in LLD §15 arrives with the components behind it. A command
that is not built yet says which task builds it rather than printing a bare
"unknown command".

## Exit codes

The table in LLD §15, in `src/exit-codes.ts`. CI decides what happened from these,
so they are a contract: `0` ok, `1` failed, `6` healed, `7` some unrepaired,
`11` aborted, `12` hash mismatch on resume, `64` usage.

## Licence

Apache-2.0.
