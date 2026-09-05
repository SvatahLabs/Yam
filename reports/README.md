# Published eval reports (REQ-PKG-4)

"Published evals: compiler, grounding, healing, and adapter conformance results
are generated per release and published with the release notes."

The reports here are the committed copies of what
`.github/workflows/release.yml` regenerates and attaches on a tag. They are in
the repository so the current numbers are readable without running anything, and
so a change to them is a diff someone sees.

| Report | Suite | Threshold | Regenerate with |
|---|---|---|---|
| [`eval-healing.md`](eval-healing.md) | Healing, relocalize-only (REQ-HEAL-5) | ≥ 60 % | `pnpm eval:healing` |
| [`eval-grounding.md`](eval-grounding.md) | Grounding (REQ-REC-10) | ≥ 95 % | `pnpm eval:grounding` |
| [`eval-compiler.md`](eval-compiler.md) | Compiler (REQ-COMP-9, REQ-COMP-3) | Tier 1 100 %, Tier 2 ≥ 80 %, end to end ≥ 95 % | `pnpm eval:compiler` |
| [`eval-conformance.md`](eval-conformance.md) | Surface conformance (REQ-SURF-3) | every adapter passes | `pnpm eval:conformance` |
| [`adapter-bidi.md`](adapter-bidi.md) | BiDi independence (REQ-ADP-4, REQ-STD-2) | conformant, and identical to Playwright | `pnpm bidi:independence` |
| [`eval-finetune.md`](eval-finetune.md) | Tier 2 fine-tune, base versus tuned (T6.5, ADR-4) | ≥ 5 points on tier 2, no tier 1 regression | `pnpm finetune:eval` (see [docs/finetune.md](../docs/finetune.md)) |
| [`runtime-java.md`](runtime-java.md) | Java runtime conformance (REQ-STD-3, LLD §14) | zero mismatches in status and matched candidate | `pnpm conform:runtime` (after `cd runtimes/java && ./gradlew fatJar`) |

`node scripts/eval-reports.mjs --out reports` regenerates all four; the suites
that are not runnable yet write a placeholder naming the task that builds them,
and a suite that runs and misses its threshold makes the script exit non-zero
*after* writing its report. That order is deliberate: HLD §14's mitigation for
"healing numbers disappoint" is to publish anyway, so the number is published and
then the gate fails, never the other way round.
