# Phase 12 — Release 0.1.0 and the open P0 items

Implementer: this session · Branch `phase-12` from `master` at `e6e1dee` · Host: macOS 15 (Darwin 25.3.0), arm64, Node v25.6.1 and v22.x, pnpm 10.30.2

Spec: Draft 2.15, at the commit this branch was made from. No spec document is
edited on this branch: `git diff e6e1dee..phase-12 --
docs/spec/{requirements,hld,lld,tasks}.md` is **empty**. `master` has since
gained one docs-only commit — see Deviations, D9.

## Environment, and which fallback applied

| Thing | This host |
|---|---|
| Accessibility permission | **granted** to the terminal running Svatah — `svatah surface doctor --adapter ax` says `ax/accessibility granted` |
| Screen Recording permission | **refused** — `ax/screen-recording refused — could not create image from rect`. The AX screenshot the Phase 11 verifier took is therefore **not** re-taken here; the doctor's line is the record, and no screenshot is fabricated |
| `ax/session` | `8 application(s) own a window` — the display is usable, not locked |
| Local model | Ollama on this host, `qwen2-5-3b-svatah-q4` and `qwen2.5:3b` pinned |
| Model credential | none. Every recording in the suite is `--gateway fake` |
| Windows host | none. T12.6 is blocked and says so |

## The contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build && pnpm -r typecheck && pnpm -r test && pnpm lint`, no credential, Node v25.6.1 | all exit 0; **3,690** vitest tests passed, 0 failed |
| `pnpm -r typecheck && pnpm -r test` on Node **v22.23.2** with `CI=true` | both exit 0; **3,690** passed, 0 failed |
| `git diff e6e1dee..phase-12 -- docs/spec/{requirements,hld,lld,tasks}.md` | empty |
| `svatah surface doctor --adapter ax` | `ax/accessibility granted`, `ax/session 8 application(s) own a window`, `ax/screen-recording refused` |
| `pnpm self` (`svatah eval self --update`) | **100 percent** over 29; Svatah 30 of 48 in 222.0 s, external 47 of 48 in 460.8 s; exit 0 |
| `svatah run evals/self --host none` | 149 passed, 0 failed, 0 skipped |
| `pnpm self:bite` | the gate bit: a wrong expectation is a disagreement, with both sides' evidence |
| `pnpm self:record` | 3 bindings — `automationId`, `controlPath`, `role`, `text`; replay green; relocalized at 0.750 |
| `pnpm self:http` | 22 steps, 0 failed, against a real `svatah serve` |
| `pnpm self:sdk` | the SDK and `svatah ui --json` agree on all 12 screens |
| `node scripts/desktop-conformance.mjs --adapter ax` | conformant, 10 cases across variants 0, 1, 2 (three consecutive runs — see T12.1) |
| `node scripts/eval-compiler.mjs --tier2` | 303 pairs; tier 1 100 %, tier 2 88.0 %, overall 98.0 % |
| `node scripts/quick-start-registry.mjs` | tarball mode, green, and says so |
| Tree after `svatah eval self` without `--update` | clean |

Node 22 was not on this host and is not a system install: it is
`~/.svatah-node/node-v22.23.2-darwin-arm64`, unpacked from nodejs.org, and put
on `PATH` for the two commands above.

## Post-verification corrections (Phase 11's findings)

The Phase 11 verification (`docs/spec/progress/phase-11-verification.md`,
overall 9.0/10, accepted with corrections) listed six findings. F5 withdrew the
verifier's own Phase 10 finding and F6 recorded spec drift already absorbed into
Draft 2.15; neither is work. The other four are one commit each.

| # | Finding | Commit | Status |
|---|---|---|---|
| F1 | `pnpm self:bite` and `pnpm self:record` crash from a clean checkout on `evals/self/steps` and `evals/self/api` | `96300bf` | done |
| F2 | The two cockpit checks are misnamed, not unreachable: the catalogue writes `describe > it`, the reporter joins with a space | `7c20b6a` | done |
| F3 | The gate rewrites `reports/adapter-ax.md` and `reports/eval-healing.md` on every run | `4511198` | done |
| F4 | The three sentences the language lacks, and what closes a third of the list | `d23eca5` | done |

### P11-F1 — the self project's optional directories

Two halves, because either alone leaves a way to break it again:

* `evals/self/steps/README.md` and `evals/self/api/README.md` are tracked, so git
  carries the directories the config names;
* `scripts/lib/self-project.mjs` copies a project part by part and **skips an
  optional absence**, while still refusing a project with no `flows` — a broken
  project and a project that does not use a feature are different things.

`tools/repo-checks/test/self-project.test.ts` asserts both, in milliseconds,
rather than by running the two scripts that need a packaged ADE.

### P11-F2 — a vitest case is named by its parts

`vitestCaseNames` builds every spelling a catalogue may use — `A > B`, the
reporter's `fullName`, the bare title — and the gate registers each. The
catalogue check now asserts **every external name against the names its source
reports**: the two cockpit cases against `tui-pty.test.ts`, every `svatah` side
against the story headers of every flow in `evals/self/flows`, and every command
source against the single name it answers to.

Measured before and after, `svatah eval self --only cockpit.pseudo-terminal`:

```
before   Checks reached | 0 of 1 | 0 of 1     ("neither side could look")
after    Checks reached | 0 of 1 | 1 of 1
```

### P11-F3 — reports outside the tree unless `--update`

`svatah eval self` resolves one reports directory and passes it to both
side-effecting sources and to its own report: a temporary directory by default,
`reports/` under `--update`. It says where. `pnpm self` asks for `--update`,
because refreshing the committed set is what a phase's record wants and is now
the only way it happens.

`tools/repo-checks/test/self-gate-reports.test.ts` runs one check through the
gate and asserts `git status --porcelain -- reports` is unchanged.

### P11-F4 — patterns 32 and 33, and the three extensions

Draft 2.15's language work, in one commit with sixteen golden entries, fourteen
executor cases and twelve grammar cases. See T12.7 below for what it bought.

## T12.7 — Close the one-sided list, and the Phase 11 corrections

**Status: done.** Commits `96300bf`, `7c20b6a`, `4511198`, `d23eca5`, `eb86902`.

### What the sentences closed

The Phase 11 one-sided list was thirty-six rows saying three things.

| The gap | The sentence | Rows it closed |
|---|---|---|
| an assertion over a set | **pattern 32**: `Every button on this screen should have an id`, `No text on this screen should contain {data.card.number}`, `Every row of the headers table should be visible` | 11 |
| a window Svatah cannot resize | **pattern 33**: `Resize the window to <w> by <h>`, with `app.launch.size` as the initial size | 2 |
| a chord sent to the window | already a sentence (`Press "Meta+k"`, pattern 11 with no target); the *adapter* could not send one | 6 |
| a `Wait for` over a service answer | **pattern 19 extended**: `Wait for the "<name>" API to answer "<path>" to be "<value>"` | the HTTP side, below |
| a multi-line value | **`Type`** takes `\n`, `\t`, `\"`, `\\` | (what is left of the flow-editor check is the *restore*, not the sentence) |

### Four things had to change for the flows to be honest

1. **Desktop `textContains` walks the subtree.** A web adapter's does; the AX
   and UIA ones read the element's own name, so "the panel should contain X" was
   true on one side of the parity gate and false on the other. That is a
   normalisation defect (REQ-SURF-4), not a platform difference. `text` — an
   equality about one element — is unchanged.
2. **`…should be absent` means not there.** The resolver's `locator` failure came
   before the one predicate whose whole meaning is "I could not find it", so it
   could only pass when a stale reference survived. It now takes that failure as
   its answer; `should not be absent` keeps the old behaviour.
3. **A `<select>`'s own options are out of the `control` set.** macOS publishes
   one of them, untitled, and "every control has a name" failed on a pop-up
   button rather than on anything the ADE did. `item` still has `option` in it.
4. **The command palette's rows are a real `group` of named `option`s.** They sat
   in a bare `<div>` inside a `listbox`, which breaks the ownership an `option`
   needs, and each row's name was computed from four spans including an
   `aria-hidden` one. (T12.3's rule, applied where the desktop snapshot case
   could not see it — see the known gap below.)

### Coverage

`evals/self/checks.yaml`: **30 of 48** checks have a `svatah` side, up from 11.
Nineteen remain one-sided and each names what is missing — a run inside a run, a
*count* rather than a quantifier, geometry across two elements, a
pseudo-terminal adapter — and five stale reasons were rewritten, because a
reason that names a gap the language has since closed is worse than none.

The gate itself caught the twentieth. `the Runs screen filters` had been
converted on the strength of a probe — the status chip cycled `all → passed →
all` — and those labels are not properties of the screen: the chips cycle
through the values the *run history* has. Svatah said fail, Playwright said
pass, neither oracle was wrong, and the check went back to one-sided with a
corrected reason. `the audit pane renders the call detail the model carries`
took its place, and is genuinely reachable: the kind column is the call and not
"surface" on every line, which needs pattern 32's negative because
`should contain` has none for one element.

**The gate on this host** (`pnpm self`, `reports/self-parity.md`):

```
100 percent agreement over the 29 check(s) both sides reached.
Checks reached | 30 of 48 | 47 of 48
Wall time      | 222.0 s  | 460.8 s
exit 0
```

`svatah run evals/self --host none`: **149 passed, 0 failed, 0 skipped.**
`pnpm self:bite` bites; `pnpm self:record` records three bindings with
`automationId` and `controlPath`, replays, and relocalizes at 0.750. The tree is
clean after a gate run without `--update`.

### The HTTP and SDK sides, written

LLD §13.9 Draft 2.15: "The HTTP and SDK sides of the self suite are written, not
catalogued."

* **HTTP** — `evals/self/http/` is a Svatah project on the HTTP adapter with nine
  named requests and eight stories, every assertion a `Wait for the "<name>" API
  to answer "<path>" …`. `scripts/self-http.mjs` (`pnpm self:http`) starts
  `svatah serve` on `evals/fixtures`, reads the URL and the bearer token off its
  stdout, and hands them over through the environment; the token is declared a
  secret so it is redacted everywhere. **22 steps, 0 failed.**
  This is also the first project to open a session on the HTTP adapter as a
  *surface*: `createSurface` has taken `http` since LLD §2.4 was written and
  nothing registered one, so `adapter: http` answered "No adapter registered
  under \"http\"". The CLI registers it now.
* **SDK** — `scripts/self-sdk.mjs` (`pnpm self:sdk`) loads every screen the model
  has through `@svatah/sdk` in process and through `svatah ui --json` in
  another, and compares the two documents with the clock fields dropped.
  **12 of 12 screens agree.** It is a script rather than a flow for the reason
  the catalogue has given since Phase 11: a flow cannot run a command and read
  its stdout.

## T12.1 — The desktop gate, race-free and load-aware

**Status: done.** Commit `70dcaf5`.

The mechanics are Phase 9's, inherited as tasks.md says. This task re-verifies
them live and closes the one part that was written nowhere.

Three consecutive runs, `--report` outside the tree so the committed one is
refreshed once at the end:

| Run | Load average | Result |
|---|---|---|
| 1 | 6.07 over 8 CPUs | conformant, 10 cases across variants 0, 1, 2; 1017 nodes in 1451 ms, **1.43 ms/node** |
| 2, beside `pnpm -r test` | 19.88, peaking **44.48** | **variant 1 retried once and recorded**; 2.79 ms/node; variant 1 still exceeded the deadline on the retry |
| 3 | 16.03 | conformant, 1.44 ms/node |

Run 2 is the load test the Validate asks for, and it failed in the one way §7.5
allows: *a retried, recorded deadline*. The report's own words:

> Retried once (LLD §7.5): variant 1 — the first read exceeded the bridge's
> deadline and the variant was run again. The numbers above are the retry's.

It is also the measurement §7.5 is written from: 1.43 ms per node quiet and
9.27 ms per node at load average 44, on the same machine and the same window.

The committed `reports/adapter-ax.md` is a fourth, quiet run: conformant, 1017
nodes in 1488 ms, 1.46 ms/node at load average 5.15 over 8 CPUs.

**A desktop leg has its runner to itself.** §7.5 says so and the pipeline had
never said it. The two gates are a `parallel:` block, which is not a
contradiction — each names a different `runs-on` — but nothing stopped a third
step being given the same host. `tools/repo-checks/test/ci.test.ts` now asserts
the two hosts differ and that neither leg runs a test suite.

**The two-same-named-processes case** the Validate asks for is
`packages/adapter-ax/test/bridge.test.ts`'s "presses the element in the instance
that has a window, not the first match", which drives the perform script's
choice through a fake System Events with two matches, one of them windowed. It
predates this task; it is named here because the Validate asks for it.

Commands:

```bash
node scripts/desktop-conformance.mjs --adapter ax --report /tmp/gate-run-1.md
( pnpm -r test & ) ; node scripts/desktop-conformance.mjs --adapter ax --report /tmp/gate-run-2.md
node scripts/desktop-conformance.mjs --adapter ax --report /tmp/gate-run-3.md
node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

## T12.2 — The compiler golden set at 300

**Status: done.** Commit `2d7b705`. REQ-COMP-9's last open P0 item.

```
$ node scripts/eval-compiler.mjs --tier2 --report reports/eval-compiler.md
Compiler eval — ollama:qwen2.5:3b
  tier0: 3/3 exact match (100.0%)
  tier1: 250/250 exact match (100.0%)
  tier2: 44/50 exact match (88.0%)
  overall: 297/303 (98.0%)
  Meets REQ-COMP-9.
```

**303 entries**, up from 242. Every threshold holds: tier 1 100 %, end-to-end
98.0 % against REQ-COMP-9's 95, tier 2 88.0 % against REQ-COMP-3's 80.

Where the fifty-eight came from, and what writing them found:

* **Forty-nine tier 1 sentences the set had never asked for.** The set had
  **zero** third-person forms — `Clicks on…`, `Enters…`, `Submits…` — and the
  grammar accepted almost none of them, although the synonym vocabulary has
  listed them since Draft 1 and every rule names them. PEG does not backtrack
  into an alternative that has already matched: `"click"i` ate the first five
  letters of "Clicks" and the sequence then failed on the `s`. The `Quit` rule
  had noticed this for itself in Phase 11 and ordered its own alternatives
  longest-first; **ninety-one** other groups had not, and are sorted now.
* **A capture the IR could not carry.** `Remember the page url as landingUrl` is
  pattern 22 and the grammar has emitted `capture.from: "url"` since it was
  written; LLD §3.2's enumeration omits `url`, though §2.1's `read()` has it. A
  plan carrying that sentence fails `ir.schema.json`, which a foreign runtime
  validates before executing (REQ-STD-3). See Deviations.
* **Twelve tier 2 paraphrases promoted out of `refused.jsonl`**, each read
  before it moved and each deleted from the corpus in the same commit.
  `tools/repo-checks/test/refused-corpus.test.ts` reports zero overlap; the
  corpus is 172.

Two candidates were read and **not** promoted: "Make sure the remember me box is
ticked" and "Confirm with the submit button" both open with a verb the grammar
lists as an assertion (`AssertVerb`), so they genuinely read two ways. An
ambiguous answer in the test set would bake a contested reading into a published
number.

## T12.3 — The ADE names every control, and the gate makes a run

**Status: done.** Commit `822e208`.

`ade.result` accepted "either the runs are listed, or the screen says there are
none", and on a clean checkout it always took the second branch: git carries no
`evals/fixtures/runs`. The branch that matters was never exercised, and a Runs
screen that had stopped rendering rows would have passed.

The case now presses Run on the Flows screen — choosing
`guards-and-compensation.flow` first, because Run with nothing selected runs
every flow and two of the fixtures' stories take a typed input with no default,
which the service refuses with a 400 the status bar prints — waits for the Run
screen, and then asserts **a row carrying a status from the results schema**.
Not "the table's text contains one somewhere": a header cell says `STATUS`, and
that reading would pass on a table with no runs, which is the branch this exists
to stop taking. The gate starts `apps/sample-web` so the run is real. The run's
own verdict is deliberately not asserted — a red run fills the screen exactly as
a green one does.

Finding a row corrected a wrong idea about the snapshot: **a subtree is walked by
`parent`, not by "the deeper nodes that follow"**. A desktop snapshot is a flat
list with a depth per node and it is *not* in tree order — the adapters walk
breadth-first, so every node at depth 12 precedes every node at depth 13. The
depth reading fails quietly, returning an empty subtree and reporting a blank
row.

The naming half was already enforced: `ade.snapshot` fails on an unnamed
interactive control and the live gate is conformant at all three variants. What
the desktop snapshot could not see, and T12.7's work found, was the command
palette — forty rows published as untitled static text, because they sat in a
bare `<div>` inside a `listbox` and their names were computed from four spans
including an `aria-hidden` one. They are a real `group` of named `option`s now.

Live: `ade.result` **10/10**, `ade.snapshot` green, gate conformant.

## T12.4 — The three-OS matrix observed

**Status: the document is done; the runs are the owner's.** Commit `d9dfd2b`.

`docs/ci.md`. It lays the two routes side by side with what each costs,
recommends both in an order, and gives the exact steps: the Bitbucket labels
that must match `runs-on:` or the step queues instead of failing, why **not**
Docker on the Mac (a container has no WindowServer), why a launch **agent** in a
logged-in session with the display awake, and that the Accessibility grant
follows the process that runs the tests rather than the runner archive.

It also writes down why the AX gate cannot go green on a *hosted* macOS runner:
the permission is a person clicking a switch, recorded in a TCC database behind
System Integrity Protection, with no supported command that grants one. That is
why the gate exits 2 there and why both CI files tolerate exit 2 and nothing
else.

**The blocked steps, exactly:**

| Step | Blocked on |
|---|---|
| `custom: desktop-gates` (Bitbucket) | no self-hosted runner is attached to the workspace. It lives in a `custom:` pipeline because a step whose labels match no runner *queues* rather than failing. |
| `ade-installers` (GitHub) | this repository has no GitHub remote. |
| the Windows UIA gate | no Windows host exists anywhere in reach. |

Nothing was performed: no account was created, no runner attached, no mirror
made. `docs/ci.md` §6 says so in the document itself.

## T12.5 — 0.1.0 published and verified from the registry

**Status: the script and the changelog are done; the publish and the tag are the
owner's.** Commit `71e0fd1`.

`scripts/quick-start-registry.mjs` (`pnpm quick-start:registry`) asks the
registry whether the four module (a) packages are there at this version, and
when they are it installs them **by name, with no `overrides`**, into an empty
Playwright project outside this workspace and runs the same five minutes a
reader runs.

The absence of `overrides` is the test. The packed quick start redirects every
`@svatah/*` name to a file, because a tarball's dependencies name versions no
registry has. This one redirects nothing, so npm resolves `@svatah/healer`'s
dependency on `@svatah/bindings` out of the registry — and a `workspace:*` that
escaped into what was uploaded fails there and nowhere else.

Measured here, in **tarball mode**:

```
$ node scripts/quick-start-registry.mjs
── asking the registry about module (a) at 0.1.0
   @svatah/bindings@0.1.0 is not published
   …
Running the **tarball** quick start instead …
Packed quick start: 3.8s of a 10-minute budget (REQ-PKG-2), on Node v25.6.1,
from 30 tarball(s), with no credential.
quick-start-registry: **tarball mode**, green. Run again after `custom: publish`.
```

A network that is down is reported as a *different* answer from a package that
is missing; a script that fell back silently because a proxy was unreachable
would publish "not published" about packages that are.

Everything after `npm install` now lives in
`scripts/lib/quick-start-project.mjs` and both quick starts share it. Two copies
of a claim about a reader's experience are two claims that drift.

`CHANGELOG.md` carries the release date and this phase's numbers. The release
workflow runs `quick-start:registry` immediately after the publish step, so
verifying a publish is part of the same dispatch.

**Not done, deliberately:** nothing is published and the git tag `v0.1.0` is not
created. A tag is a claim that a version exists somewhere, and until the owner
triggers `custom: publish` with the token it does not.

## T12.6 — The Windows UIA gate (carried)

**Status: blocked. No Windows host.**

This is the fourth phase it has been carried, and the reason has not changed:
there is no Windows machine in reach of this session or of the Bitbucket
workspace. What exists is everything but the machine —

* the adapter, with 91 unit tests and the published conformance suite passing
  against the recorded ADE trees (`packages/adapter-uia`);
* `uia-gate` in `bitbucket-pipelines.yml`, whose `runs-on:` labels are
  `self.hosted` and `windows`;
* `desktop-conformance (windows-latest)` in `.github/workflows/ci.yml`, which
  needs only a GitHub remote;
* `docs/ci.md` §3, which is the six steps to attach the runner.

The command, once a host exists:

```bash
node scripts/desktop-conformance.mjs --adapter uia --report reports/adapter-uia.md
```

T12.3's changes to `ade.result` were run against the UIA adapter's recorded
trees (`packages/adapter-uia/test/conformance.test.ts`, 2 files, 91 tests), so
the case the Windows gate will run is the corrected one. That is not the same as
having run it.

---

## Deviations

**D1 — `capture.from` gains `url` (LLD §3.2).** The grammar has emitted
`capture.from: "url"` for `Remember the page url as <name>` since pattern 22 was
written, and §2.1's surface interface lists `url` among `read()`'s kinds; §3.2's
`capture.from` enumeration does not. A plan carrying that sentence therefore
fails `ir.schema.json`, which a foreign runtime validates before it executes
(REQ-STD-3). The value is added. The alternative correction — removing a
sentence `docs/flow-language.md` documents — is the larger change, and the
mismatch reads as an omission rather than a decision. Found by T12.2, because
the golden set had no entry for the sentence.

**D2 — pattern 32's IR is `expect.subject: "set"` with an `expect.set`
descriptor.** LLD §13.9 Draft 2.15 names the sentence and its three forms and
does not give the IR. §3.2's `PredicateSubject` gains `set` and `api`, and
`Expectation` gains an optional `set` carrying the quantifier and the noun; the
*scope* is the step's own `target`, so `Every row of the headers table` is one
pattern rather than two. A refinement makes the two inseparable: `subject: "set"`
without `set` has no quantifier, and `set` beside another subject is a set nobody
asked about.

**D3 — a set's members exclude standard window chrome.** The window's close,
minimise and zoom buttons are the window manager's; macOS names them by subrole
and gives an application no way to identify them, so `Every button on this
screen should have an id` would fail on every macOS window that has ever
existed. `isWindowChrome` is the closed list the desktop conformance case
already exempts, deliberately shared rather than restated. `element` is the
exception: it means every node in the snapshot.

**D4 — a `<select>`'s own options are not `control`s.** macOS publishes exactly
one of them, untitled, so "every control has a name" failed on an artefact of
the platform's pop-up button rather than on anything the ADE does. `item` still
has `option` in it, so a sentence about a list's rows still has a noun.

**D5 — an empty set fails, whichever quantifier it is.** LLD does not say so.
"Every button has an id" over a screen with no buttons is vacuously true and
means nothing, and a green step that asked about nothing is indistinguishable
from a working one until somebody reads the tree.

**D6 — `…should be absent` takes a resolver failure as its answer.** The
resolver's `locator` failure came before the one predicate whose whole meaning
is "I could not find it", so it could only pass when a stale reference survived.
Only for `absent` and `hidden`, un-negated, and only when the *resolution* is
what failed; `should not be absent` keeps the old behaviour.

**D7 — the desktop adapters' `textContains` walks the subtree.** A web adapter's
does, and "the panel should contain X" is a sentence about a panel whose words
are on the paragraphs inside it. The same sentence was true on one side of the
parity gate and false on the other, which is a normalisation defect (REQ-SURF-4)
rather than a difference between platforms. `text` — an equality about one
element — is unchanged.

**D8 — the HTTP adapter is registered as a surface.** `createSurface` has taken
`http` since LLD §2.4 was written and nothing registered one, so `adapter: http`
answered "No adapter registered under \"http\"" — which reads like a missing
install. `evals/self/http` is the first project to open a session on it. The
`api` step still reaches it through the executor's injected runner, unchanged.

**D9 — the branch is against `e6e1dee`, not against `master`'s tip.** The Phase
12 prompt says the spec on master is Draft 2.15 and the branch was made from it.
`master` has since gained one docs-only commit, `86f4ff2` "Spec Draft 2.16",
which adds a **Phase 13** — a `process` surface kind, `packages/adapter-process`,
`packages/verify`, patterns 34–38. Merging it makes
`tools/repo-checks/test/repository layout` fail, because HLD §12 then lists two
packages Phase 13 builds and this phase is forbidden to
("Nothing beyond Phase 12"). So the branch stays where the prompt put it:
`git diff e6e1dee..phase-12 -- docs/spec/{requirements,hld,lld,tasks}.md` is
**empty**, and rebasing onto Draft 2.16 is Phase 13's first commit rather than
this phase's last.

## Known gaps

**K1 — the Windows UIA gate has never run.** T12.6, above. Fourth phase carried.

**K2 — `custom: desktop-gates` and `ade-installers` have never run in CI.**
T12.4, above. Both need a machine the owner attaches; `docs/ci.md` is the twenty
minutes.

**K3 — 0.1.0 is not published and `v0.1.0` is not tagged.** T12.5, above. The
verification is one command once it is.

**K4 — the AX screenshot was not re-taken.** This terminal has the Accessibility
grant and not Screen Recording; `svatah surface doctor --adapter ax` says
`ax/screen-recording refused — could not create image from rect` and the run
records that line rather than a fabricated image. The Phase 11 verifier's
terminal had the grant and `pnpm ade:shoot` wrote thirteen screenshots there.
Nothing in the gate depends on it: the adapter reads the accessibility tree
either way, and a step whose screenshot is missing is reported as `unreachable`,
never as a failure.

**K5 — nineteen checks are still one-sided**, down from thirty-six.
`reports/self-parity.md` lists each with what is missing. In four groups:

  * **a run inside a run** (4 checks) — pattern 19 now waits on a service's
    answer, so the *sentence* exists; the ADE's service listens on a port it
    chose at start-up and an `api/` request names a URL. A flow that could ask
    the ADE which port it is on closes all four.
  * **a count rather than a quantifier** (1) — pattern 32 says `Every` and `No`,
    and "each heading appears once" needs `Exactly one …` or `… should be
    unique`.
  * **geometry across two elements** (1) — pattern 24 asks about one element's
    box; comparing two has no sentence.
  * **a control's label compared with its previous value** (1) — the Runs
    screen's filter chips. See the note below.
  * the rest are the three REQ-SELF-3 oracles kept external by design, a
    pseudo-terminal adapter the surface kinds do not include (3), and five
    others each naming its own gap.

**K6 — the Run and audit stories need a run to already exist.** Two stories in
`evals/self/flows/04-ade-palette.flow` read the ADE's Run screen, which shows
the project's most recent run, and `evals/fixtures/runs` is ignored by git. In
the gate this is satisfied by ordering — the sources run alphabetically, so
`ade-playwright` and `desktop-gate` both make runs before `svatah` does — but a
bare `svatah run evals/self` on a fresh clone would fail those two. Starting a
run from inside the flow is K5's first group.

**K7 — `pnpm -r test` beside the desktop gate is not reliable.** Under T12.1's
load test (load average peaking 44) `packages/cli`'s `snapshot-parity.test.ts`
hit a 10-second hook timeout. That is what a load test is for and it is recorded
rather than hidden; the suite is green on its own and green on both Node
versions when nothing else is running. A hook timeout that scales with the
machine is a fixture budget, not a defect in what it sets up.

**K8 — the verification contract's `--update` is what refreshes the committed
reports.** P11-F3 made the gate write outside the tree by default, so a verifier
running `svatah eval self` leaves a clean checkout clean. `pnpm self` passes
`--update` and is what wrote the three committed reports in this record.
