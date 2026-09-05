# Phase 5 — progress and verification

Branch: `phase-5` (from `master` at `c8590a6`) · Date: 2026-09-04 · Scope: the
five Phase 4 corrections and T5.1 … T5.8 of [`../tasks.md`](../tasks.md). Phase 6
was not started.

## Summary

| Item | Title | Status | Commit |
|---|---|---|---|
| F1 | Heal replay takes the failing story's inputs | done | `4b3da30` |
| F2 | The compiler eval reads the golden project's committed config | done | `6e0e1e1` |
| F3 | BiDi attach to a driver-hosted session | done | `571e47a` |
| F4 | The grammar accepts the assertion aliases | done | `a2399df` |
| F5 | The verifier's results in `phase-4.md` | done (no code) | `171ecc7` |
| T5.1 | Resume from checkpoint | done | `b8aa53d` |
| T5.2 | Workflow runner and CLI | done | `c679ae5` |
| T5.3 | Tool server | done | `43aee3f` |
| T5.4 | Guard sentences and compensation end to end | done, **one deviation (D1)** | `292b1f8` |
| T5.5 | Trajectory compiler | done, **one deviation (D2)** | `0033655` |
| T5.7 | ADE record review, bindings and heal review | done | `f1ec2c5` |
| T5.8 | ADE surface explorer and tool panel | done | `31be705` |
| T5.6 | Behavior docs and examples | done | `7d6365e` |

The spec is untouched:
`git diff master..phase-5 -- docs/spec/{requirements,hld,lld,tasks}.md` is empty.

## The contract

Run in a **clean detached worktree of `phase-5`** (`/tmp/phase5-verify`), with
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `SVATAH_BASE_URL` unset.

```bash
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r test
```

| Command | Result |
|---|---|
| The contract, no credential | 31 packages built; **2,504 vitest + 239 Playwright Test = 2,743 passed, 0 failed**, exit 0 |
| `pnpm lint` (includes the LLD §1 import boundaries) | 0 errors |
| `pnpm check:licenses` | passes; the one named exception (`css-value@0.0.1`) stands |
| `pnpm examples` (T5.6) | 8 checks, every example runs |
| `git diff master..phase-5 -- docs/spec/*.md` (the four spec documents) | empty |
| `svatah eval compiler --tier2` from the checkout, Ollama serving `qwen2.5:3b` | tier0 3/3, tier1 181/181, **tier2 34/38 (89.5 %)**, overall **218/222 (97.9→98.2 %)** |
| `svatah eval healing` | relocalize-only **92.6 %** (50/54), threshold 60 %: met |
| `node scripts/bidi-independence.mjs` with a chromedriver | Firefox 153 16/16, 40/40 identical to Playwright, **and stock Chrome 152 attached: 16/16, 72 checks** |
| `node scripts/privacy-check.mjs` | compile, lint and run reached nothing beyond the machine |

## Environment, and which fallbacks applied

| | Available? | What that meant |
|---|---|---|
| Model credential | **No** — no `ANTHROPIC_API_KEY`, no `ANTHROPIC_AUTH_TOKEN`, no `ant` | The trajectory compiler (T5.5) needs no model at all and used none; grounding in the ADE's record review used **the fake gateway** (`evals/grounding/cases`), which the record report names. Tier 3 is still unmeasured |
| Local model server | **Yes** — Ollama on `127.0.0.1:11434` serving `qwen2.5:3b` at the pinned digest | The published Tier 2 number is a real measurement and reproduces from the checkout (F2) |
| chromedriver | **Yes** — 152.0.7977.82, matching the installed Chrome 152.0.7977.77 | F3's stock-Chrome attach was reproduced failing and then verified working, end to end through the conformance suite |
| Node 22 LTS | **No** — this machine has only Node v25.6.1 | The contract ran on **Node v25.6.1** only. Phase 4's verifier fetched Node 22 and got the same result; this phase has not repeated that. Recorded as **K1** |
| Android emulator | **No** | Nothing in Phase 5 touches Appium |
| Electron | **Yes** | The ADE builds and typechecks; its screens are driven through the service, not through Electron (see T5.7's note) |

---

## F1 — Heal replay takes the failing story's inputs

**Reproduced first.** On a copy of `evals/fixtures` with every candidate of
`bindings/app/schedule-build-link.yaml` corrupted, `simple.flow` run with its two
inputs, then healed:

```
svatah run . --host none --run-id broken \
  --input email=connected2atul@gmail.com --input password=qwerty123
svatah heal --run broken --base-url <app> --json
→ exit 7, "unreachable": "The replay did not reach the failing step."
```

**After.** The same commands, with the inputs given to the heal:

```
svatah heal --run broken --base-url <app> --apply \
  --input email=connected2atul@gmail.com --input password=qwerty123
→ exit 0, "repaired", score 1.000
```

and without them:

```
→ exit 7, "unreachable": "I want to validate login" needs the inputs "email",
  "password" to replay the 4 step(s) before I want to validate login#5, and they
  were not supplied. Pass --input email=… or set SVATAH_INPUT_EMAIL.
```

LLD §10 as amended, item by item:

| Amendment | Where |
|---|---|
| `heal --run` accepts `--input name=value` | `packages/bindings-cli/src/commands/heal.ts`, through `inputOptions` |
| … and reads `SVATAH_INPUT_<NAME>` | the same function, shared with `run` and `workflow run` so the three cannot drift |
| `summary.json` records input **names**, never values | `packages/runtime/src/run.ts`; `summarySchema.inputs` |
| An `unreachable` for want of an input names it | `packages/cli/src/replayer.ts`, checked against the signature *before* the replay |

Two things this needed that were not in the amendment and are consequences of it:

- **A replayed prefix does not owe the story's outputs.** `I want to validate
  login` declares `outputs: enterprise: string`, captured at its sixth step.
  Replaying the first four and then collecting outputs failed on a promise the
  prefix never made, and the healer read that as a failure to arrive.
- **`--input` is filtered to what the story declares**, as `run` filters
  run-level inputs. An input meant for another story would otherwise make the
  replay fail with `"X" has no input "y"` while healing something else.

**Validate.** `packages/cli/test/heal-cycle.test.ts` grew from 5 cases to 9: the
cycle for a story with a signature behind its login through `svatah heal` and
`svatah-bindings heal`, the same by `SVATAH_INPUT_<NAME>`, and the no-input case
asserting the message names both inputs and the environment variable. The
summary is asserted to hold the names and not the password.

## F2 — The compiler eval reads the golden project's committed config

**Reproduced first.** `svatah eval compiler --tier2` on a clean checkout scored
`tier2 0/41` and printed "Below REQ-COMP-9's thresholds": the eval read
`compile.tier2` from the config at `--project` (default `.`), the repository root
has none, and `evals/compiler/project/` had none either.

**After.** `evals/compiler/project/svatah.config.yaml` is committed, pinning
`qwen2.5:3b` and the digest
`357c53fb659c5076de1d65ccb0b397446227b71a42be9d1603d46168015c9e4b`. The eval
reads the golden project's config; `--project` overrides it.

```
svatah eval compiler --tier2 --report reports/eval-compiler.md
→ tier0 3/3, tier1 181/181, tier2 34/38 (89.5 %), overall 218/222 (98.2 %)
   Meets REQ-COMP-9.
```

A requested-but-unconfigured tier is `not measured`: its entries are **not
compiled at all**, it is absent from `byTier` and from `totals`, and the report
says so in the per-tier table and in a "Not measured" section. Never `0/N`. A
configured tier whose server is unreachable is unchanged — that is a measurement
that went wrong, and hiding it would be the opposite of the fix.

One further arithmetic fix the reproduction exposed: an empty measurement is no
longer "below threshold". `0/0 = 0` is below 95 percent and about nothing at all,
and that arithmetic is how a clean checkout exited non-zero while measuring
nothing.

**Validate.** `packages/cli/test/eval-compiler.test.ts` gained four cases: the
config is committed with the model and the digest; the eval reads it rather than
the working directory; `--project <empty dir>` reports tier 2 as `not measured`
with `totals.total === 0` and exit 0; and the published report never renders
`0 (0.0%)` for an unmeasured tier.

## F3 — BiDi attach to a driver-hosted session

**Reproduced first.** chromedriver 152 started with the `webSocketUrl`
capability, `SVATAH_BIDI_URL=ws://127.0.0.1:9515/session/<id>` — the README's own
commands:

```
FAILED: session not created: session not created: session already exists
```

**After.** The adapter tells the two attach shapes apart by one path segment
(`isDriverHostedSession`), does not send `session.new` at a session that already
exists, learns the browser from `session.status`, and does not end a session it
did not create — the classic session belongs to whoever made it through the
driver.

```
OPENED OK. state: {"kind":"web","url":"about:blank",…}
```

and through the conformance suite:

```
node scripts/bidi-independence.mjs --report reports/adapter-bidi.md
→ driving: firefox 153.0 (launched)
  surface conformance: 16 passed, 0 failed, 0 skipped (72 checks)
  determinism (REQ-RUN-2): two BiDi runs agree over 40 steps
  runtime conformance (REQ-STD-2): 40 steps compared, 0 difference(s)
  stock-browser attach: chrome 152.0.7977.77 through chromedriver, over a
    driver-hosted session (…/session/<id>)
    surface conformance over the attached session: 16 passed, 0 failed,
    0 skipped (72 checks)
```

`reports/adapter-bidi.md` records both browsers. The driver's *name* and the
URL's *shape* are recorded, not its path or its ephemeral port — a committed
report must not say whose machine ran it (LLD §16).

**Both attach shapes are tested against recorded exchanges.**
`packages/adapter-bidi/test/exchanges/{chromedriver-attach,firefox-server}.json`
are what chromedriver 152 and Firefox 153's remote agent actually answered,
captured through `BidiClient`'s traffic hook — *including chromedriver's refusal
of `session.new`*, so the test would fail rather than pass vacuously if the
message came back. The independence script runs the attach whenever a
chromedriver or msedgedriver is on `PATH` or named by `SVATAH_CHROMEDRIVER`.

One thing the reproduction found in the script rather than the adapter:
chromedriver prints "Starting ChromeDriver …" *before* it binds, so a readiness
check that matched the log raced the listener and every request came back `fetch
failed`. It polls `GET /status` instead.

## F4 — The grammar accepts the assertion aliases

**Reproduced first.** `Expect the sign in button to be visible`,
`Expect the page title to contain "Svatah"`, `Expect the URL to contain "/"` and
`Verify the sign in button is visible` all failed with `E_NO_MATCH`.

**After.** Three surfaces, one IR:

```
The sign in button should be visible        canonical
Expect the sign in button to be visible     infinitive
Verify the sign in button is visible        third person
```

The prefix verbs are `Verify`, `Check that`, `Assert that`, `Ensure`,
`Make sure` and `Confirm`, each optionally followed by `that`, over target,
page-title and URL subjects. The infinitive family reuses the existing
`TargetPredicate` table unchanged — `Expect … to …` is followed by exactly the
infinitive the `should` forms take — and the third-person family has its own
(`says` not `say`, `has` not `have`).

Two collisions, both resolved by the word LLD §4.2 already writes:

- `Check the remember me box` is pattern 17 and ticks a checkbox. `Check` is the
  one alias verb that **requires** its `that`, and pattern 17 refuses
  `Check that`.
- `Confirm the alert` is pattern 21. With no predicate after the target the
  alternative fails and the sentence falls through unchanged (golden `g-183`).

**Golden entries for every alias.** 30 added, each carrying the *canonical*
entry's `step` — so the set asserts the property (the surface leaves no trace in
the IR) rather than restating it. Three entries moved from tier 2 to tier 1:
`g-186`, `g-187` and `g-188` are sentences the grammar now answers, and a
`tier: 2` entry that never reaches the model is a Tier 1 measurement wearing the
wrong label. The set is 222 entries: 181 tier 1, 3 tier 0, 38 tier 2.

**Tier 1 stays 100 percent**: 181/181.

One limitation, documented in `docs/flow-language.md` with the sentence it
refuses: the target phrase ends at the first `to` (infinitive) or at the first
third-person verb, matched as a whole word — exactly as it ends at the first
`should`. `Expect the go to dashboard link to be visible` therefore does not
compile; `The go to dashboard link should be visible` does.

## F5 — The verifier's results in `phase-4.md`

`docs/spec/progress/phase-4.md` gained a "Post-verification corrections" section
with the verifier's per-parameter scores, what was confirmed, the four defects
and where each is fixed, and a table of what the corrections change about the
published numbers. Three claims in the body were also too generous and are
corrected in place: **K3** ("implemented and unit-tested" for a route that failed
on its first message), **T4.4** (the Tier 2 configuration described as a
documentation matter rather than a missing repository file), and **K4** (the
corpus size).

---

## T5.1 — Resume from checkpoint

**Do:** `--resume --from`: checkpoint load, hash verification, scope and session
restore.

`--from` names the step to **start at**, not the checkpoint to load. A checkpoint
is written *after* a step completes, so the one describing the state `--from`
begins in is the one before it — found by walking the flow's steps backwards and
taking the first that has a checkpoint file. Not simply "the previous step": a
run stopped by `stop` leaves the steps after the failure `skipped` with no
checkpoint, and a killed run leaves none for the step it was in. Both are the
ordinary shape of an interruption.

A resumed run does one flow — the checkpoint's — starting at the checkpoint's
story, and skips the steps before `--from` rather than recording them as
`skipped`: a resumed run's `results.jsonl` holds what *this* run did.

Three things this needed that were missing:

- **`Scope.restore` took the story whose inputs it is restoring.** It had been
  reading `Checkpoint.scope.inputs` as a map of stories, which is not the shape
  LLD §3.4 gives it, and silently restored nothing.
- **`summary.json` and every checkpoint now carry the real bindings hash.** It
  was `"none"`, which would have made the bindings check pass for every store.
- **A checkpoint's scope is redacted** (REQ-NFR-6). It held `secret`-typed input
  values in plain text, and `runs/<id>/checkpoints/*.json` is a file people
  attach to bug reports. As with `heal --run`, the caller supplies the secret
  again on resume: run-level `--input` is merged over the restored scope.

**Validate — "interrupt a fixture run at step 5, resume, results equal a full run
from step 5 onward".**

```
svatah run . --host none --run-id full --input email=… --input password=…
→ exit 0, 7 steps
svatah run . --host none --run-id resumed --resume full --from "…#5" --input …
→ exit 0
```

`results(resumed)` equals `results(full).slice(4)` on story, step id, text,
status, matched candidate kind and captured value.

**Validate — "hash mismatch exits 12".** A flow with one step inserted:

```
→ exit 12: The plan has changed since run "full" was checkpointed, so its step
  ids and their meaning cannot be trusted. … (checkpoint 5368eedb28ce…, now
  78008629cf66…)
```

A changed binding exits 12 with its own message; neither leaves a run directory
behind. A refused resume is a mistake at the command line, not a failed test, and
exit 1 would send CI to look at the wrong thing.

**Tests.** `packages/cli/test/resume.test.ts` (7 cases, against the sample
application) and `packages/runtime/test/resume.test.ts` (12 unit cases for
choosing the checkpoint and refusing a stale one).

## T5.2 — Workflow runner and CLI

**Do:** `runWorkflow`, `workflow run` with `--input`, outputs as JSON,
environment policy enforcement.

The workflow behavior is a *configuration* of the executor rather than a second
one: one story, `behavior: "workflow"`, checkpoints and audit forced on. That is
what makes REQ-BEH-5 true rather than aspirational — a second runner would be a
second set of semantics for guards, policies and captures.

What the behavior owns: the environment policy (REQ-AUTO-7), the forced
checkpoints and audit (LLD §13.2), and returning outputs as a value,
un-namespaced.

**Validate — "a story with a signature runs as a function and returns typed
outputs".**

```
svatah workflow run "Book a slot" . --input location=Indiranagar
→ {"booking":"Slot booked.","place":"Indiranagar"}   exit 0
```

stdout is *only* the outputs, so the command composes with `jq`; progress and the
run summary go to stderr. `summary.json` says `behavior: "workflow"`, the
checkpoint directory is non-empty and the audit exists, even though the fixture
project sets `checkpoints: false`.

**Validate — "a non-idempotent story is refused in `production` without the
override".**

```
# environment: production
svatah workflow run "Pay for a slot" . --input card=…
→ exit 10: "Pay for a slot" is not marked `idempotent` and this project's
  environment is `production`, so running it as a workflow is refused
  (REQ-AUTO-7). … Either mark the story `story (idempotent=true): …`, or pass
  --allow-side-effects to say you meant it.

svatah workflow run "Book a slot" . --input location=…          → exit 0 (idempotent)
svatah workflow run "Pay for a slot" . --allow-side-effects …   → exit 0
```

Nothing runs on a refusal: no `runs/<id>/results.jsonl` is written.

**One defect found by the fixture and fixed here.** A secret an output carries
reached `summary.json` (REQ-NFR-6). `Pay for a slot` declares `card: secret` and
reads it back off the form; the caller who supplied it may have it back on
stdout, and the file in the run directory may not. `run()` now keeps two copies —
the value it returns and a redacted one for the summary — the split
`StepResult.captured` already had.

**Fixtures.** `evals/fixtures/flows/booking-workflow.flow` adds two signed
stories, `Book a slot` (idempotent) and `Pay for a slot` (not). The flow has no
run block, so `svatah run` runs nothing from it: a `story` outside a run block is
a function waiting to be called (REQ-LANG-10).

**Tests.** `packages/cli/test/workflow.test.ts` (10) and
`packages/workflow/test/policy.test.ts` (6).

## T5.3 — Tool server

**Do:** `tool serve`: tools from signatures; invoker identity from the MCP client;
audit per call; `requireIdempotent`; no gateway import.

Each tool *is* a story. Its `inputSchema` is derived from the signature rather
than written beside it, so an input with a default is optional in both the schema
an agent reads and the validation the runtime performs — one declaration, no
second place to disagree.

REQ-AUTO-8 is applied at **expose** time, not at call time: a story that is not
marked `idempotent` is *not listed* when `tool.requireIdempotent` is on (default
in `production`). An agent that can see a tool will eventually call it, and an
agent retries. Also refused: a story with no signature, and two stories that
would collapse to one tool name.

**Validate — "an MCP client calls a recorded story with inputs and receives
outputs and a `runId`".** A real client over the SDK's in-memory transport:

```
listTools → ["book_a_slot"], required: ["location"], properties: date, location
callTool  → {"runId":"…","outputs":{"booking":"Slot booked.","place":"Indiranagar"},
             "status":"passed","exitCode":0}
```

and `runs/<runId>/results.jsonl` exists.

**Validate — "`audit.jsonl` shows the agent invoker and redacted inputs".**

```
summary.invoker → { kind: "agent", id: "an-agent", via: "mcp" }
summary.behavior → "tool"
audit.jsonl      → a `run` line whose invoker is the agent, and `surface` lines
```

For `Pay for a slot` with `card: secret`, the card number is in **none** of
`audit.jsonl`, `results.jsonl` or `summary.json`, and *is* in the value returned
to the agent that supplied it.

**Validate — "the model endpoint blocked during the test".** Two cases run the
whole thing under `scripts/block-external-network.mjs`, which refuses every
connection that is not to this machine: the tool derivation and a story run as a
tool both succeed. That is the no-model claim as a fact about bytes rather than
about imports; the import boundary (`tool ─► workflow, schema`) is the structural
half and the lint still passes.

**Two defects found by the fixture and fixed here.**

- **A secret input reached `audit.jsonl` on the first line.** The run-level audit
  line records the inputs and is written before the first story starts, so
  `validateInputs` had not yet noted the `secret`-typed ones. The executor now
  notes them up front, from the signatures of the stories about to run — the same
  thing it already did for `data.yaml`'s `secrets:` list. It had worked in the
  workflow test only by coincidence, because the same value was also a declared
  data secret.
- **`runWorkflow` hard-coded `behavior: "workflow"`,** so a tool call recorded
  itself as a workflow.

**Tests.** `packages/cli/test/tool-server.test.ts` (10) and
`packages/tool/test/tools.test.ts` (14).

## T5.4 — Guard sentences and compensation end to end

**Do:** wire guard grammar to executor guard evaluation including `expr`
predicates over scope; `compensate:<story>` on the sample app with a "Cancel
booking" story.

**The sample application gained the control the fixtures named.**
`apps/sample-web`'s `/booking` page — the page the sidebar's Bookings link
already pointed at — now has a bookings section: a booking reference, a status,
and a **Cancel booking** button. `evals/fixtures/flows/booking-compensation.flow`
had named a button the application did not have.

**Validate — "a guarded step never acts when its guard is false (audit shows no
surface call)".** `evals/fixtures/flows/guards-and-compensation.flow` exercises
all three guard subjects — page, scope and the step's own element — because they
take three different paths through the executor.

```
svatah run . --story "I want to see guards decide"
  passed   Click the Book a slot link
  passed   Remember the text of the booking status as status
  passed   Type "Indiranagar" into the location field        (page guard, true)
  skipped  Click the cancel booking button                   (scope guard, false)
  skipped  Click the cancel booking button                   (Unless, false)
  passed   Click the Book now button                         (target guard, true)
  passed   The booking result should say "Slot booked."

surface calls attributed to a skipped step: 0
surface calls mentioning "cancel" anywhere in the run: 0
```

Both skipped steps carry **no failure**, which is what a clean guard skip is
(LLD §8.3).

**Validate — "a failed booking triggers cancel and the run is `aborted` with the
policy recorded".**

```
svatah run . --story "I want to book and then fail"                     → exit 11
  passed   Click the Book a slot link
  passed   Type "Indiranagar" into the location field
  passed   Click the Book now button
  passed   Remember the text of the booking reference as reference
  failed   Click the pay button      policyApplied {"compensate":"cancel a booking"}
  aborted  cancel a booking · Click the cancel booking button
  aborted  cancel a booking · The booking reference should say {…reference}

summary.flows[…].status = "aborted"
audit.jsonl → one `policy` line: {"policy":{"compensate":"cancel a booking"}}
```

The compensating story's last step asserts against
`{I want to book and then fail.reference}` and passes — which is the proof it ran
with the failing story's scope, and the whole point of REQ-AUTO-4.

**Two defects fixed here.**

- **The audit attributed a surface call to the wrong step.** The position was
  derived from the last *result*, so each step's calls were labelled with the
  previous step's id — which made this task's own Validate item unanswerable,
  because the calls attributed to a guarded step were the next step's. `runStory`
  now reports each step before it runs, and the nested runs (`invoke`, a
  compensating story) move the position too.
- **`W_UNUSED_CAPTURE` fired on a capture only another story reads.** It is
  decided one story at a time and a cross-story read is in a different story by
  construction, so it fired on exactly the pattern REQ-AUTO-4 asks people to
  write.

**A `target` guard must name the element its step acts on.** See **D1**.

**The healing eval was re-run**, because the new button is an interactive element
the eval records a binding for:

| | Before | After |
|---|---|---|
| Bindings recorded at variant 0 | 106 | **107** |
| Degraded (the headline population) | 52 | **54** |
| Recovered | 48 | **50** |
| **Relocalize-only, `no-test-ids`** | **92.3 %** | **92.6 %** |
| `with-test-ids` | 78.9 % (15/19) | 78.9 % (15/19) |

`reports/eval-healing.md` regenerated. The threshold (REQ-HEAL-5's 60 %) is met
in both populations.

**Tests.** `packages/cli/test/guards-compensation.test.ts` (7) and four more in
`packages/compiler/test/compile.test.ts`.

## T5.5 — Trajectory compiler

**Do:** group by intent, map calls to IR, sentence normalisation, ids from
`describe`, synthesis at capture, proposals output, `// review:` for uncompilable
steps.

**The sentences come from what the calls did, not from what the agent said.** The
intent is "go to the sign-in page"; the call is
`act("click", <the Sign in link>)`. Only the second is a fact about the
application. The literal reading of "the intent becomes the sentence" gives
`Go to "the sign-in page"` — a navigation to a URL that does not exist, from a
call that was a click. Plausible and wrong is worse than `// review:`. So the
verb comes from the action (the vocabulary's canonical word, whichever synonym
the agent reached for), the noun phrase from `describe`, and the intent is kept
verbatim as a comment above each step.

A `snapshot` is not a step: an agent taking one is *looking*, and a replay does
not need to be told to look.

**Validate — "the trajectory from T4.6 compiles to a proposal whose Tier 1
compile succeeds for at least 80 percent of steps".** The same six-call
exploration, driven again through a real MCP client against the sample
application:

```
// Proposed from a trajectory (REQ-BEH-4, LLD §13.4). Not reviewed, not run.
//
// 4 of 4 step(s) compile; the rest are `// review:` comments carrying what the
// agent said it was doing. The bindings beside this file are `verified: false`.

story: Go to the sign-in page
  // go to the sign-in page
  Click the Sign in link
  // type the enterprise user's email into the username field
  Type "connected2atul@gmail.com" into the Username field
  // check what the username field now holds
  Remember the value of the Username field as usernameFieldValue
  // confirm the sign-in button is ready
  The Sign In button should be visible

test: Go to the sign-in page
```

**4 of 4 (100 %)**, against the 80 % threshold. Four steps from six calls,
because the two snapshots are not steps.

**Validate — "nothing written outside `proposals/`".** The project tree is walked
before and after: every added path starts with `proposals/`, `writeProposal` is
handed the proposals directory rather than a project root so there is no path by
which it could reach `flows/` or `bindings/`, and the flow store is
byte-identical afterwards.

Every binding is `verified: false` with candidates and fingerprints from the
`describe()` captured at the moment of the call. No model anywhere; the
provenance says `none:trajectory-compile`. The compile is a pure function of the
trajectory, so two compiles are the same bytes and a proposal reviews as a diff.

**Two additions the compile needed.**

- **A trajectory line records the URL** it was made on. LLD §13.4 lists the line
  as `{ seq, intent, call, snapshotHash, ref, describe }`; a binding entry is
  keyed by a *context*, which is a URL pattern plus a structural hash, and
  without the URL the compiler would have to invent the pattern. Optional, so an
  older trajectory and a non-web adapter still read. The context hash is the
  page's `snapshotHash` rather than LLD §6.2's landmark-subtree hash, which needs
  a live snapshot a proposal does not have — a broader key that drifts sooner,
  replaced by the first `svatah record` after the proposal is applied. Another
  reason these are `verified: false`.
- **`svatah trajectory compile`**, which LLD §15 does not list. See **D2**.

**Tests.** `packages/cli/test/trajectory-compile.test.ts` (9, including the CLI)
and `packages/trajectory/test/compile.test.ts` (15).

## T5.7 — ADE record review, bindings and heal review

**Do:** record screen with `record.decision` / `record.candidates`, accept,
reject or re-pick through `/surface/:session/snapshot`; bindings browser with
context entries and dry-resolve status; heal review with a before-and-after diff
and apply.

**The review happens before the binding is written.**
`RecordSessionOptions.review` is called once per grounding, *before* `store.put`.
The service turns each call into `record.decision` — carrying the snapshot
excerpt, the chosen reference, the candidate bundle and the fingerprint — plus
`record.candidates`, and **blocks the session** until
`POST /record/{id}/decision` answers. A hook that ran afterwards would be showing
a person a decision already made, and "reject" would mean "undo".
`svatah record` passes no reviewer and behaves exactly as it did.

**Validate — "author a three-step story, record against the sample web app,
reject one grounding and re-pick, and confirm the written binding matches the
pick".**

```
POST /record → { sessionId }
  ← record.decision  proposal.snapshot contains "[ref=", decision.ref is a ref,
                     entry.candidates ≥ 1, entry.fingerprint.tag is set
  ← record.candidates
  bindings/ is EMPTY at this point — the session is blocked
POST /surface/<session>/snapshot   (the "Re-pick" button's call)
POST /record/<session>/decision { repick: <the Docs link's ref> }
  ← record.finished

bindings/home/sign-in-button.yaml  contains  data-testid "docs-link"
                                   contains  provenance model: "human"
                                   does NOT contain  value: "sign-in"
```

The re-picked entry is re-synthesised by `entryFor`, the same path a grounded one
takes: same candidate ranking, same fingerprint, same context hash. A
hand-written locator would put something in the store nothing else in this
project knows how to produce.

**Validate — "a healed variant shows a proposal that applies and re-runs
green".**

```
break every candidate of home/sign-in-button → POST /run → exit 1
POST /heal { runId, apply: false }
  ← heal.proposal  outcome "repaired"
                   before  contains "-GONE"
                   after   does NOT contain "-GONE"
  the file on disk still contains "-GONE" — nothing was applied
POST /heal { runId, apply: true }   → the file no longer contains "-GONE"
POST /run                            → summary.exitCode = 0
```

The *after* comes from the report rather than from the directory: with
`apply: false` nothing is written, so re-reading the file would show a reviewer
the same thing twice. `HealReport` gains `changed` — the files the job would
write, keyed by element id — which is the shape a table wants where a unified
diff is the shape `git apply` wants.

**The bindings browser** dry-resolves through `POST /bindings/verify`, which
opens a session and asks the resolver a run would use. A green status means a run
would find it, rather than that the file parses.

**Nine functions are injected into the service rather than four**
(`packages/cli/src/service-api.ts`), which is LLD §13.5's rule applied to five
more capabilities: an ADE that recorded through its own code would be doing
something a person cannot, and the store is where they would disagree. The event
union, the OpenAPI document (35 paths) and the generated ADE client all follow.

**The screen rule still holds.** `apps/ade/test/screen-rule.test.ts` reads the
renderer's sources: every call is a method the generated client has, every
rendered value names the endpoint it came from, and no screen contains a bare
`fetch`. The four new screens pass it, and the required-endpoint list grew by
twelve.

**Tests.** `apps/ade/test/review.test.ts`, 5 cases for T5.7, driving the client
the screens drive against a service wired exactly as `svatah serve` wires one.

## T5.8 — ADE surface explorer and tool panel

**Do:** surface explorer with a required `intent` per call, producing
`trajectory.jsonl` and offering "compile to proposal"; tool panel showing
invocations with their audit lines.

**Validate — "a six-step exploration compiles to a proposal in `proposals/`".**

```
POST /surface/explorer/open      → { trajectory: "runs/explorer/trajectory.jsonl" }
POST /surface/explorer/snapshot  intent "see what is on the home page"
POST /surface/explorer/act       intent "go to the sign-in page"
POST /surface/explorer/snapshot  intent "see the sign-in form"
POST /surface/explorer/act       intent "type the enterprise user's email …"
POST /surface/explorer/read      intent "check what the username field now holds"
                                 → { value: "connected2atul@gmail.com" }
POST /surface/explorer/check     intent "confirm the sign-in button is ready"
POST /trajectory/compile         → steps 4/4 (100 %), flow contains
                                   "Click the Sign in link"
```

Every file written is under `proposals/`, and the project directory gains exactly
one entry.

**Validate — the intent is required.** `POST /surface/{session}/act` without one
is a 400 naming it. An exploration whose calls do not say what they were for is a
log rather than something that can become a deterministic tool; the screen
disables the buttons, which is the same rule said earlier.

**Validate — "an MCP client invocation appears in the tool panel with its audit
record".**

```
GET /tools → { tools: […], invocations: [ { runId, invoker, audit } ] }
  invoker → { kind: "agent", id: "an-agent", via: "mcp" }
  audit   → includes `surface` lines
```

Invocations are read from the **run directories** — a tool call is a run with
`behavior: "tool"` — rather than from a register the service keeps, so the panel
shows what a `svatah tool serve` in another terminal served too (REQ-ADE-2).

The panel also lists the stories it **refuses** and why, because the refusals are
the interesting half: REQ-AUTO-8 keeps a non-idempotent story out of an agent's
reach, and an operator who cannot see why one is missing will conclude the tool
server is broken.

The panel shows the `svatah tool serve --expose "…"` command rather than spawning
it. An MCP server speaks over stdio to the client that launched it; a server the
ADE spawned would have the ADE as its client and no way to hand the pipe to
anyone else.

**Tests.** 3 more cases in `apps/ade/test/review.test.ts`.

## T5.6 — Behavior docs and examples

**Do:** `examples/` for CI, cron and an MCP-driven agent invoking a tool; docs
stating that orchestration is external.

- **`docs/behaviors.md`** — one plan, three ways to run it, what each behavior
  owns that the others do not, and the section this task exists for: the exit
  code is the contract, the run directory is the record, the project directory is
  the only source of truth, and a scheduler would be a second product with its
  own failure modes.
- **`examples/ci/`** — a GitHub Actions job and the GitLab equivalent, so the
  shape is visible rather than implied. Both check the committed plan against a
  fresh `--stable` compile, keep `runs/` whatever happened, and *propose* repairs
  on failure rather than applying them.
- **`examples/cron/book.sh`** — the fifteen lines between `crontab` and a
  story-as-a-function, with secrets through `SVATAH_INPUT_<NAME>` and a `case`
  over the exit codes.
- **`examples/mcp-agent/call-a-tool.mjs`** — a complete MCP client in sixty
  lines.

**Validate — "examples run in CI where feasible".** `pnpm examples`
(`scripts/examples-check.mjs`) runs the two runnable examples against the sample
application and parses the two CI workflow files, checking they name the commands
the README says they do. It runs on Ubuntu in both CI files.

```
ok   examples/ci/github-actions.yml parses
ok   examples/ci/github-actions.yml runs `svatah compile --stable`
ok   examples/ci/github-actions.yml runs `svatah run --host playwright`
ok   examples/ci/gitlab-ci.yml parses  (…and the same two)
ok   examples/cron/book.sh books a slot and prints the output
ok   examples/mcp-agent calls a story as a tool over MCP

Every example runs.
```

**Validate — "docs linked from README".** The README's Documentation section now
lists Behaviors first, plus the examples and the four existing guides.

**One defect found by running the example.** `svatah tool serve` sat on a promise
that never settled after the client closed the pipe, so every agent that finished
with a tool server saw Node's "unsettled top-level await" on stderr. It waits on
stdin closing, which is what the end of an MCP stdio session actually is.

---

## Deviations

Working rule 2: "if the spec cannot be followed as written, implement the closest
faithful option and record it under Deviations with the section reference and
reason. Do not edit the spec."

### D1 — A `target` guard must name the element its step acts on (LLD §3.2, §4.2 pattern 28)

**What the spec says.** `docs/flow-language.md` pattern 28 documents
`Only if the login error is hidden, click the sign in button` and shows it
compiling to `guard: { subject: "target", predicate: { kind: "hidden" } }`.

**Why it cannot be followed as written.** The IR's guard carries a subject, a
predicate and a mode, and **no target of its own** (LLD §3.2). `runStep`
resolves `step.target` to answer a `target` guard. So the documented sentence
compiled to a guard asking whether *the sign in button* was hidden, with "the
login error" discarded — a different question wearing the same shape, and
nothing anywhere said so. The IR cannot express the sentence, and adding a
target to the guard would be a spec change.

**What was implemented.** The compiler refuses it: `E_GUARD_OTHER_TARGET`, naming
both phrases and suggesting the two spellings that do work. A `target` guard on a
step with no element is `E_GUARD_NO_TARGET`. Both spellings of a guard are
checked — the one-line prefix the grammar attaches and the standalone line the
reader hands over — because a rule that held for one would be worse than no rule.
HLD principle 7: fail at authoring, not at replay.

**What changed as a consequence.** `docs/flow-language.md`'s pattern 28 examples
now guard on the step's own element, with a note giving the workaround (read the
other element first, then use a scope guard), and the diagnostic table gains both
codes. Golden entries `g-123` and `g-124` were rewritten for the same reason.

**What a reviewer should decide.** Whether `Step.guard` should gain a `target`,
which would make the documented form expressible. That is a Draft 2.7 question,
not a Phase 5 one.

### D2 — `svatah trajectory compile` is not in LLD §15's command table

**What the spec says.** LLD §15 lists the CLI's commands and does not include
`trajectory`. LLD §13.4 specifies the compile and says the proposals go to
`proposals/<date>/`, without naming the command that produces them.

**Why it cannot be followed as written.** Phase 4 wrote trajectories from
`svatah mcp` and nothing read them. T5.5's Validate requires the compile to be
demonstrated, and T5.8's ADE needs a "compile to proposal" button — which under
LLD §13.5's rule ("every handler calls the same functions the CLI calls") has to
call a function a command line also calls. A compiler with no way to invoke it
would satisfy neither.

**What was implemented.**
`svatah trajectory compile <trajectory.jsonl> [dir] [--name] [--out] [--app]
[--json]`, which is the same `compileTrajectory` + `writeProposal` the service's
`POST /trajectory/compile` calls. It writes only under `proposals/`.

**What a reviewer should decide.** Whether LLD §15's table should list it, or
whether it belongs under `svatah mcp` as a subcommand. Either is a one-line
change; the function is the same.

### D3 — The trajectory line records the URL (LLD §13.4)

LLD §13.4 gives the line as `{ seq, intent, call, snapshotHash, ref, describe }`.
The implementation has carried `at`, `args`, `result` and `error` since T4.6
(Phase 4's verifier confirmed them), and T5.5 adds `url`.

A binding entry is keyed by a *context*, which is a URL pattern plus a structural
hash (LLD §3.3, §6.2). The hash was there; without the URL the compiler would
have to invent the pattern, and a proposal's bindings would be addressed to a
page nobody could name. Optional, so an older trajectory and a non-web adapter
still read and still compile.

### D4 — A proposal's context hash is the page's, not the element's

LLD §6.2 defines a context hash over the nearest landmark ancestor's subtree, and
computing one needs a live snapshot. A proposal has none — the exploration is
over. The trajectory does have the hash of the whole page as it was, which is a
real recorded fact rather than an invented one, and that is what a proposal's
binding carries. It is a broader key than a recorded binding's, so it drifts
sooner; the first `svatah record` after the proposal is applied replaces it with
the narrow one. Another reason these entries are `verified: false`.

### D5 — The tool panel shows the `tool serve` command rather than spawning it

REQ-ADE-8 says "a tool panel that exposes stories over MCP **from the ADE**". An
MCP server over stdio speaks to the process that launched it; a server the ADE
spawned would have the ADE as its client and no way to hand the pipe to an agent.
What the panel does instead is the part that is useful and possible: decide what
to expose (with the refusals and their reasons), show the exact command, and list
every invocation with its audit record — read from the run directories, so a
server started anywhere appears.

### D6 — The ADE's screens are verified through the client, not through Electron

Carried forward from Phase 3's D-list and restated because Phase 5 adds four
screens. `apps/ade/test/review.test.ts` drives *the client the screens drive*
against a real service; `apps/ade/test/screen-rule.test.ts` proves statically
that a screen can reach nothing else. An Electron test would be testing Electron,
and the properties T5.7 and T5.8 claim are about the service boundary.

### D7 — `heal()` returns the files it would write

`HealReport` gains `changed`. REQ-HEAL-2 says a repair is "a diff to the bindings
store plus a report", and the unified diff is the right artifact for `git apply`
and the wrong one for a table. A heal review comparing candidate kinds wants the
two objects. It exists whether or not `apply` wrote them — which is what makes a
*proposal* reviewable.

---

## Known gaps

### K1 — Node 22 has not been exercised on this branch

The contract ran on **Node v25.6.1** only: this machine has no Node 22 and the
homebrew `node@22` formula is a symlink to 25. Phase 4's verifier fetched Node 22
and got an identical result on the same suite, and nothing in Phase 5 uses an API
that differs between them — but that is an argument, not a measurement.
REQ-NFR-7 names Node 22 LTS, and CI runs it on all three platforms.

### K2 — Tier 3 has still never called a model

Unchanged from Phase 4. No credential on this machine. `svatah eval compiler`
reports it as `not measured` rather than as zero, which is F2's fix working.

### K3 — The golden set holds 222 pairs, not 300

REQ-COMP-9 asks for at least 300 before release: 181 tier 1, 3 tier 0, 38 tier 2.
P4-F4 added 30. Growing it is release work and is recorded in
`evals/compiler/README.md`.

### K4 — Resume does not restore an unsubmitted form

Session restore for a web adapter is "URL and storage state" (LLD §8.1), which is
what `surface.restore` does. A run resumed at a step that reads a form field
someone typed into before the interruption reads an empty field. That is a real
property of resume rather than a defect here, and
`packages/cli/test/workflow.test.ts` asserts it explicitly so it stays visible
rather than being discovered. A storage-state or form-state capture in the
checkpoint would close it and is not in the spec.

### K5 — The trajectory compiler has no vocabulary-driven paraphrase

LLD §13.4 says "the intent becomes the sentence after normalisation through the
synonym vocabulary". What is implemented normalises the **verb** — the sentence
uses the canonical word for the action the call performed — and takes the noun
phrase from `describe`, keeping the intent as a comment. The literal reading is
implemented nowhere and is argued against in the T5.5 section: it produces
sentences that are plausible and wrong. A compiler that *also* tried the intent
as a sentence and preferred it when it compiled to the same action would be a
strict improvement and is not built.

### K6 — The record review has been driven by a test, not by a person

REQ-ADE-4's Validate is written as a demo. What exists is
`apps/ade/test/review.test.ts` driving the same client the screen drives, through
the same service, against a real browser — every assertion the demo would make,
made mechanically. Nobody has clicked the buttons. The screens are small and the
screen rule proves they can reach nothing but the client, but that is an argument
about the code rather than a use of it.

### K7 — `record.decision` blocks the session with no timeout

A recording session waits indefinitely for `POST /record/{id}/decision`. That is
right for a reviewer who stepped away and wrong for a client that crashed:
`POST /record/{id}/stop` is the way out and a person has to know to use it. A
deadline after which the session rejects and stops would be better and is not
built.

### K8 — One recording session per service

`POST /record` answers 409 while one is open. A single-project local service with
one browser is the shape the ADE has, and two concurrent recordings against one
project would race on the store — but the refusal is a limit rather than a
design, and it is stated in the OpenAPI document.

### K9 — Four fixture steps still cannot pass against the sample application

Unchanged from Phase 2's K8. `I want to validate text` in `simple.flow` fails at
its first step because the story assumes a signed-in session it does not create.
It is why `packages/cli/test/resume.test.ts` uses a one-story flow.

### K10 — The desktop adapters are absent

`adapter-uia` and `adapter-ax` are Phase 6 (T6.1, T6.2) and remain skeletons. The
ADE is their conformance target and now has eleven screens rather than seven,
which is more surface for them to be validated against.
