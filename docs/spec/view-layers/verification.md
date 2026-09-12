# Verification of the task set

Status: **the specification is verified; the implementation has not begun and nothing in it has been run.** This records what was checked, what was found and what is still open, before any of it is built — because a task list nobody has argued with is a task list that fails in week two.

Checked on 2026-09-09 against `master` at `06a3ef5`, on branch `tui-view-layer`.

## What was checked, and how

| Check | Method | Result |
|---|---|---|
| Every requirement has a task | Coverage index read against `README.md`'s table | TV-01..TV-19 all covered |
| Every task has a requirement | Read | 36 of 36 |
| No dangling dependency | Dependency graph parsed from the file | clean, after D9–D11 |
| No forward dependency (a task needing a later one) | Same | clean, after D2, D9, D11 |
| No priority inversion (P0 waiting on P1/P2) | Same | clean, after D1, D10 |
| Claims about the code are true | Each file and line cited was opened | one correction, D5 |
| The artboards fit their frames | `pnpm artboards` | 24 of 24 |
| The frames are the size they claim | Character count per line | 120×40 and 80×24 exact |

## Defects found and fixed

* **D1 · A P0 requirement rested on a P1 task.** TV-13 says every MCP call is readable "as it arrives", which is impossible without the subscription — and the subscription (TV-09, TV-T14) was P1. TV-09 and TV-T14 are now P0. Left alone, shared control would have shipped as a screen that needed a keystroke to tell you an agent had taken your target.
* **D2 · TV-T07c (W1) depended on TV-T11 (W3).** The key map is foundation, not interaction polish: mode-scoped keys are the whole of TV-15. TV-T11 moved into W1.
* **D3 · The model merge did not name its fallout.** TV-M01 changes a screen id three desktop tests assert on; it now names `parity.test.ts`, `screen-rule.test.ts` and `shell.spec.ts` as part of the same change rather than as someone else's red suite.
* **D4 · The MCP view drew state the model does not have.** `AgentsState` has `tools`, `refused` and `invocations` — and nothing about who is connected, over what transport, on which profile. The board showed all four. **TV-M05** adds `clients` to the model; until it lands, the left region of `TUI-Mcp` is a drawing rather than a design.
* **D5 · "The app has no responsive layout" was wrong.** `shell.css` has one breakpoint, at 960 px, which narrows the rail and inspector and wraps the toolbar. The true finding is narrower and is what TV-19 now says: *above* 960 px the chrome is a fixed 580 px of any window.
* **D6 · Stale counts.** TV-T17 said "the four boards" when there are nine; TV-T18 said "TV-01..TV-12" when there are nineteen and three layers; TV-T01 named Draft 2.26 alone after 2.27 landed.
* **D7 · The app's Session merge did not depend on the primitives it needs.** Session cannot be assembled from `Table` and `InspectorSection`; TV-A02 now depends on TV-A03, and TV-A03 is ordered before it.
* **D8 · A check would have become a tautology.** `action-parity.test.ts` compares `help.ts` against the dispatch; TV-C01 makes them one source, which would leave the check passing with nothing left to compare. TV-C01 now requires replacing it rather than letting it pass vacuously.
* **D9–D11 · Ordering.** TV-T11 kept its old dependency when it moved; a P0 evidence task waited on a P2 tmux task; TV-A03 was listed after the task that depends on it.

## Blockers — all answered (owner, 2026-09-09), recorded as Draft 2.28

| | Question | Answer | Consequence |
|---|---|---|---|
| **B1** | Before or after 0.1.0? | **Before.** No release until the owner says the work is done. | The rename is free; the first release is the product this specification describes. |
| **B2** | `--screen surfaces` / `record` | **Removed outright.** | TV-M04 rewritten: an error naming `session`, not a silent redirect. No alias, no window. |
| **B3** | Where Agents and tools live | **Split.** Exposure → Automations, clients and calls → Activity, holder → Session. | TV-M05 says where each part is read; the rail stays at `SF-16`'s four. |
| **B4** | Can Ink hold the alternate screen? | **Spike it first.** | **TV-T00** added at the head of W1: half a day, thrown away, answered in writing. |
| **B5** | How big is the app merge? | **(b), because (c) is not available** — see below. | WA splits into what W0 forces and what may wait. |
| **B6** | Where it lands | **One commit of the specification and the mocks on `tui-view-layer`,** reviewed before any code. | Done; implementation begins after the review. |

### Why B5 could not be (c)

The owner asked for (c) — do not size the app, it is not this release — *if it is not a problem*. It is a problem, and the reason is mechanical rather than a matter of taste: **TV-M01 removes the `surfaces` and `record` screens from `@svatah/yam-screens`, and `Surfaces.tsx` and `Record.tsx` render exactly those.** The app stops building the day W0 lands. There is no version of this work where the app is untouched.

What *is* deferrable is its polish. So WA is split:

* **Forced by W0, part of the same work:** TV-A01 (the rail), TV-A03 (the primitives Session needs), TV-A02 (the merge itself).
* **May wait for a later release, breaking nothing:** TV-A04 (motion), TV-A05 (the state audit), TV-A06 (theme), TV-A07 (fluid layout).

That is the honest shape of (c): not "the app is not in this release", but "the app's *modernisation* is not, and its migration is".

## The path, now that the answers are in

1. ~~Answer B1–B6.~~ Done; Draft 2.28.
2. **Commit the specification and the mocks** on `tui-view-layer`. One commit, nothing pushed.
3. **TV-T00, the spike.** Half a day, not merged, answered in writing.
4. **W0** (TV-M01–TV-M05) and **W1** (TV-T02–TV-T07c), with **TV-A01/A02/A03** landing alongside W0 because the app cannot build without them.
5. **WC** whenever there is a spare hand.
6. **TV-A04–A07** when the owner decides the app's modernisation is due.

## Still open, and outside this specification

* **The brand mark.** `apps/desktop/forge.config.ts` sets no `icon` at all, so the packaged app ships the default Electron icon; `.sv-brand-mark` is an 18 px accent square standing in for a logo, in the app and in eight artboards. The proposed mark reads at 32 px and loses its leaves and hatching at 16 px, and its palette is warm where the product's is dark and lavender. Not scheduled here: it needs a transparent variant, a 16 px drawing and a monochrome lockup first, and the palette question decided.

## What has *not* been verified

* **No code has been written or run.** The suite has not been executed on this branch; the only things run are `pnpm artboards` and the frame measurements.
* **The central technical assumption is untested**: that Ink can hold the alternate screen with fixed-height regions and a mouse, at the frame rate a live event stream implies. `TV-T02` and `TV-T03` assume it. If Ink cannot, the design survives — the region solver produces boxes either way — but the widget layer changes shape.
* **The app's merge has not been sized against `Shell.tsx`** (745 lines) or `Surfaces.tsx` (723). They are read, not refactored.

## Readiness

**W0 and W1 are ready to start. WA and WC are specified but blocked. One spike should come first.**

* **Start now:** TV-M01–TV-M04 (the model merge) and TV-T02–TV-T06 (terminal foundation). Their dependencies are internal, their Done conditions are machine-checkable, and nothing in them waits on a decision.
* **First, one spike, half a day:** alternate screen + a fixed-height region tree + a resize + one mouse click, in Ink, thrown away afterwards. It de-risks TV-T02, TV-T03 and TV-T05 together, and it is the only assumption in this document that could reshape a wave.
* **Blocked:** WA cannot begin until TV-M01 lands, and TV-M05 wants the Agents placement decided. WC is independent and can start whenever someone is free.
* **Not ready, and deliberately:** nothing here is committed, and no release decision has been made. The `--screen` rename in TV-M04 is the first change with a user-visible consequence, and it should not be built until the deprecation question is answered.
