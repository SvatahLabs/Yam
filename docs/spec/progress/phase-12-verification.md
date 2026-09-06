# Phase 12 — adversarial verification

Verifier: separate session · Date: 2026-09-06 · Subject: branch `phase-12` at `31e6916`, based on `e6e1dee` (Draft 2.15)
Method: clean detached worktree of `phase-12`; the six-command contract with no model credential on Node 25 and on Node 22 with `CI=true`; the parity gate run from my checkout and compared with the committed report; every side of the self suite, the bite, the AX screenshot, the compiler eval, the release dry run, and the registry quick start re-run; the release readiness read against what the owner will validate.

## The headline results, checked

- **The parity gate from my checkout matches the record exactly.** 100 percent agreement over the 29 checks both sides reach; Svatah 30 of 48, external 47 of 48; no disagreement; exit 0; tree clean afterwards. The floor the prompt set was 30, and it is met at 30.
- **The one-sided list is nineteen, each named.** Four are a run inside a run, one a count rather than a quantifier, one geometry across two elements, one a label compared with its earlier value, three the oracles kept external, three the pseudo-terminal, and the rest each with its own sentence. Draft 2.17 folds the language ones into Phase 13 so the 45-of-48 ceiling is reachable there.
- **The golden set is 303 and every threshold holds.** Tier 1 250 of 250, Tier 2 44 of 50 at 88 percent, end to end 98 percent, reproduced from my checkout against the pinned model. Finding 49 third-person forms the grammar refused, and the PEG ordering behind it, is the kind of thing a 300-entry set is for.
- **Release readiness.** Thirty tarballs from the dry run; the registry quick start reports each module (a) package "not published" and runs the tarball path green; the changelog carries the date; nothing is published and no tag exists. That is the state the owner validates.
- **The desktop gate, live.** The committed report is conformant at 1.46 ms per node; my gate run inside the parity gate was conformant too. The load run the task asked for was made and its retry recorded.

## Contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm lint`, Node v25.6.1 | all exit 0 |
| `pnpm -r test`, Node v25.6.1 | exit 1: two ADE Playwright cases failed while my packaging step rebuilt the app they were driving; every vitest package passed. `pnpm --filter @svatah/ade test` alone afterwards: 126 vitest + 38 Playwright passed |
| `pnpm -r typecheck && pnpm -r test`, Node v22.23.2, `CI=true` | see the Node 22 line below |
| `git diff e6e1dee..phase-12 -- docs/spec/{requirements,hld,lld,tasks}.md docs/spec/design` | empty; the branch predates Draft 2.16 (D9), which the merge reconciles |
| `svatah surface doctor --adapter ax` | granted, session usable with four window owners, screen recording granted |
| `svatah eval self --report` from my checkout | 100 percent over 29; 30 of 48 and 47 of 48; 198 s and 438 s; exit 0 |
| `pnpm self:bite` | the gate bit with both sides' evidence |
| `pnpm self:http` | green against a real `svatah serve` |
| `pnpm self:sdk` | 12 of 12 screens agree |
| `pnpm ade:shoot` | thirteen screenshots including the AX one, 333 nodes in 688 ms, written outside the tree |
| `node scripts/eval-compiler.mjs --tier2` | 303 entries; tier 1 100 percent; tier 2 88.0 percent; overall 98.0 percent |
| `evals/compiler/refused.jsonl` against the golden set | 172 entries, 0 overlap |
| `pnpm release:dry-run` then `node scripts/quick-start-registry.mjs` | 30 tarballs; every module (a) package not published; tarball mode green |
| `docs/ci.md` | 211 lines, the two routes and the blocked steps named |
| Tree after every probe | clean |

Node 22: recorded in the consolidation message from the leg that ran after these probes.

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Every number reproduces; the ADE cases still assume nothing else touches the app, which my own packaging violated |
| 2 | Spec fidelity | 9 | Draft 2.15 implemented as written; nine deviations each reasoned, two of them corrections to the spec's own omissions |
| 3 | Test integrity | 10 | The gate caught a check the implementer had converted on a wrong premise and it was put back one-sided rather than made to pass |
| 4 | Boundaries, packaging, hygiene | 9 | Reports outside the tree; placeholders tracked; the HTTP adapter finally registered as a surface |
| 5 | Phase 11 corrections | 10 | All four closed with tests that run in milliseconds |
| 6 | Automation guarantees and secrets | 9 | The service token declared secret and redacted through the HTTP side |
| 7 | Reach | 9 | Svatah 30 of 48; the remaining gaps are sentences, named |
| 8 | ADE and cockpit | 9 | The palette's rows are real options; every control named; the Runs case reads a real run |
| 9 | Report accuracy and candour | 10 | The load run's retry, the check that went back, the tag deliberately not made |
| 10 | Deviation discipline | 9 | Nine deviations with sections and reasons, including the branch's base |

**Overall: 9.3 / 10.** Phase 12 is accepted. 0.1.0 is ready for the owner's validation and, at the owner's trigger, publication.

## Findings

**F1 — The remaining language gaps go to Phase 13 (Draft 2.17).** A run inside a run needs the ADE's service address in a flow: `app.attach.serviceLock` reads the lock file the ADE writes and exposes `{app.serviceUrl}` and `{app.serviceToken}` to the flow, so `Wait for the "<name>" API` can address it. `Exactly one <noun> …` and `… should be unique` complete pattern 32's quantifiers. Pattern 24 gains a two-element form, `The <a> should be to the left of the <b>` and `… on the same row as …`. `Remember` gains a comparison, `{a} should equal {b}`. With these, every non-oracle check reaches Svatah's side.

**F2 — The ADE's Playwright cases assume an idle machine and an untouched app.** Twice now a verifier's concurrent build or gate run has failed them. The test build has its own bundle name since Phase 11, so the cases should also refuse to start when another instance of that bundle is running, and say so, instead of failing thirty seconds later; Phase 13's corrections.

**F3 — Spec drift absorbed (Draft 2.17).** `capture.from` gains `url` (D1); pattern 32's IR is `expect.subject: "set"` with an `expect.set` descriptor (D2); a set excludes window chrome and a `<select>`'s own options, and an empty set fails (D3, D4, D5); `absent` and `hidden` take a resolver failure as their answer (D6); desktop `textContains` walks the subtree (D7); the HTTP adapter is registered as a surface (D8). D9, the branch's base, is reconciled at the merge: the Draft 2.16 layout entries for Phase 13's packages are marked planned and the layout check reads the mark.

**F4 — Nothing to correct in the release path.** The publish, the tag, and the runners are the owner's; the scripts that verify them afterwards exist and ran in their tarball mode.

## What was confirmed beyond the report

- The registry quick start distinguishes "not published" from a network failure, which is what makes its tarball fallback honest.
- The bite still bites after the catalogue's naming change, which is the check that the F2 fix from Phase 11 did not loosen the runner.
- The AX screenshot the implementer's terminal could not take exists again from mine, so every phase's record now has its picture.
