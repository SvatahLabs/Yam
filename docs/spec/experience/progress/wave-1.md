# The experience, implemented — what running it found

The specification was written from a walkthrough of 2026-09-11 in which Yam drove
the packaged Yam through the MCP tools and read every finding out of the
application's own accessibility tree. This is the record of building what it
asked for: 2026-09-12, waves E0 to E5, twenty-six tasks.

`EX-N3` says a check that passes on the design it replaces measures nothing. So
this is organised by *what the checking found*, not by what was built — and the
findings that mattered are mostly the ones where a rule was already satisfied
and the defect was there anyway.

## The three that were satisfied and wrong

**The capitals were already `text-transform`.** `EX-03` reads "visual styling is
never an accessible name; capitals are `text-transform`" — and they were, in
seven CSS rules, and `INSPECTOR`, `CONNECT AN AGENT`, `BROWSER`, `API`, `NATIVE
APP` and `DEVICE` still reached the tree in capitals. Chromium computes an
accessible name from **rendered** text, and `text-transform` is rendering. The
fix is `font-variant-caps: all-small-caps`, which is a font feature: it chooses
glyphs and changes no text. Nothing about the rule was wrong; the rule was about
the wrong mechanism.

**The golden frames could not see a palette.** `E0.4` asked for them to be
"regenerated and read" after the cockpit moved onto the brand. They are rendered
by a test runner whose stdout is not a terminal, so `depthFor` answers `none`,
every entry of `CHROME` is `undefined`, and all thirty-four committed frames
contain no escape sequence at all. They are a check of the *layout* — and they
are why `borderColor="magenta"` survived two phases. `test/golden-colour.test.tsx`
states a terminal instead of being run in one.

**Eleven controls stood in front of the first task, and nine of them were the
rail.** The first version of the walk's `AX-01` rule excluded the navigation by
listing the rail's labels. `AX-04` had just appended ", needs a project" to six
of those labels, so the list matched none of them. A filter that has to be kept
in step with copy is a filter that goes wrong silently; it reads the `main`
landmark now.

## What the walk reads

`evals/self/yam-on-yam/app-walk.mjs`, against a build packaged after every wave:

```
  101 nodes     6 interactive controls    33 unnamed

  ok   B11 / EX-04  2 collapsed, 0 on a role that cannot expand   (was: every one)
  ok   B12 / EX-03  none                                          (was: six shouted names)
  ok   B13 / AX-09  3 headings at level(s) 1, 2                   (was: flat, 8 at one level)
  ok   B14 / AX-09  none                                          (was: heading "OTHER")
  ok   B15 / AX-10  0 tables, 0 rows, 0 cells                     (was: 6, 15, 106)
  ok   B8  / AX-05  none disabled before the first live control   (was: 3 of 4)
  ok   B9  / AX-01  0 control(s) before it                        (was: below the toolbar)
  ok   B10 / AX-01  strip at 18, first acting control at 21       (was: after it)
  ok   B1  / AX-12  none                                          (was: three machine names)
  ok   B5  / AX-02  a field is on the screen                      (was: a paragraph)

  10 of 10 rules can tell this design from the one they were written against.
```

The first attempt to retake this after E3 and E4 failed, and instructively: the
machine's screen had locked, and macOS shows an accessibility client no windows
at all when it is. The adapter reported exactly that — *"the screen is locked
(CGSSessionScreenIsLocked) … and the Finder, which is always running, reports 0
windows to the same accessibility client, so this is the host and not the
application under test"* — which is the sentence `SF-17` exists for, arriving
unprompted in the one situation it was written for.

## The decision the measurement forced

With the rail, the window chrome and the top bar excluded, three controls still
stood in front of the connect field: **Record, Say and Do**. Whether that
violates `AX-01` depends on whether the mode strip is navigation, and the
specification answers it from the other end — `B10`'s complaint is that the strip
comes *after* the toolbar, which is a request to move it **earlier**, not to
remove it. A rule that made the strip an `AX-01` violation would contradict the
blocker `AX-01` also cites.

So a `tablist` is navigation, and `B10` became its own measurement holding the
strip in front of the first control that acts. The walkthrough's narrative `R2`
("modes become a consequence, not a chooser") is answered by `AX-02` instead:
Record and Say offer the one step they share when nothing is connected, rather
than the strip disappearing.

This was the third time the question came up and the first time anything decided
it. Twice before it was deferred because removing the strip would have broken six
Playwright cases that reach Record and Do without a connection — which is a cost,
not an argument, and should not have been doing the deciding.

## Five instructions naming keys that do not exist

E3.1 gave every cockpit zero state a next step. Fourteen of them named a key, and
five named a key bound on a **different screen**: `g` for the gateway, `s` for
serving tools, `n` for a new request, `i` on Data, `r` on Runs. Every one read
plausibly.

`CX-01` is the rule they break — "a key that can only ever refuse is not
reachability" — and nothing was checking it, because the keys were in prose and
the key table is a table. `packages/tui/test/zero-states.test.ts` loads each
screen, asks `paneModel` for its panes, and holds the sentences in them to
`keysFor` of that same screen. It also found one that predates this wave:
**"press H to heal the selected run"**, where the key is `h`.

## Two things the rules refused, correctly

**A guarantee is not an instruction.** `AX-07`'s second formulation required every
sentence to end in an imperative and failed seven boards on correct copy. The
third is scoped to zero states — and even there, "this project compiles clean" is
a list that is empty because nothing is wrong. Appending "press ? for the keys"
to it makes the product worse. Those are enumerated in `GOOD_NEWS`, with the
reason, rather than inferred.

**Two of the seven closed doors were open.** `AX-04` was implemented by section —
everything under Automations and Activity — and Agents and tools is about the
sessions an agent holds and needs no project at all. Which screens are a
project's is `needsProject` in the model now, read by both renderers.

## What the packaging wave broke and nothing caught

`evals/self/yam-on-yam/drivers.mjs` still spawned `yam mcp`, which `PK-02`
removed. The eval suite needs a packaged application and the macOS Accessibility
grant, so it is not in `pnpm -r test` and runs by hand — which means a regression
in it waits for somebody to run it. It has been pointed at
`packages/mcp/dist/bin.js`.

## Rules that cannot tell the designs apart

None, as of the reading above: all ten of the walk's rules report a `now` that
differs from their `was`. Three of the repository checks are new and have no
"before" to compare against — `words.test.ts`, `zero-states.test.ts` and
`prose-names.test.ts` — and each carries a *shown to bite* case built from the
exact text that was there, so the rule is exercised against the old design even
though the old design is gone.

## A second pass, after the lint was cleared

`npx eslint .` was red with twenty-two errors when this wave began and is green
now. Most were imports left by a rename. Three were not, and one of those —
`drivers-optional.test.ts` carrying a recursive source lister it never called —
was worth reading before deleting: the check is complete, the helper was left
over from its first version. `pnpm -r typecheck` was red too, inside the
packaging wave's own check, where `expect(packed).toBeDefined()` asserts at run
time and narrows nothing at compile time. A type error can live inside a passing
test.

Then the implementation was re-read against what it claimed, and seven things
came out of it.

**A replacement that silently did not happen.** `CX-03`'s cockpit wiring was
never applied: `railRow` was still being called with two arguments, so the strip
could not have marked anything shut on any run. The unit tests passed because
they call `railRow` directly. A test of the rule is not a test of the wiring,
and a scripted edit that matches nothing says nothing.

**A signal that could never fire.** The wiring, once applied, read
`connection.project !== ""` — and `yam ui` resolves its argument, defaulting to
`.`, so that is true whether or not there is a project at the end of it. It asks
the service now. The first version of *that* read `answer.result.config.project`,
an envelope `GET /project` does not send, which would have marked every
destination shut on every run: the same defect pointed the other way.

**Two landmarks with one name.** The empty-table zero state was a `<section>`
with an accessible name, which is a **region landmark** — so the sessions list,
inside `<aside aria-label="Open sessions">`, published `complementary: Open
sessions` *and* `region: Open sessions`. The sheet audit has a rule for exactly
this and could not see it, because the sheet has no empty table inside an aside.
Driving the window did. The inspector had the same shape from the other
direction: a section titled "Inspector" inside the Inspector landmark.

**A control made unreachable by fixing something else.** Moving *Recheck
targets* out of the toolbar was right while the discovery panel is on the
screen — and once a surface connects, that panel is replaced and the action was
nowhere. It is placed by the screen only while the screen draws it.

**Half a rule traded for the other half.** `AX-17`'s narrow end was first
answered with `display: none` on the inspector below 820 px, which makes the
act-and-verify form and the agent's configuration unreachable at the width where
a person has least room to work around it. "Nothing is unreachable when the
window is small" is not tradeable for "the space is used when it is large". It
stacks below the work now, and the measurement checks it at all five widths.

**An enabled control that could only refuse.** `AX-03` was implemented as
"Disconnect is live whenever the broker holds a session", and with two open and
neither chosen it could do nothing but refuse — which is the *Reachable*
property this specification opens with. Exactly one needs no choosing; more than
one is chosen in Do's session list.

**`yam mcp` still in the front door.** The packaging wave's check asserted
`name: "mcp"` was absent from `help.ts`, and it was — while the first screen of
`yam help` still ended "More, one level down: … tool · mcp · eval …". A check
that reads a source marker rather than the sentence a person reads is a check of
the shape of the fix. The help text is held verbatim against LLD §15.1, which
still listed it too.

And one non-defect, established rather than assumed: a synthesised `AXPress` on
the Adapter chooser opens nothing a snapshot can see. That is a limit of what an
accessibility press does to a Radix listbox, not a broken control — the keyboard
opens it, with its options, and the Playwright case says so. What the same probe
*did* find is that the chooser read **"Choose…"** on arrival: the option for
automatic selection carried the empty string, which is Radix's sentinel for
"nothing chosen", so the first task's form invited a decision nobody has to make.

## The intermittent failure: five `pkill`s

Three appearances, three wrong hypotheses — load, a stray broker, a shared state
directory — before capturing a full run's output rather than a filtered summary
gave the first real fact:

```
surface-journey › runs across six separate processes …
AssertionError: … : expected 21 to be +0
```

Exit **21** is `SESSION_NOT_FOUND` or `SESSION_CLOSED`, and the second reading
put it on the **`connect`** line, not the snapshot. A connect cannot fail to find
a session it is about to make.

`handleError` was the first defect. A `SessionError` from an *operation* means
the session it names has gone; the same class thrown while **opening** one means
the session was never made — a browser that would not launch, a permission not
granted. Calling that `SESSION_CLOSED` is a diagnosis pointing at a session that
never existed, and it sent every reading of the number at the broker.
`CONNECT_FAILED` is what a caller can act on.

The second is the cause. Five test files ended with:

```
spawnSync("pkill", ["-f", "surface broker"]);
```

`pkill -f` matches the **command line**, and every broker's command line is
identical. `pnpm -r test` runs several packages at once and vitest runs files in
parallel within each, so a file finishing its teardown killed the broker another
file — or another package — was mid-journey on. About one run in three, and it
moved between packages because it was a race between teardowns and journeys.

That is also why the state-directory isolation did not fix it on its own: giving
each suite `YAM_BROKER_STATE_DIR` separates their *descriptors* and does nothing
about a signal sent by pattern to every matching process.

What is in place now:

  * the five per-file kills are gone. A broker exists to outlive commands, so per
    file is the wrong granularity;
  * one reaper per package, in `scripts/vitest-broker.mjs`, run by `globalSetup`
    after every file has finished, killing **by the pid in its own descriptor**.
    Its first version read `undefined` on every suite and cleaned nothing while
    appearing to work: `test.env` reaches the *workers* and `globalSetup` runs in
    the main process, so the directory has to be set on `process.env` in the
    configuration itself. Found by counting the brokers left behind after three
    green runs — three, then five, then five;
  * each suite's own state directory, with the runner's pid in the name, so two
    packages cannot find each other's broker in the first place;
  * `SESSION_NOT_FOUND` prints the broker that answered — url, pid, and what
    started it. It earned its place immediately: the first failure after it
    landed read *"pid unknown, started by an unnamed build of Yam"*, which is a
    broker predating the change and still alive, and that is what pointed at the
    reaping.

Two attempts went wrong on the way and both are worth keeping. A **fixed**
per-package directory name is worse than the shared one: a descriptor left by a
previous run names a pid that may since have been recycled, so the next run's
broker finds "a broker is already running" and exits 0. And the MCP SDK's
`StdioClientTransport` gives a spawned server a **minimal environment** —
`getDefaultEnvironment()`, PATH and HOME and a short list — so nothing named
`YAM_*` reaches it unless passed, which had half of `packages/mcp` on one broker
and half on another.

The wait message was also ungrammatical — *"waiting for the surface broker
another command is starting."* — which is how it came to be quoted as an error in
three separate investigations.

## Left open

Nothing. All twenty-six tasks are `[x]`.

The one thing that is a judgement rather than a measurement: `AX-01`'s "the
navigation excepted" is read here as including the mode strip, for the reason
under *The decision the measurement forced*. If that reading is wrong, `B9` is
open and the strip belongs behind the first connection — which is what the
prototype draws, and what six Playwright cases would have to be rewritten to
allow.
