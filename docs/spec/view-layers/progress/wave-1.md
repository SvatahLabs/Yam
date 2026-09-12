# View layers — the record

What was built, what it found, and what was done differently from the plan.
Every number here was produced by running the thing rather than by reading the
diff. Nothing has been published, and the release remains the owner's call.

Branch `tui-view-layer`, off `master` at `06a3ef5`.

## What was built

| Wave | Tasks | State |
|---|---|---|
| W0 · the model | TV-M01…TV-M05 | done |
| W1 · the foundation | TV-T00, T02–T07c, T11 | done |
| W2 · the remaining screens | TV-T08, T09, T10 | done |
| W3 · interaction and liveness | TV-T12–T15b | done |
| W4 · close it out | TV-T16, T17, T18 | done |
| WA · the app | TV-A01…TV-A08 | done |
| WC · the command line | TV-C01…TV-C03 | done |

The cockpit owns the terminal and fills it; a screen is a region tree rather
than four fixed panes; the keys, the colour and the palette are the terminal's
own; it subscribes to the event stream and folds what arrives with the model's
reducers; Surfaces and Record are one Session screen with three modes in both
renderers; the app follows the OS appearance, has an icon, has motion and has
the primitives Session needs; and the command line paints a tone the same way
the cockpit does.

## What the checks found, that a reading would not have

Nine defects, each caught by something written to catch it rather than by
inspection. They are the argument for the checks, so they are listed with what
found them.

1. **The spike found that Ink drops the mouse.** SGR bytes reach `stdin` intact
   and `useInput` never fires, because it maps known keys and discards the rest.
   The decoder is ours; the design had said so, and now it is known rather than
   assumed.
2. **The region property tests found boxes past the bottom edge.** More panes
   wanting rows than the terminal had made the water-fill stop at one row each
   and draw them anyway. Twelve panes cannot be drawn in five rows; seven are
   drawn and the rest reported collapsed.
3. **And then found a split drawing nothing at all**, once the cover property
   was strengthened to hold after a collapse: every child had collapsed, so the
   parent's box was room with nothing in it. `collapseBelow` prefers to leave; it
   does not leave an empty box.
4. **The pseudo-terminal found a 189-character line on a hundred columns.** A
   split drawn without a width lets its children lay themselves out at their
   natural size. Splits are placed now, not just panes.
5. **And found the frame scrolling by one.** A frame exactly as tall as the
   terminal, plus the newline every frame ends with, scrolls the normal buffer —
   which is why a footer arrived with the next frame's status bar glued to it.
   Inline, the last row belongs to the newline; on the alternate screen there is
   no newline to make room for.
6. **The golden frames found a missing pane on their first run.** On the run
   screen at eighty columns the tree collapses, `place()` located each split by
   its first *declared* pane, and looking up a collapsed pane's box returned
   nothing — so the whole column was skipped and the main pane went with it.
7. **The key table found two dead keys.** `session` bound `s` twice once Surfaces
   and Record were one screen, and `record.stop` was bound to `q`, which the
   cockpit has always quit on — an action reachable in the app and unreachable in
   the terminal.
8. **The boundary check found the cockpit inventing words.** It turned
   `binding.verified` — a boolean — into "verified" or "unverified" in two
   places, which is how the app and the cockpit came to differ about a capital
   letter.
9. **A capture found the footer advertising one key for two actions.** It
   lowercased every key, so the run screen's `r` (run again) and `R` (resume)
   both printed as `r`; React saw two children with the same key and printed the
   warning into the frame.

Two more were found in the *specification* by writing it down: the cockpit opened
on Flows while the app opened on Session, two drafts after the decision, and
`macros.mjs` drew the pre-2.25 rail on every app artboard.

## Deviations from the plan, and why

* **The mode does not switch on `1`/`2`/`3`.** The `TUI-Session` board printed
  `1 record 2 say 3 do` while every other board printed `1-4 region`: the same
  digits with two meanings on the one screen that has both. Regions keep the
  digits; the mode cycles on `m`. TV-15 is amended rather than left disagreeing
  with the product.
* **The CLI's help and its dispatch stay two sources.** TV-C01 asked for one, and
  building it made the opposite argument the stronger one — the repository's own,
  about the palette fixture: a check that generates one source from another
  compares a thing with itself. `yam completion` is the table's third reader, and
  `action-parity` still has something to say.
* **TV-M05 landed in W3 rather than W0.** Its only dependent is TV-T15b, and the
  W0 gate never named it.

## Evidence

* `pnpm -r test` — green across every package.
* `pnpm artboards` — 24 boards fit their frames, now including the terminal ones,
  and every rule is shown to bite.
* `node scripts/audit-sheet.mjs` — 0 axe violations, 34 interactive elements
  named and id'd, across both themes.
* `pnpm ui:capture` — the captures in `reports/` are of the cockpit that exists.
* 33 golden frames: eleven screens at 80×24, 120×40 and 200×50, each exactly as
  tall as its terminal and never wider.
* `tools/repo-checks/test/tui-pty.test.ts` — every screen drawn in a real
  pseudo-terminal, and `--json` equal to the model's state.

## What has not been done

* **Nothing is published.** No tag, no registry, no push.
* **The `yam mcp --http` client name is a placeholder.** A client that names
  itself at initialize should be recorded by that name; the transport has the
  handshake and the plumbing to read it is not written.
* **The say mode grounds nothing yet.** The model carries the sentences and the
  flow being written; `yam repl`'s grounding is not wired into the Session
  screen, so `say` shows what a capture wrote rather than accepting a new
  sentence. That is the next piece of work, and it is the one the mocks promise
  most loudly.
