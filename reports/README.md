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
| — | Surface conformance (REQ-SURF-3) | every adapter passes | `pnpm conform:playwright` |
| — | Grounding (REQ-REC-10) | ≥ 95 % | T3.4 |
| — | Compiler (REQ-COMP-9) | Tier 1 100 %, end to end ≥ 95 % | T4.4 |

`node scripts/eval-reports.mjs --out reports` regenerates all four; the suites
that are not runnable yet write a placeholder naming the task that builds them,
and a suite that runs and misses its threshold makes the script exit non-zero
*after* writing its report. That order is deliberate: HLD §14's mitigation for
"healing numbers disappoint" is to publish anyway, so the number is published and
then the gate fails, never the other way round.
