# Phase 4 implementation prompt

Paste the block below into a new Claude Code session opened at the repository root. It applies the Draft 2.5 spec amendments and the Phase 3 corrections from `docs/spec/progress/phase-3-verification.md`, then implements Phase 4 (independence adapters, compiler tiers 2 and 3, REPL, MCP server, privacy mode).

---

## Prompt

```
You are continuing the Svatah implementation. Phases 0 through 3 are merged on master, and Phase 3 was verified at 8.1/10 with corrections required. The spec on master is already Draft 2.5. You will apply the corrections, then implement Phase 4.

Read, in this order, and treat them as the source of truth:
- docs/spec/requirements.md
- docs/spec/hld.md
- docs/spec/lld.md
- docs/spec/tasks.md
- docs/spec/progress/phase-2.md and docs/spec/progress/phase-3.md (what exists)

Branching: create branch phase-4 from master. Commit after each item with "P3-F<n>: <title>" or "T4.<n>: <task title>".

The Draft 2.5 amendments listed below are ALREADY APPLIED on master; do not re-apply them and do not edit the four spec documents at all. They are listed so you know what changed since Phase 3 and can hold the code to them.

SPEC AMENDMENTS (Draft 2.5, already on master in docs/spec/lld.md; for reference only):

§4.3: after the paragraph beginning "Unchanged from Draft 1 (§2.3, §2.4 there)" add:
The dictionary's binding entries come from parsed binding files, through the same loader `BindingsStore` uses, never from scanning YAML text (Draft 2.5). A file the store accepts contributes exactly the phrases it declares, whatever their quoting, style, or indentation; a binding file that declares no phrases is a lint warning `W_BINDING_NO_PHRASES`.
§15: directly after the heading "## 15. CLI and MCP (package `cli`)" add the paragraph:
Base URL and storage state precedence (Draft 2.5), applied identically by every command that opens a session (`run`, `record`, `heal`, `bindings verify`, `surface conform`, `eval`, `repl`): the `--base-url` / `--storage-state` flag, then the `SVATAH_BASE_URL` / `SVATAH_STORAGE_STATE` environment variable, then `config.app`. A command that opens a session and ignores any of the three is a defect.
§9.2: append to the paragraph beginning "Provided by `@svatah/playwright-test`": " Model grounding for `bind()` record mode is registered by `@svatah/cli` (`installModelGrounding()`), never by the host, which stays model-free (§1, REQ-RUN-1); a flow project's Playwright config imports it from the CLI package."
§13.5 table: after the `POST /compile` row add:
| `GET /plan` | The compiled plan exactly as `svatah compile` writes it (steps, tiers, confidence, unbound targets), for the ADE's Plan screen | `Plan` |
§13.6: append to the first bullet, after "every capability comes from the service or the bridge.": " The built main and preload bundles are CommonJS because a sandboxed preload has no ES module loader; sources stay ESM-syntax TypeScript and the renderer is a browser ES module. Electron Forge under pnpm requires `public-hoist-pattern[]=*electron*` in `.npmrc`; no wider hoisting is permitted, and the ADE pins `vite` to a major whose dependency tree is permissively licensed (REQ-PKG-3)."
§16: after the timing-assertions bullet add two bullets:
- Grounding eval cases (Draft 2.5): only elements that carry a ground-truth key and appear in the surface snapshot are cases. Elements without a key, or outside the snapshot (for example `<datalist>` options, which belong to the vision fallback), are listed in `evals/grounding/fixture-answers.jsonl` for the fake gateway and excluded from the accuracy denominator; the report publishes the exclusion count and reason.
- Run artifacts (`results.jsonl`, `summary.json`, `audit.jsonl`, screenshots, traces) are committed only under `evals/conformance/` and `reports/`. Every project directory ignores `runs/`, `.svatah/`, and any absolute-path echo such as `var/`; a repository check enforces it.
§17: add as first bullet:
- Draft 2.5 (after Phase 3 verification): the target dictionary is built from parsed binding files and `W_BINDING_NO_PHRASES` (§4.3); base URL and storage state precedence for every session-opening command (§15); `bind()` model grounding registered by the CLI (§9.2); `GET /plan` (§13.5); CommonJS ADE bundles, the Electron hoist pattern, and the Vite pin (§13.6); grounding-case exclusions and the run-artifact hygiene rule (§16).

PHASE 3 CORRECTIONS (before any Phase 4 task):
F1 Dictionary reader. packages/cli/src/project.ts builds the target dictionary by scanning binding files with the regex /^ {2}- "(.+)"$/gm. Reproduce first: unquote one phrase in a copy of evals/fixtures/bindings/home/sign-in-button.yaml and observe `svatah compile --json` emitting ref "sign-in-button", status "unbound" while `svatah bindings show home.sign-in-button` still lists the phrase. Fix per LLD §4.3 as amended: parse the files through the store's loader (or a shared reader in @svatah/bindings that the CLI may import) and add tests for unquoted, single-quoted, flow-style, and differently indented phrase lists, plus the `W_BINDING_NO_PHRASES` lint.
F2 Base URL precedence. Apply LLD §15 as amended to every session-opening command; `svatah heal --run` today ignores SVATAH_BASE_URL. Add one test per command that sets only the environment variable and expects it honoured, and one that sets flag and environment and expects the flag.
F3 Committed run artifacts. Delete evals/fixtures/var/** from the tree; add `var/` to evals/fixtures/.gitignore and to `svatah init`'s template; add a repo check that no results.jsonl, summary.json, audit.jsonl, or screenshot PNG is committed outside evals/conformance/ and reports/.
F4 Nothing beyond the amendments; D2 through D6 are no longer deviations.
F5 Progress file. Add a "Post-verification corrections" section to docs/spec/progress/phase-3.md with the verifier's Node 22 result and the two defects above.

PHASE 4 SCOPE: tasks T4.1 through T4.7 in docs/spec/tasks.md, in order. Nothing from Phase 5. Phase 4 delivers the independence proof (WebDriver BiDi and Appium adapters), compiler tiers 2 and 3, privacy mode, the REPL, and the MCP server with raw surface tools and trajectory capture.

Environment and fallbacks (state which applied in the progress file):
- Tier 3 and the model evals use the same credential rules as Phase 3: environment or `ant auth login` only, never written anywhere; without a credential, implement against the fake gateway and mark real-model runs blocked with the exact command.
- Tier 2 needs a local model server (Ollama or llama.cpp). If none is installed and cannot be installed, implement the local backend against a fake local server that speaks the same HTTP contract, add the golden `tier: 2` subset, and mark the 80 percent measurement blocked with the exact command; do not fabricate a number.
- The BiDi adapter must run against stock Chrome or Firefox; if only Playwright's bundled Chromium is available, run BiDi against it and record the browser used.
- The Appium adapter needs an emulator. If none is available, implement the adapter, unit-test the page-source conversion and candidate mapping against recorded page sources, and document the manual gate with the exact commands; mark the emulator run blocked.
- Only chromium is required for Playwright-based validation, as before.

Decisions already made (do not re-open):
- The BiDi adapter implements AgentSurface directly over a thin WebSocket client with its own actionability wait and an injected accessible-name script (LLD §7.3); capability flags declare what BiDi cannot do rather than emulating it.
- Tier 2 uses schema-constrained JSON, temperature zero, a fixed seed, and a pinned digest recorded in provenance; digest mismatch fails compile without --allow-model-drift (LLD §4.3 of Draft 1, §10).
- The MCP server exposes the operation tools and the raw surface tools `surface_snapshot`, `surface_act`, `surface_read`, `surface_check`, each requiring an `intent`, and writes trajectory.jsonl (LLD §15, §13.4). It runs the same functions the CLI runs; no logic lives in the server.
- The REPL grounds unbound targets through the recorder when a gateway is available and through the picker otherwise, and appends to a session flow and bindings on exit (LLD §15).
- Privacy mode is a documented configuration plus a CI test that blocks every non-localhost connection during compile and run.

Working rules:
1. Follow each task's Do and Validate literally; a task is complete only when every Validate item is demonstrated by a test or a command a verifier can re-run.
2. If the spec cannot be followed as written, implement the closest faithful option and record it under Deviations in docs/spec/progress/phase-4.md with the section reference and reason. Do not edit the spec beyond the amendments above.
3. Model and local-model calls are allowed only through the gateway; the replay path stays model-free and the import-boundary lint must still pass.
4. Permissive licences only (REQ-PKG-3); Node 22 LTS.

Evidence you must leave (the verification contract):
- docs/spec/progress/phase-4.md with, per correction F1..F5 and per task T4.1..T4.7: status, the exact commands demonstrating each Validate item, observed results, which environment fallback applied; Deviations and Known gaps sections.
- Everything runnable from a clean checkout with: pnpm install && pnpm browsers && pnpm -r build && pnpm -r test, with no credential and no local model server present.
- The surface conformance suite passing for adapter-bidi (`svatah surface conform --adapter bidi`) and the fixtures replaying on BiDi with statuses identical to Playwright (runtime conformance).
- The privacy-mode CI test and its documentation naming exactly which commands still need a remote model.
- The compiler eval report with per-tier exact match under reports/, stating which gateway and which local model (or fake) produced it.
- An MCP client integration test that drives compile and run and a six-call surface exploration producing a well-formed trajectory.jsonl.
- A REPL integration test driven over stdin for three sentences.

When finished, print a summary table of F1..F5 and T4.1..T4.7 with status and commit hash, then stop. Do not begin Phase 5.
```

---

## Verification contract (used by the verifying session)

The verifier will, in a clean worktree of `phase-4`:

1. Run the contract with no credential and no local model server, also on Node 22 with `CI=true`; confirm `git diff master..phase-4 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.
2. Unquote and re-indent phrases in binding files and expect the compiler to bind them; expect `W_BINDING_NO_PHRASES` on a file with none.
3. Run and heal a copy of the fixtures with the base URL supplied only through the environment, through both command lines.
4. Confirm no run artifact exists outside `evals/conformance/` and `reports/`.
5. Run the BiDi conformance suite and the fixtures replay on BiDi, comparing statuses to the Playwright run.
6. Run compile under the privacy configuration with all non-localhost traffic blocked; run compile with the Tier 2 digest deliberately mismatched and expect a refusal.
7. Drive the MCP server from a client: compile, run, six surface calls with intents, and inspect the trajectory file.
8. Score on the ten parameters and report per item: verified, verified with deviations, or failed, with a reproducing command for each failure.
