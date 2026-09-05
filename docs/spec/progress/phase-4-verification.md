# Phase 4 — adversarial verification

Verifier: separate session · Date: 2026-09-03 · Subject: branch `phase-4` at `cc6d4e5`
Method: clean detached worktree of `phase-4`; the contract run with no model credential; every claim in `docs/spec/progress/phase-4.md` re-run or probed; the verification contract's own probes constructed independently. Ollama with `qwen2.5:3b` was available to the verifier, so the Tier 2 number was re-measured; no model credential, so Tier 3 stays fake; a matching chromedriver was installed to exercise the BiDi attach route against stock Chrome 152.

## Contract

| Command | Result |
|---|---|
| `pnpm install && pnpm browsers && pnpm -r build && pnpm -r test`, no credential | 30 packages built; 2,532 tests passed, 0 failed |
| Same on Node v22.23.2 with `CI=true` | 2,532 passed |
| `pnpm lint`, `pnpm check:licenses` | clean; one named licence exception (`css-value@0.0.1`, MIT text in its README) |
| `git diff master..phase-4 -- docs/spec/*.md` | empty |
| Dictionary probes: unquoted, single-quoted with four-space indent, flow style | all bind `home.sign-in-button`; an empty `phrases` list lints `W_BINDING_NO_PHRASES` |
| Run artifacts outside `evals/conformance/` and `reports/` | none; `evals/fixtures/var` gone |
| Heal with the base URL only in the environment, first-step failure | `svatah heal --run` and `svatah-bindings heal --run` both repair at 1.000 |
| Heal with the base URL only in the environment, later-step failure behind the login | module (a) repairs; **module (b) `unreachable`: "The replay did not reach the failing step"** with or without `--base-url`, because the replay has no story inputs (see F1) |
| `node scripts/bidi-independence.mjs` | Firefox 153 launched; 16/16 conformance; two BiDi runs agree; 40/40 steps identical to the Playwright baseline |
| `svatah surface conform --adapter bidi` with the app reachable, by flag and by environment | 16 passed, 72 checks, conformant |
| BiDi attach to stock Chrome 152 through chromedriver 152 (`SVATAH_BIDI_URL=ws://…/session/<id>`) | **fails**: `session not created: session already exists` — the adapter sends `session.new` on a driver-hosted session (see F3) |
| `node scripts/privacy-check.mjs` | compile, lint, run reached nothing beyond the machine |
| Tier 2 digest pin on a flow that needs the model | mismatch: exit 3, no plan; `--allow-model-drift`: exit 0, provenance digest `357c53fb…` recorded |
| `svatah eval compiler --tier2` from the repository as committed | **tier 2 scored 0/41 and "Below thresholds"**; the eval reads `compile.tier2` from the project root's config, which the repository does not have, and the golden project's config is not consulted (see F2) |
| Same with a root config naming `qwen2.5:3b` and its digest, twice | tier0 3/3, tier1 148/148, **tier2 37/41 (90.2 %)**, overall 97.9 %, identical on both runs — the published number reproduces |
| MCP over real stdio with an independent SDK client | 10 tools listed; `svatah_compile`, `svatah_run` (8/1/4 as the CLI), six surface calls with intents; `trajectory.jsonl` has six lines with `seq`, `at`, `intent`, `call`, `args`, `snapshotHash`, `result` |
| `svatah repl` over stdin, three sentences, `--gateway none` | runs, one step executed, a flow written on exit; the two rejected sentences were `Expect …` forms the grammar does not have (see F4) |
| Appium | blocked, no emulator; 95 unit tests on page-source conversion only |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on a clean checkout, both Node versions, no credential; the one published number that does not reproduce from the repository is the Tier 2 rate, for want of a committed config |
| 2 | Spec fidelity | 7 | Grammar diverges from LLD §4.2: no `Expect <subject> to …` and no `Verify / Check that / Assert that` prefixes, although the synonym vocabulary lists them; eight deviations otherwise well argued |
| 3 | Test integrity | 8 | BiDi independence and snapshot parity run inside the suite; MCP tested over an in-memory transport only; the attach route is unit-tested but does not work end to end; the eval scores an unconfigured tier as zero |
| 4 | Boundaries, packaging, hygiene | 9 | Stray artifacts removed with a repo check; module (a) closure asserted exactly; licence exception named and pinned |
| 5 | Phase 3 corrections | 8 | Dictionary, precedence, and artifact fixes verified; the later-step heal is still unreachable through the runtime replayer, now for want of inputs rather than the base URL |
| 6 | Model path honesty | 8 | Every artifact names its gateway; the local model is real and its number deterministic; but `eval compiler` reports an unconfigured tier as 0/41 "below thresholds" instead of "not measured" |
| 7 | Independence proof | 8 | Conformant and step-identical on Firefox; the documented stock-Chrome route fails on the first message |
| 8 | REPL, MCP, privacy | 8 | All three work as claimed under independent drives; MCP's third-party framing untested by the suite |
| 9 | Report accuracy and candour | 8 | Ten gaps and eight deviations stated plainly; K3 overstates the attach route as implemented, and the Tier 2 configuration prerequisite is described as a documentation matter rather than a missing repository file |
| 10 | Deviation discipline | 9 | Every departure carries a section reference and a reason |

**Overall: 8.2 / 10.** Phase 4 is accepted with corrections. The heal-replay input gap and the eval configuration must be fixed before Phase 5's workflow runner and tool server, which depend on story inputs, build on them.

## Findings

**F1 — Replay for healing has no story inputs (REQ-HEAL-1, LLD §10).** A failure at step 5 of `I want to validate login`, behind `Type {input.email}` and `{input.password}`, cannot be healed through `svatah heal --run`: the runtime replayer runs the four-step prefix with an empty scope, the typed steps fail, and the healer reports `unreachable`. The command has no `--input`, and the run records only the names of its inputs. Fix per LLD §10 as amended: `heal --run` accepts `--input` and `SVATAH_INPUT_<NAME>` exactly as `run` does; the run's summary records input names; an `unreachable` for want of an input names it. Add the later-step-behind-login case with inputs to `heal-cycle.test.ts`, which today uses a flow without inputs.

**F2 — The Tier 2 number is not reproducible from the repository (REQ-COMP-9, REQ-PKG-4).** `svatah eval compiler` loads `compile.tier2` from the config at `--project` (default `.`); the repository root has no `svatah.config.yaml` and `evals/compiler/project/` has none either, so a clean checkout scores tier 2 at 0/41 and prints "Below REQ-COMP-9's thresholds". The committed report was produced with a config that is not in the tree. Fix per LLD §16 as amended: commit the eval's config with the pinned digest, make the eval read it, and report a requested but unconfigured tier as `not measured`, never as 0/N.

**F3 — BiDi attach to a driver-hosted session fails (REQ-ADP-4, LLD §7.3).** With chromedriver 152 started with `webSocketUrl` and `SVATAH_BIDI_URL=ws://127.0.0.1:9515/session/<id>`, the adapter connects and immediately sends `session.new`; chromedriver answers `session already exists` and the adapter throws `SessionError`. The README documents exactly this route. Fix per LLD §7.3 as amended: skip `session.new` when attaching to a `…/session/<id>` endpoint and learn the browser from `session.status`; test both attach shapes against recorded exchanges; run the stock-Chrome attach in the independence script whenever chromedriver is present.

**F4 — Assertion sentence forms narrower than the LLD (REQ-COMP-2, LLD §4.2).** `Expect the sign in button to be visible`, `Expect the page title to contain "Svatah"`, `Expect the URL to contain "/"`, and `Verify the sign in button is visible` all fail with `E_NO_MATCH`; only the `The <target> should …` forms of the reference's patterns 23 and 24 compile. LLD §4.2 patterns 16–20 and 26 name the `Expect … to …` and `Verify / Check that / Assert that` forms, and the synonym vocabulary in §2.4 lists those verbs for `expect`. Fix per LLD §4.2 as amended: accept both surfaces for the same predicates, lowering to the same IR, with golden entries for each alias.

**F5 — Report corrections.** K3 should say the attach route fails against chromedriver; the Tier 2 section should say the eval needs a config the repository lacks; add the verifier's results.

## What was confirmed beyond the report

- The Tier 2 rate of 37/41 reproduced exactly on two consecutive runs against the same weights, and the digest pin refuses a mismatch and records the served digest under `--allow-model-drift`.
- The MCP server works over a real stdio transport with a client the implementer did not write; every surface call produced a trajectory line with its intent.
- The privacy mode holds under the network blocker for compile, lint, and run.
- The dictionary now accepts every phrase spelling tried, and `bindings show` and `compile` agree.
