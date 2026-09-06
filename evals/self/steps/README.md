# `evals/self/steps` — deliberately empty, and deliberately tracked

The self project declares `steps: { dir: steps }` in `svatah.config.yaml`, so
Tier 0 custom step definitions would live here (REQ-LANG-15, LLD §5). It has
none: every sentence in the self flows is Tier 1 grammar, which is the point —
the suite that verifies Svatah is written in the language Svatah publishes, not
in TypeScript handlers beside it.

The directory is tracked because git carries no empty directory, and two
scripts — `scripts/self-parity-bite.mjs` and `scripts/self-record.mjs` — copy
the project into a temporary directory before they touch it. From a clean
checkout both crashed on `ENOENT … evals/self/steps` (P11-F1). The copy now
tolerates a missing optional directory as well, so neither the placeholder nor
the fix stands alone; both are here because either alone leaves a way to break
it again.
