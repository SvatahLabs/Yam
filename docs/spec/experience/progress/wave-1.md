# The experience, implemented — what running it found

The specification was written from a walkthrough of 2026-09-11 in which Yam drove
the packaged Yam through the MCP tools and read every finding out of the
application's own accessibility tree. This is the record of building what it
asked for: 2026-09-12, waves E0 to E5, twenty-one tasks.

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

`evals/self/yam-on-yam/app-walk.mjs`, against a packaged build, after E0–E2:

```
  101 nodes     9 interactive controls    33 unnamed

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

**Not retaken after E3 and E4.** The machine's screen locked, and macOS shows an
accessibility client no windows at all when it is — which the adapter reports
correctly, and which is the whole reason `EX-N1` insists this be driven rather
than asserted. E3 changed two zero-state strings the app draws and E4 changed the
cockpit only; neither moves a number above. That is a reason to expect the same
reading, not evidence of it.

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

## The intermittent failure, again

Two full-suite runs during this wave failed in different packages —
`packages/cli`'s `surface-journey` once and `packages/mcp`'s
`trajectory-compile` once — and both passed alone immediately afterwards, and
both passed in the runs either side. The packaging wave recorded the same shape
and traced its last occurrence to a stray broker from a manual experiment; these
two happened while a packaged application had been launched repeatedly for the
walk, which starts a broker of its own. One process per machine means a stray
broker is a shared fixture nobody declared. Still a hypothesis.

## Left open

Nothing in `tasks.md` is `[ ]`. `E5.1`'s re-reading after E3 and E4 is the one
measurement this record could not take, for the reason above.
