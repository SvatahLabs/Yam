# Phase 3 — adversarial verification

Verifier: separate session · Date: 2026-09-03 · Subject: branch `phase-3` at `1a6d4a7`
Method: clean detached worktree of `phase-3`; the contract run with no model credential; every claim in `docs/spec/progress/phase-3.md` re-run or probed; the verification contract's own probes constructed independently. No model credential was available to the verifier either, so the model-half numbers are verified as "fake gateway, stated as such", not re-measured.

## Contract

| Command | Result |
|---|---|
| `pnpm install && pnpm browsers && pnpm -r build && pnpm -r test` with `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` unset | 30 packages built; 2,197 tests passed, 0 failed |
| Same on Node v22.23.2 with `CI=true` | 2,197 passed |
| `pnpm lint` | clean |
| Spec diff `phase-2..phase-3` | exactly the Draft 2.4 amendments; `requirements`, `hld`, `tasks` byte-identical to the verifier's copies, `lld` identical in content |
| Committed credentials | none; the only `sk-ant-` string is the placeholder `sk-ant-not-a-real-key` in a test |
| `node scripts/compatibility.mjs` with external network blocked | byte-stable plan, both hosts identical over 40 steps, 21/4/15, conformance fixture unchanged |
| `svatah record` without a credential and without `--gateway fake` | refuses with the documented message, exit 3 |
| `svatah record --gateway fake` on a copy of the fixtures | writes 7 bindings with `provenance.model: fake:grounding-cases`, `promptVersion: g-1`; replay with every non-loopback connection refused passes except the documented unsupported step |
| `svatah record` with `environment: production` | refuses, exit 10 |
| Malformed and schema-invalid binding files | diagnostic naming the file and the path, exit 64, no run directory |
| `POST /run` without required inputs | 400 with the missing story, name, and type; `GET /project` carries every story's signature |
| `pnpm eval:grounding -- --gateway fake` | 198 cases, 100 percent, report headed "This run used fake:grounding-cases, which is not a model" |
| `pnpm --filter @svatah/ade make` and `smoke` | macOS zip built; `svatah-ade smoke ok … flows=5 stories=17 window=open` |
| ADE renderer | no `require`, `node:`, `electron`, or `ipcRenderer` reference; bridge is exactly four functions; accessibility flag present |
| Heal cycle, `svatah-bindings heal --run`, first step and later step | both repaired at score 1.000, re-run returns to the healthy baseline |
| Heal cycle, `svatah heal --run`, first step and later step | repaired when the base URL comes from `--base-url` or `config.app.baseUrl`; `unreachable` when it comes only from `SVATAH_BASE_URL`, which `svatah run` honours |
| Their `heal-cycle.test.ts` in the clean worktree | 5 passed |

## Scores (10 parameters, 1–10)

| # | Parameter | Score | Basis |
|---|---|---|---|
| 1 | Contract reproducibility | 9 | Green on a clean checkout with no credential, on Node 25 and Node 22 with `CI=true`; ADE builds and launches |
| 2 | Spec fidelity | 8 | Six deviations, each argued from the spec's own constraints (host stays model-free, sandboxed preload cannot load ESM, Forge needs a hoist pattern); absorbed in Draft 2.5 |
| 3 | Test integrity | 9 | Heal cycle end to end through both command lines; security, parity, and screen-rule tests on the ADE; the blocker's own negative control; the redaction guard stops a call |
| 4 | Boundaries, packaging, hygiene | 7 | Lint clean, module (a) still closed. Fourteen run artifacts (91 KB, screenshots included) sit committed under `evals/fixtures/var/folders/…`, an absolute temp path echoed into the project by T2.10 and missed by the Phase 2 verification |
| 5 | Phase 2 corrections | 8 | F1 through F5 verified; `svatah heal --run` ignores the `SVATAH_BASE_URL` override that `run` honours |
| 6 | Model path honesty | 9 | Every artifact names its gateway; the fake path cannot be taken by accident; production refused; the SDK is used with adaptive thinking, structured output, and a cached instruction block |
| 7 | Compiler and recorder robustness | 5 | The CLI builds the target dictionary by scanning binding files with a regex for lines of the form two spaces, dash, double-quoted phrase. A binding whose phrase is unquoted, single-quoted, or indented differently silently vanishes from the dictionary while `bindings list` and `bindings show` still report it; every step naming it compiles `unbound` and fails at run with zero candidates |
| 8 | ADE | 8 | Shell, seven screens, security checklist, parity with the CLI, smoke and installer on macOS; record and heal review deferred as planned |
| 9 | Report accuracy and candour | 9 | Ten known gaps and six deviations stated plainly, including which numbers are not numbers |
| 10 | Deviation discipline | 9 | Every departure carries a section reference and a reason |

**Overall: 8.1 / 10.** Phase 3 is accepted with corrections. The dictionary reader must be fixed before Phase 4's REPL and MCP tools, which write and read binding files, build on it.

## Findings

**F1 — Binding phrases are read by text scanning, not by parsing (REQ-COMP-5, LLD §4.3).** `packages/cli/src/project.ts` line 103 collects phrases with `/^ {2}- "(.+)"$/gm` over the raw file. Reproduce: in a copy of the fixtures, change `  - "the sign in button"` to `  - the sign in button` in `bindings/home/sign-in-button.yaml`; `svatah compile --json` now emits `ref: "sign-in-button", status: "unbound"` for both stories that click it, while `svatah bindings show home.sign-in-button` still lists the phrase. Any reformatting tool, hand edit, or a future writer that emits plain scalars unbinds the project silently. Fix per LLD §4.3 as amended: build the dictionary from parsed binding files through the same loader the store uses; add tests for unquoted, single-quoted, flow-style, and differently indented phrase lists; lint `W_BINDING_NO_PHRASES` for a file that declares none.

**F2 — Base URL override precedence differs between commands (LLD §15).** `svatah run` honours `SVATAH_BASE_URL`; `svatah heal --run` reads only `--base-url` and `config.app.baseUrl`, so a run started against an ephemeral port cannot be healed unless the flag is repeated. Fix per LLD §15 as amended: one precedence, flag then environment then config, applied by every command that opens a session, with a test per command.

**F3 — Run artifacts committed inside the fixtures project.** `evals/fixtures/var/folders/x5/…/svatah-compat-xmqy7l/none-{1,2}/` holds `results.jsonl`, `summary.json`, `audit.jsonl`, and four screenshots, added in `fda684a` (Phase 2, T2.10) when a temp path was joined rather than resolved. Remove them, ignore `var/` and `runs/` in every project directory, and add a repo check that run artifacts exist only under `evals/conformance/` and `reports/` (LLD §16 as amended).

**F4 — Deviations absorbed (Draft 2.5).** D2 (grounding-case exclusions), D3 (model grounding registered by the CLI), D4 (CommonJS ADE bundles), D5 (Electron hoist pattern and Vite pin), D6 (`GET /plan`) are written into the LLD so they stop being deviations.

**F5 — Report correction.** Add the verifier's Node 22 result and the two defects above under a post-verification section.

## What was confirmed beyond the report

- The heal-from-run cycle that failed in Phase 2 now completes through both command lines, for a first-step and a later-step failure, with the repaired binding scoring 1.000 against a runner-up below 0.4.
- The network blocker refuses every non-loopback connection through `fetch`, `http`, `tls`, and raw sockets, and the recorded fixtures replay under it.
- The ADE's parity test proves the same `plan.json` hash and the same `runs/<id>` files whether a flow is compiled and run from the editor or from the CLI.
- The gateway redaction guard aborts a call when a secret survives rendering, rather than sending it.
