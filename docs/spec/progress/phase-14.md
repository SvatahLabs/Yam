# Phase 14 — The front door

Implementer: this session · Branch `phase-14` from `yam-bootstrap` at `8c97dff` · Host: macOS 15 (Darwin 25.3.0), arm64, Node v25.6.1, pnpm 10.30.2, tmux 3.7c

Spec: Draft 2.20 at the branch point, and Draft 2.21 (the human gateway and the agent's explore, owner decision of 2026-09-07) written on this branch as its own commit (`2e40e44`) before T14.8 and T14.9; the four documents were not edited by any task commit.

## Environment, and which fallback applied

| Thing | This host |
|---|---|
| tmux | not installed when the phase began; installed with Homebrew (3.7c), as the prompt allows, and said here |
| Model credential | none; every recording is `--gateway fake` |
| Browser | Chromium for Playwright, already installed |
| Desktop adapters | not exercised; the doctor's refusal in T14.4 is produced from the doctor's own line |

## The contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r typecheck && pnpm lint`, Node v25.6.1 | all exit 0 |
| `pnpm -r test`, Node v25.6.1, `CI=true` | after T14.9: 36 packages, **3,793 passed, 0 failed** once the screen fixtures were re-recorded for the service's new `gateway.display` field (the one red row of that run); after T14.6: 3,778 passed, with the three repository checks corrected in the record's commit |
| `pnpm docs:check` | 67 pages current |
| `pnpm quick-start` | 5.9 s of the ten-minute budget |
| `yam eval self --only <each of the four front-door checks>` | 100 percent agreement, 0 one-sided, each |
| `node scripts/front-door-self.mjs status\|check\|help` | exit 0, each |

## The newcomer's session

Every prompt and every reply, against `apps/sample-web` on port 4173, in an empty directory, with `YAM_PASSWORD` set and no model credential. The grounding lines the recorder prints per element are elided.

```text
$ yam init
Initialised this directory.

  yam check     read, lint and compile the flows
  yam record    bind the targets by driving the real application
  yam run       replay the plan

  yam           at any time: where you are, and what is next

(exit 0)

$ yam
my-project · /private/tmp/yam-journey
flows     1 file, 1 story
plan      missing
last run  none yet

next      yam check
          There is no plan yet.
(exit 0)

$ yam check
plan written: 5 steps, tier 0 0, tier 1 5, tier 2 0, tier 3 0 → /private/tmp/yam-journey/.yam/plan.json
(exit 0)

$ yam
my-project · /private/tmp/yam-journey
flows     1 file, 1 story
plan      current, 3 targets unbound
last run  none yet

next      yam record
          3 targets have no binding yet, starting with `the password field`.
(exit 0)

$ yam record --gateway fake
using the fake gateway: 349 answer(s) from evals/grounding/cases. Nothing here measures a model.
  ✓ Sign in · Open "/login"
      username-field: grounded
  ✓ Sign in · Type {data.user.email} into the username field
      password-field: grounded
  ✓ Sign in · Type {data.user.password} into the password field
      sign-in-button: grounded
  ✓ Sign in · Click the sign in button
  ✓ Sign in · The page title should contain "Dashboard"
wrote /private/tmp/yam-journey/record-report.json
Recorded 5 step(s) across 1 story(ies).

  ✓ Sign in · Open "/login"
  ✓ Sign in · Type {data.user.email} into the username field
  ✓ Sign in · Type {data.user.password} into the password field
  ✓ Sign in · Click the sign in button
  ✓ Sign in · The page title should contain "Dashboard"

  3 grounded, 0 reused, 0 failed; 3 binding(s) verified and written
  3 model call(s), 0 from cache, 0 in / 0 out, $0.0000
  Gateway: fake:grounding-cases — not a model. These decisions were supplied, not inferred, and nothing here measures a model's accuracy.
(exit 0)

$ yam
my-project · /private/tmp/yam-journey
flows     1 file, 1 story
plan      current, every target bound
last run  none yet

next      yam run
          The plan has never been run.
(exit 0)

$ yam run
  ✓ Sign in · Open "/login"
  ✓ Sign in · Type {data.user.email} into the username field
  ✓ Sign in · Type {data.user.password} into the password field
  ✓ Sign in · Click the sign in button
  ✓ Sign in · The page title should contain "Dashboard"

00mtqzt433lvv39b: 5 passed, 0 failed, 0 skipped → /private/tmp/yam-journey/runs/00mtqzt433lvv39b
(exit 0)

$ yam
my-project · /private/tmp/yam-journey
flows     1 file, 1 story
plan      current, every target bound
last run  passed just now (5 passed, 0 failed, 0 skipped) · 00mtqzt433lvv39b

next      yam run
          Green. Replay whenever you like.
(exit 0)

$ rm bindings/sign-in-button.yaml
(exit 0)

$ yam
my-project · /private/tmp/yam-journey
flows     1 file, 1 story
plan      current, 1 target unbound
last run  passed just now (5 passed, 0 failed, 0 skipped) · 00mtqzt433lvv39b

next      yam record
          1 target has no binding yet, starting with `the sign in button`.
(exit 0)

$ yam run
  ✓ Sign in · Open "/login"
  ✓ Sign in · Type {data.user.email} into the username field
  ✓ Sign in · Type {data.user.password} into the password field
  ✗ Sign in · Click the sign in button
      No binding for `the sign in button` (sign-in-button). → yam record
  – Sign in · The page title should contain "Dashboard"

00mtqzt5blrf5vpr: 3 passed, 1 failed, 1 skipped → /private/tmp/yam-journey/runs/00mtqzt5blrf5vpr
(exit 1)

$ yam heal
healing the last run, 00mtqzt5blrf5vpr
`the sign in button` (sign-in-button) has never been recorded; there is nothing to relocalize from. → yam record
(exit 7)

$ yam
my-project · /private/tmp/yam-journey
flows     1 file, 1 story
plan      current, 1 target unbound
last run  failed just now (3 passed, 1 failed, 1 skipped) · 00mtqzt5blrf5vpr

next      yam record
          1 target has no binding yet, starting with `the sign in button`.
(exit 0)
```

## T14.1 `yam` says where you are and what is next

**Status: done.** Commit `69b7321`.

`packages/cli/src/front-door.ts`: `findProjectRoot` walks up to the nearest config; `projectState` derives the five facts; `nextVerb` decides in §15.1's order; `yam` and `yam status` print the four lines and the verb, exit 0; `--json` prints the state with `next`. `run` writes `.yam/last-run` on start.

Two things this task found and fixed on the way. `yam compile` wrote its plan relative to the working directory rather than under the project (`runs/../.yam/plan.json` from wherever it was typed), so a plan compiled from the repository root landed beside the repository; it is under the project root now. And the plan schema is closed (LLD §3.2), so the input hash lives beside the plan in `.yam/plan.inputs.json` rather than in it (D1).

**Validate:** `packages/cli/test/front-door.test.ts` — one test per state in §15.1's order, each asserting the verb; `yam` in an empty directory exits 0 and names `init`; on a copy of `evals/fixtures`: `check` before a plan, `run` when current, `check` after a flow is edited, `record` after a binding is removed; `--json` round-trips.

## T14.2 `check`, and the plan's currency

**Status: done.** Commit `2369aa3`.

`yam check` is `compileCommand` with one report and the plan line in §15.1's words (`plan written: 22 steps, tier 0 0, tier 1 22, tier 2 0, tier 3 0 → …`); `lint` and `compile` stay. `run`, `record` and `heal` print `plan was stale; checked` or `no plan yet; checked` when that is what happened; `run --no-check` runs the plan on disk and refuses a stale or missing one with the catalogue's row. `yam heal` with no arguments reads `.yam/last-run` and says which run. The `run` report prints the failing step's reason under its `✗` line, with the verb.

The resolver's message for a target with no entry was `Could not resolve "id" (phrase): 0 candidates tried, none matched exactly one element`; it is `No binding for \`phrase\` (id).` now, which is what a newcomer can act on and what the healer parses.

**Validate:** `packages/cli/test/check.test.ts`: the plan line; an edited flow makes the plan stale and the note is printed; `--no-check` on a stale plan and on no plan name `check` and write no run; `yam heal` with no run names `run`, and with `.yam/last-run` heals that run; the reason lines.

## T14.3 Help: one screen, one command, one topic

**Status: done.** Commit `6f563d6`.

`packages/cli/src/help.ts`: `TOP_LEVEL` verbatim from LLD §15.1 (a test reads the block out of the document and compares); `COMMANDS`, thirty-one entries, each with synopsis, options, the session reference and exit codes; `NOUNS` for `yam <noun>` alone; six topics, four as markdown under `packages/cli/public/help/` shipped to `dist/help/`, `session` in the module, `exit-codes` generated from `EXIT`; the usage-and-64 path is only an unknown command. `init` says "Initialised this directory." and names `check`, `record`, `run`, and `yam`.

**Validate:** `packages/cli/test/help.test.ts`: the verbatim comparison; the seven verbs in order; every command's `--help` exits 0 and mentions no other command's options; nouns list their verbs; every topic prints; the exit-code table carries every code of the commands' `EXIT` and the runtime's; `tools/repo-checks/test/front-door.test.ts` reads every user-facing string from the built package and `init`'s output and fails on "module (a)", "module (b)", "LLD §", "REQ-", "Draft n", a task id or a finding id.

## T14.4 The diagnostics that name the next verb

**Status: done.** Commit `9d1dbaf`.

`packages/cli/src/diagnostics.ts`: the ten-row catalogue, `say()` printing `message → next` or `{ code, message, next }` under `--json`, `DIAGNOSTICS` with example parameters for the vocabulary check. `preflight` (no project, no flows) runs at the start of `check`, `record` and `run`; `warnUnsetSecrets` at the start of `run`; `reasonFor` maps a failed step's class and message onto the rows; the resume mismatch and the production refusal go through the catalogue. The workflow package's refusal message no longer carries a requirement id.

**Validate:** `packages/cli/test/diagnostics.test.ts` produces every row from the real condition: an empty directory, an emptied `flows/`, a run with an unbound target against `about:blank`, a stale plan with `--no-check`, an unset secret at the start of a real run, a launch failure's message, the doctor's line, a real checkpoint with a changed plan, a non-idempotent story against a production config; and the `--json` form.

## T14.5 The tmux workspace

**Status: done.** Commit `788c74d`.

`packages/cli/src/commands/workspace.ts`: `yam ui --tmux` and `yam workspace`. The service starts in the session's first window, its handshake read from a file, its address set into the session environment; the `yam` window has the cockpit left, a shell top right, `yam runs tail` bottom right, and `$EDITOR` on the open flow when set; the cockpit's pane ends the session when the cockpit quits; a second invocation attaches; `--detach` builds without attaching, for scripts. `yam runs tail` (`packages/cli/src/commands/runs.ts`) follows the service's stream and prints step results, run start and summary, and log lines. Without tmux: the cockpit alone and one line.

**Validate:** `packages/cli/test/workspace.test.ts`: with tmux, the session exists with four panes whose start commands are the cockpit, an empty shell, `runs tail` and the editor; one `yam serve` process; a second invocation attaches and still one process; killing the session removes it; without tmux on `PATH` the cockpit starts (`--json`) and the line is printed; `runs tail` refuses without a service and formats every event kind. `pnpm ui:capture` re-recorded the four committed captures: the diff was the temporary path, the port, "N s ago", and a three-column shift that dated from Draft 2.18's rename (`svatah ui` → `yam ui` in the header) — the captures had been stale since then, not changed by this task (D2).

## T14.6 The front door in the documentation and the self suite

**Status: done.** Commit `bf2a027`.

`docs/getting-started/first-flow.md` and the README's flow section are the six verbs with `yam`'s state line; `docs/reference/generated/cli.md` is the top-level help, every command's help and the topics, from the built package. Three checks in `evals/self/checks.yaml`: Yam's side runs `scripts/front-door-self.mjs status|check|help` (the built binary, as a newcomer would); the external side is the command line's own cases in `packages/cli/test`, which hold the words to the design. The catalogue check now knows that a command source on the `yam` side answers to its own name rather than to a story.

**Validate:** `pnpm docs:check` clean; the quick start at 5.9 s; `yam eval self --only <id>` at 100 percent for each of the three; `tools/repo-checks/test/self-catalogue.test.ts` green.

## T14.8 The human gateway (Draft 2.21)

**Status: done.** Commit `6787e59`.

`pick?` on the surface and the `pick` capability, in the schema's flag list and every adapter's descriptor (`true` for Playwright, `false` for the five others); the in-page picker moved beside the Playwright adapter and re-exported, so module (a)'s `bind()` and the recorder share one overlay; `PlaywrightSurface.pick(phrase, { id })` runs the overlay, locates the stamped element, mints its reference and clears the stamp, and answers from `YAM_PICK` without a person when that is set. The recorder's per-target step takes the `human` path before `ground()`: `pick`, then `entryFor(surface, ref, { promptVersion: "pick" })`, provenance `human`; a refused adapter or an Escape stops the session with a sentence. `gatewayForRecording` knows `human`, and the default is `anthropic` with a credential, else `human` for a person at a terminal with a display and no `CI`, else the refusal as before. The service reports `gateway.display`, the screen model offers `human` first, and the app's chooser types it. Two catalogue rows: no display, and an adapter that cannot take a click.

**Validate:** `packages/cli/test/record-human.test.ts` — a scripted click binds the login page's submit button with provenance `human`/`pick` and the binding verifies; an element that is not there reads as an Escape, stops the session and writes nothing; the HTTP adapter is refused with its row; `personCanPick` is false under CI, without a terminal, and on Linux without a display; under CI with no gateway named the recorder still refuses and names `fake` and the credential. `packages/adapter-playwright/test/session.spec.ts` proves the `pick` claim beside the others; `packages/surface/test` holds the reference document and the method lists to the new method; `apps/desktop/test/review.test.ts` sees `human` offered and unavailable without a display. The record guide and the getting-started page now say what the code does.

## T14.9 `yam explore`, and the proposal on the front door (Draft 2.21)

**Status: done.** Commit `e92064e`.

`packages/cli/src/commands/explore.ts`: the MCP server `yam mcp` builds, served over stdio with the trajectory under `.yam/explore/<id>/`; on disconnect the trajectory is compiled and written under `proposals/<date>/`, the review notes and the directory printed; an empty exploration writes nothing and says so; `--trajectory <path.jsonl>` compiles an existing one. `projectState` gains `proposals`, `nextVerb` names the newest right after the read-error rule, and `yam` prints a `proposals` line. `explore` is in the top-level help and the `agents` topic. The self suite gains `front-door.an-exploration-becomes-a-proposal`: Yam's side drives the built `yam explore` through an MCP client against the sample application; the external side is `packages/cli/test/explore.test.ts`.

**Validate:** the explore test drives a two-call exploration in process and finds the proposal with the story name and the intents, nothing under `flows/`, and `yam` naming `review proposals/<date>`; an empty exploration writes nothing; `--trajectory` compiles a recorded trajectory into a proposal elsewhere; a missing trajectory is refused. `yam eval self --only front-door.an-exploration-becomes-a-proposal` at 100 percent. `yam help` still matches LLD §15.1, and the vocabulary check passes with the new entries.

## After the tasks: what the session found

Playing the newcomer's session by hand found two things the tests had not, fixed in `767dbae`, and a third fixed with the record:

- `yam heal` on a run that failed for want of a binding said "No locator failures. Nothing to repair." It now says the target has never been recorded, that there is nothing to relocalize from, and names `yam record`; exit 7. Judged by the store, and only for run failures — a plain Playwright project's bind failures keep their path.
- `yam heal`'s line for a never-recorded target showed the id twice, because the healer parsed the phrase only out of the old "Could not resolve" wording; it reads both now.
- `yam init`'s example flow ended on `The dashboard heading should be visible`, a phrase the fake gateway's 349 answers do not cover, so the very first recording a newcomer could make without a credential stopped one step short. The example ends on `The page title should contain "Dashboard"`, which needs no grounding, and the session above records and replays it whole.

### The owner's first use of the human gateway found two defects (Draft 2.21)

Both fixed in the commit that carries this section, and both are the kind a scripted pick cannot catch:

- **`yam record` opened the browser and did not wait.** The adapter handed the picker script to `page.evaluate` as a string; Playwright evaluates a string as an expression, which yields the function and never calls it, so the pick resolved at once as "nothing picked" and every target was skipped. The adapter now evaluates and calls it the way module (a) does, and `packages/adapter-playwright/test/session.spec.ts` proves the overlay waits until a real click lands and that a second pick finds no stale stamp.
- **In the app, Record did nothing and Stop could not be pressed.** The service opened the session headless, so the overlay waited in a browser nobody could see, and the session's stop signal never reached the wait. The service opens a headed session for `human`; `pick` takes an `AbortSignal`, which the recorder threads from the service's stop, so Stop ends the wait at once; and the recorder logs "waiting for your click on \`phrase\` in the browser" onto the stream while it waits.

## Deviations

- **D1 — the input hash beside the plan.** LLD §15.1 says `check` "records the input hash in the plan"; the plan schema is `.strict()` and the published contract (LLD §3.2), so the hash is `.yam/plan.inputs.json` beside it. Same effect, no schema change.
- **D2 — the cockpit captures.** T14.5's Validate asks that `pnpm ui:capture` write the committed captures unchanged. They contain a temporary path, a port and a relative time, so "unchanged" was never literally true, and they had been stale since the rename. They are re-recorded and committed with this phase.
- **D3 — `yam runs tail` follows step results, not audit lines.** §15.1 names "the audit lines of the current run"; the service's stream carries `step.result`, `run.started`, `run.summary`, `run.failed` and `log`, and no audit event. The pane shows those; the audit file is in the run directory as before.
- **D4 — the session ends with the cockpit.** §15.1 says the service lives "until the last pane exits"; tmux has no simple hook for that, so the cockpit's pane kills the session when the cockpit quits, and the shell and tail panes close with it. Said in the command's own line.

## Known gaps

**K1 — the row for a target with no binding at run is a reason line, not a `--json` diagnostic.** `yam run --json` prints the summary as before; the unbound target's sentence and verb are under the `✗` line and in the results file's failure, not as a `{ code, message, next }` object. The other nine rows have both forms.

**K2 — the desktop rows were not produced live.** The doctor's refusal and the missing-browser launch failure are produced from their own messages, not from a host without the grant or a machine without Chromium.

**K3 — the record's transcript is the fake gateway's.** With a credential the recorder grounds through a model; with neither, at a terminal, the human gateway of T14.8 now opens the browser for a click, and the session reads the same except for the gateway line and the overlay.

**K4 — the human gateway's click is proven by a real click in the adapter's suite** (the overlay waiting, then a Playwright click on the element) **and by a scripted pick everywhere else.** A person's own click was exercised by the owner, which is what found the invocation defect above.

**K5 — the desktop adapters cannot take a click yet.** `pick` is `false` on the UI Automation and Accessibility adapters; a person recording against a desktop application still needs a model gateway, and the catalogue row says so.
