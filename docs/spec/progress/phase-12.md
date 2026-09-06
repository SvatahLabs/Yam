# Phase 12 — Release 0.1.0 and the open P0 items

Implementer: this session · Branch `phase-12` from `master` at `e6e1dee` · Host: macOS 15 (Darwin 25.3.0), arm64, Node v25.6.1 and v22.x, pnpm 10.30.2

Spec: Draft 2.15 on `master`. No spec document is edited on this branch;
`git diff master..phase-12 -- docs/spec/{requirements,hld,lld,tasks}.md` is
empty.

## Environment, and which fallback applied

| Thing | This host |
|---|---|
| Accessibility permission | **granted** to the terminal running Svatah — `svatah surface doctor --adapter ax` says `ax/accessibility granted` |
| Screen Recording permission | **refused** — `ax/screen-recording refused — could not create image from rect`. The AX screenshot the Phase 11 verifier took is therefore **not** re-taken here; the doctor's line is the record, and no screenshot is fabricated |
| `ax/session` | `8 application(s) own a window` — the display is usable, not locked |
| Local model | Ollama on this host, `qwen2-5-3b-svatah-q4` and `qwen2.5:3b` pinned |
| Model credential | none. Every recording in the suite is `--gateway fake` |
| Windows host | none. T12.6 is blocked and says so |

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
| a multi-line value | **`Type`** takes `\n`, `\t`, `\"`, `\\` | (the remaining K6 gap is the restore, not the sentence) |

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
pseudo-terminal adapter — and four stale reasons were rewritten, because a
reason that names a gap the language has since closed is worse than none.

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

## Deviations

*(filled in below, per item)*

## Known gaps

*(filled in below)*
