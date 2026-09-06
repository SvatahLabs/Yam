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
| [`runtime-java.md`](runtime-java.md) | Java runtime conformance (REQ-STD-3, LLD §14) | artifacts valid against the published schemas, then zero mismatches | `pnpm conform:runtime` (after `cd runtimes/java && ./gradlew fatJar`) |
| [`adapter-ax.md`](adapter-ax.md) | macOS Accessibility conformance (REQ-ADP-7, REQ-ADE-6) | 7 of 7 plus two healing cases; the project screen inside 10 s | `node scripts/desktop-conformance.mjs --adapter ax` on macOS with Accessibility granted |
| [`adapter-uia.md`](adapter-uia.md) | Windows UI Automation conformance (REQ-ADP-6) | 7 of 7 plus two healing cases | `node scripts/desktop-conformance.mjs --adapter uia` on Windows |

## The builder surfaces' artefacts (Draft 2.11, Phase 9)

Not evals: these are what T9.4 and T9.5 ask to be *looked at*, and they are
committed for the same reason the reports above are — so the current state is
readable without running anything, and so a change to it is a diff someone sees.

| Artefact | What it shows | Regenerate with |
|---|---|---|
| `sheet-dark.png`, `sheet-light.png` | The component sheet: every `@svatah/yam-ui` component in both themes (T9.2) | `pnpm sheet && pnpm sheet:shoot` |
| `app-flows.png`, `app-run.png` | The **packaged** app's two rebuilt screens, opened on the fixtures project and the `comp` run (T9.4) | `pnpm --filter @svatah/yam-desktop package && pnpm app:shoot` |
| `ui-flows.txt`, `ui-run.txt` | `yam ui`'s own frames for the same two screens, captured inside a pseudo-terminal (T9.4) | `pnpm ui:capture` |
| `app-flows-ax.png` | The app's window read through the AX adapter | `pnpm app:shoot` on macOS **with the Screen Recording grant**; absent here, see `docs/spec/progress/phase-9.md` K1 |

The two renderers' artefacts are of the same project and the same run, which is
the comparison T9.5 is for: the app's flow list and `yam ui`'s pane 1 are the
same seven files with the same statuses.

`adapter-uia.md` is the only report here that records a **blocked** run rather
than a measurement: there is no Windows host, and it says what it did measure,
what it did not, and the exact command that closes it. A report that quietly
omitted the distinction would be the thing Phase 6's verification caught (F1,
F8).

`adapter-ax.md` was blocked through Phase 7 and is a live measurement as of
Phase 8 (T8.2): conformant, against the *packaged* app, with the project screen
read in under a second.

`node scripts/eval-reports.mjs --out reports` regenerates all four; the suites
that are not runnable yet write a placeholder naming the task that builds them,
and a suite that runs and misses its threshold makes the script exit non-zero
*after* writing its report. That order is deliberate: HLD §14's mitigation for
"healing numbers disappoint" is to publish anyway, so the number is published and
then the gate fails, never the other way round.
