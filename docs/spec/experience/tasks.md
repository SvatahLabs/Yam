# Tasks — the experience

Waves are ordered so that nothing is built twice. The palette comes first
because every board, every frame and every golden file is drawn in it, and
changing it afterwards would rewrite all of them a second time.

`[ ]` not started · `[x]` done · `[~]` partly, with the reason in the text.

## Wave E0 — one brand

- [x] **E0.1** Take the site's palette into `@svatah/yam-ui-tokens`: `--yam`
  `#357862`/`#7cc9ae`, `--accent` `#586ec2`/`#a3b1f0`, warm neutrals, both
  themes. Keep the token *names* the code already uses so the change is values,
  not a rename. `EX-01`
  — `yam`, `yam-ink` and `yam-soft` are added, because the site draws its mark
  in one colour and its focus rings in another and collapsing them here would
  have thrown away a distinction the brand already makes. `docs/spec/design/base.css`
  reseeded and 39 artboards rewritten with it.
- [x] **E0.2** A check that fails when a token disagrees with the site's
  stylesheet, reading the site rather than a copy of it. Records the site's
  values in the repository so the check runs without the site being up, and
  fails when the two drift. `EX-01`
  — `packages/ui-tokens/test/brand.test.ts`, over `brand/site-palette.json`.
  Every token is bound to a named site value or listed as derived with its
  reason, so a new token cannot arrive from nowhere.
- [x] **E0.3** `prefers-color-scheme` as the default and an explicit choice
  overriding it, in the app. `EX-02`
  — `tokens.css` gained the media query it never had; `system` is the *absence*
  of `data-theme`, and the app has an Appearance chooser in the top bar.
- [x] **E0.4** The cockpit's `chrome()` on the same tokens, at 24-bit, 256 and
  monochrome; golden frames regenerated and read. `CX-02`, `EX-02`
  — the thirty-four existing goldens could not be regenerated into anything:
  they are rendered by a test runner whose stdout is not a terminal, so they
  contain no escape sequence at all and never could have caught the magenta.
  `test/golden-colour.test.tsx` states a terminal instead of being run in one,
  and `golden/chrome-truecolor.txt` is the frame with the colour left in.

## Wave E1 — the app's shape

- [x] **E1.1** The first task above everything on a window with nothing
  connected; the toolbar drawn only when there is something to act on. `AX-01`,
  `AX-05`
  — the bar draws what works first and draws nothing when nothing works. The
  last button keeping it alive was **Recheck targets**, which acts on the list
  of targets, so it moved onto the list.
- [x] **E1.2** Destinations that need a project say so on the navigation, and one
  invitation to open one replaces seven walls. `AX-04`
  — and two of the seven did not need one. Which screens are a project's is
  `needsProject` in the model now, not "everything under Automations and
  Activity": Agents and tools is about the sessions an agent holds.
- [x] **E1.3** Say takes a sentence in the app. The grounding half is `TV-T07c`'s
  and stays out of scope; the field, the history and the zero state are not.
  `AX-02`
  — the line is held and said to be held, in the same words the cockpit uses.
- [x] **E1.4** Disconnect is available wherever a session is open, in every mode.
  `AX-03`
  — it asked for `selected`, a parameter only Do's session list sets. A session
  being open is a fact about the broker; when exactly one is, the action does
  not need to be told which, and when more than one is it says so.
- [x] **E1.5** Adapters become a status with one disclosure; the MCP
  configuration block leaves the first screen. `AX-06`
  — "Ready here" is a sentence; the rest are behind *Other ways to connect*
  with the command each needs, which is the adapter's own probe `install` and
  not a description of the condition. It had to be threaded through the
  contract to get here.
- [x] **E1.6** The window is used at every size: the main region grows, and a
  context column arrives where there is room. `AX-17`
  — measured in the packaged window at 1920, 1440, 1100, 760 and 420. It found
  the narrow end: at 420 the rail's minimum and the inspector's came to 400 of
  the 420 there were, and the work was **four pixels wide**.
- [x] **E1.7** Screens for observing, for handing a target to an agent and taking
  it back, for healing, and for a run's report. `AX-18`
  — all four exist; what did not was anything checking they could be *got to*.
  Reachability is a closure from the rail through the actions' own `goTo`, and
  the first version of it reported Heal review unreachable because it only
  looked one hop deep.
- [x] **E1.8** Recents separate the person's projects from the app's scratch
  workspaces. `AX-12`
  — two causes: a directory under the user-data directory is the app's own, and
  a directory that is gone is nowhere to go back to. The three in the
  walkthrough were this suite's temporary projects, recorded when it drove the
  packaged app and deleted when it finished.

## Wave E2 — what a screen reader hears

- [x] **E2.1** Capitals move to `text-transform`; no accessible name begins
  mid-sentence. `EX-03`
  — they were already `text-transform`, and that is the finding: **Chromium
  puts `text-transform` into the accessible name**, so the rule was satisfied
  and the defect was there anyway. `font-variant-caps: all-small-caps` is a
  font feature and changes no text. The walk now reads `none` where it read six
  shouted names.
- [x] **E2.2** Headings carry levels; a heading that is not drawn is not
  published. `AX-09`
  — the inspector's sections were `h3` under an `h1`, which is a skipped level,
  and the undrawn `OTHER` went with the adapter catalogue it belonged to. The
  level was readable through Yam all along: `AXHeading` carries it in `AXValue`,
  and the first version of the walk's rule read a field no adapter publishes and
  therefore called every outline flat.
- [x] **E2.3** No table is published before it has rows. `AX-10`
  — 6 tables, 15 rows and 106 cells on a window with nothing connected are now
  nought, nought and nought. The zero state keeps the list's id and name, so a
  flow addresses the same thing whether or not it has anything in it.
- [x] **E2.4** `collapsed` only for roles that can expand, in
  `adapter-ax/src/tree.ts`. `EX-04`
  — `expanded` is kept whatever the role: the negative is what Chromium
  volunteers for everything, the positive is something a control said about
  itself. Every control in the window announced collapsed; two do now.
- [x] **E2.5** An ambiguous process name is reported as ambiguity, not as
  absence. `EX-07`
  — a third answer beside `no-window` and `no-process`, carrying the pids, with
  a way out. The script's own walk already visited every process of the name; it
  just had nowhere to say that more than one had answered.

## Wave E3 — words

- [x] **E3.1** Every zero state names an action; the guarantees that are not
  instructions stay as they are. `AX-07`, `CX-04`
  — thirty-odd of them, and the rule is scoped to zero states after two earlier
  formulations measured nothing and then too much. "This project compiles clean"
  is exempt, written down, with its reason.
- [x] **E3.2** Every screen names where its work goes. `AX-16`
  — Settings was the one that did not: its status was a directory path, which
  says where you are. It names `yam.config.yaml` now.
- [x] **E3.3** No sentence twice on a screen; the "browser, app, device or API"
  copy goes everywhere it survives. `EX-05`
  — it promised a device this machine has no driver for. What is ready is named
  by the discovery panel, which asks the host rather than the copy.
- [x] **E3.4** A check for prose naming a screen the model does not have.
  `EX-06`
  — it found three beyond the one the walkthrough saw: two view titles still
  reading "Surfaces" and "Record review", and a cockpit pane drawing the second
  as its heading.

## Wave E4 — the cockpit

- [x] **E4.1** The four properties checked in a pseudo-terminal: a key that can
  only refuse is not reachability. `CX-01`
  — `packages/tui/test/zero-states.test.ts`, which found five instructions
  naming a key bound on a different screen, all five written an hour earlier by
  E3.1, plus one that predates the wave: "press H to heal", where the key is
  `h`.
- [x] **E4.2** The rail strip stays and is held to the same rule as the app's
  navigation. `CX-03`
  — a bracket rather than a colour, because a monochrome terminal has to carry
  it too, and from the same `needsProject` table the app reads.
- [x] **E4.3** Modes are the model's in both renderers. `CX-05`
  — `tools/repo-checks/test/action-modes.test.ts` already held the cockpit to
  it; the app's half is now checked too, because the Playwright case that
  claimed to was counting buttons and `AX-05` made that count nought.

## Wave E5 — the record

- [x] **E5.1** Re-run the walkthrough and diff it against 2026-09-11's. `EX-N2`
  — it is a command now (`evals/self/yam-on-yam/app-walk.mjs`) and it reports
  ten measurements against what each read on 2026-09-11. All ten changed, on a
  build packaged after every wave.
- [x] **E5.2** The wave record: what running it found, what each check would have
  caught, and which rules still cannot tell the new design from the old. `EX-N3`
  — `progress/wave-1.md`.
