# Tasks — the experience

Waves are ordered so that nothing is built twice. The palette comes first
because every board, every frame and every golden file is drawn in it, and
changing it afterwards would rewrite all of them a second time.

`[ ]` not started · `[x]` done · `[~]` partly, with the reason in the text.

## Wave E0 — one brand

- [ ] **E0.1** Take the site's palette into `@svatah/yam-ui-tokens`: `--yam`
  `#357862`/`#7cc9ae`, `--accent` `#586ec2`/`#a3b1f0`, warm neutrals, both
  themes. Keep the token *names* the code already uses so the change is values,
  not a rename. `EX-01`
- [ ] **E0.2** A check that fails when a token disagrees with the site's
  stylesheet, reading the site rather than a copy of it. Records the site's
  values in the repository so the check runs without the site being up, and
  fails when the two drift. `EX-01`
- [ ] **E0.3** `prefers-color-scheme` as the default and an explicit choice
  overriding it, in the app. `EX-02`
- [ ] **E0.4** The cockpit's `chrome()` on the same tokens, at 24-bit, 256 and
  monochrome; golden frames regenerated and read. `CX-02`, `EX-02`

## Wave E1 — the app's shape

- [ ] **E1.1** The first task above everything on a window with nothing
  connected; the toolbar drawn only when there is something to act on. `AX-01`,
  `AX-05`
- [ ] **E1.2** Destinations that need a project say so on the navigation, and one
  invitation to open one replaces seven walls. `AX-04`
- [ ] **E1.3** Say takes a sentence in the app. The grounding half is `TV-T07c`'s
  and stays out of scope; the field, the history and the zero state are not.
  `AX-02`
- [ ] **E1.4** Disconnect is available wherever a session is open, in every mode.
  `AX-03`
- [ ] **E1.5** Adapters become a status with one disclosure; the MCP
  configuration block leaves the first screen. `AX-06`
- [ ] **E1.6** The window is used at every size: the main region grows, and a
  context column arrives where there is room. `AX-17`
- [ ] **E1.7** Screens for observing, for handing a target to an agent and taking
  it back, for healing, and for a run's report. `AX-18`
- [ ] **E1.8** Recents separate the person's projects from the app's scratch
  workspaces. `AX-12`

## Wave E2 — what a screen reader hears

- [ ] **E2.1** Capitals move to `text-transform`; no accessible name begins
  mid-sentence. `EX-03`
- [ ] **E2.2** Headings carry levels; a heading that is not drawn is not
  published. `AX-09`
- [ ] **E2.3** No table is published before it has rows. `AX-10`
- [ ] **E2.4** `collapsed` only for roles that can expand, in
  `adapter-ax/src/tree.ts`. `EX-04`
- [ ] **E2.5** An ambiguous process name is reported as ambiguity, not as
  absence. `EX-07`

## Wave E3 — words

- [ ] **E3.1** Every zero state names an action; the guarantees that are not
  instructions stay as they are. `AX-07`, `CX-04`
- [ ] **E3.2** Every screen names where its work goes. `AX-16`
- [ ] **E3.3** No sentence twice on a screen; the "browser, app, device or API"
  copy goes everywhere it survives. `EX-05`
- [ ] **E3.4** A check for prose naming a screen the model does not have.
  `EX-06`

## Wave E4 — the cockpit

- [ ] **E4.1** The four properties checked in a pseudo-terminal: a key that can
  only refuse is not reachability. `CX-01`
- [ ] **E4.2** The rail strip stays and is held to the same rule as the app's
  navigation. `CX-03`
- [ ] **E4.3** Modes are the model's in both renderers. `CX-05`

## Wave E5 — the record

- [ ] **E5.1** Re-run the walkthrough and diff it against 2026-09-11's. `EX-N2`
- [ ] **E5.2** The wave record: what running it found, what each check would have
  caught, and which rules still cannot tell the new design from the old. `EX-N3`
