# The app a person meets first

Status: **specified, not started**. Written from a walkthrough of 2026-09-11 in
which Yam drove the packaged Yam through the MCP tools with no project open —
`surface_connect --app Yam --adapter ax`, then `surface_snapshot` and
`surface_act` — and read every finding out of the application's own
accessibility tree. The evidence is in [the walkthrough](walkthrough.md); its
blockers are numbered `B1`–`B21` and every requirement below cites the ones it
closes.

Requirement ids use the `AX-` prefix. §0 of [requirements.md](../requirements.md)
says ids do not renumber.

This document is about **usability**, which the existing specification has never
made a requirement. `REQ-ADE-6` asks that every control have a name and an id;
`REQ-ADE-12` that a status never be colour alone; `SF-17` that a zero state name
its next action. All three hold in the app today, and the app is still hard to
begin. Naming a control is not the same as knowing what to do with it.

## Why this exists

The screen model was designed so that two renderers could not disagree, and it
succeeded: 34 interactive controls on the first screen, none unnamed. What
nothing asked was whether the arrangement of those controls matches what a person
arrived to do. It does not, and the walkthrough shows three ways:

1. **The room is arranged for the furniture.** The toolbar precedes the only task
   a new person can perform; the mode strip, which changes what the toolbar
   *means*, comes after it; the inspector offers an agent's MCP configuration
   before the first connection exists.

2. **Doors are drawn that do not open.** Seven of nine rail destinations, three
   of four toolbar buttons, four of five adapters and one of three modes are
   present and unusable, and each is discovered by trying it.

3. **The app says what it is, not what to do.** *"A sentence is grounded against
   the session already open and appended to the flow"* is true, and is not an
   instruction.

None of these is a defect of the model. All of them are consequences of a view
that was laid out by its component tree.

## What "usable" is taken to mean here

Four properties, because a general word is not checkable:

| Property | Means | Checkable as |
|---|---|---|
| **Reachable** | Everything offered can be done from here | No enabled-looking control fails |
| **Ordered** | Reading order matches the order of doing | Tree order of the first task's controls |
| **Honest** | What cannot be done is not offered as if it could | Disabled/blocked states declared before the click |
| **Instructive** | Every dead end names the next keystroke | Zero states end in an action |

## Functional requirements

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| AX-01 | P0 | **The first task is first.** On a window with nothing connected, the controls that perform the only available task appear before any other interactive control in the accessibility tree, the rail excepted. Closes `B9`, `B10`. |
| AX-02 | P0 | **No mode is empty.** Every Session mode offers at least one enabled control that does that mode's work. Say mode takes a sentence in the app, as `i` takes one in the cockpit. Closes `B5`. |
| AX-03 | P0 | **No reachable state is a trap.** From any state a person can reach without a project, there is an enabled control that leaves it. Disconnecting is available in every mode while a session is open. Closes `B6`, `B7`. |
| AX-04 | P0 | **A closed door is drawn closed.** A rail destination that needs a project says so on the rail, before it is clicked, and the app offers one invitation to open a project rather than seven identical walls. Closes `B2`. |
| AX-05 | P1 | **The toolbar shows what can be done.** A control that is unavailable in the current state is not drawn ahead of controls that are available; a bar whose controls are all unavailable is not drawn. Closes `B8`. |
| AX-06 | P1 | **Adapters are a status, not a catalogue.** What is ready is named; what needs installing is behind one disclosure with the single command each needs. Closes `B19`, and stops `B20` from being the first thing on the screen. |
| AX-07 | P1 | **Every zero state ends in a keystroke.** The pattern "Enter a URL above and press Connect surface" is the rule for every empty pane, and prose that describes a mechanism without naming an action is not a zero state. Closes `B5`'s prose half. |
| AX-08 | P0 | **Visual styling is not an accessible name.** No accessible name is written in capitals for emphasis, and no name begins mid-sentence because its subject is a sibling node. Closes `B3`, `B12`. |
| AX-09 | P1 | **The outline nests.** Headings carry levels that say which section is inside which; a heading that is not drawn is not published. Closes `B13`, `B14`. |
| AX-10 | P1 | **Structure is not built before it has content.** An empty table is not published as a table; a pane with nothing in it publishes its zero state and no scaffolding. Closes `B15`. |
| AX-11 | P1 | **A state means something.** `collapsed` is reported only for roles that can expand. The adapter, not the app: `packages/adapter-ax/src/tree.ts` passes Chromium's `AXExpanded=0` through for every control. Closes `B11`. |
| AX-12 | P2 | **Recents are the person's.** The app's own scratch workspaces are not offered where projects made by a person are. Closes `B1`. |
| AX-13 | P2 | **One sentence, once.** No sentence appears more than once on a screen, and none promises a capability the field beneath it does not take. Closes `B18`, and the last of the "browser, app, device or API" copy. |
| AX-14 | P2 | **A name that no longer exists is a defect.** A repository check fails when a rendered string names a screen the model does not have. Closes `B4`; the static half exists as `tools/repo-checks/test/screen-ids.test.ts` and does not yet read prose. |
| AX-15 | P1 | **An ambiguous target says so.** When more than one process answers to a name, the adapter reports the ambiguity rather than reporting that the application has gone. Closes `B21`. |

## Non-functional

| ID | Priority | Requirement |
|---|---|---|
| AX-N1 | P0 | Every requirement above is checked by driving the packaged application through Yam's own public interfaces, in `evals/self/yam-on-yam`, not by reading the source. A usability rule that only a person can see is one that regresses silently. |
| AX-N2 | P1 | The walkthrough is re-runnable and its output is comparable between runs, so a change can be shown to have improved something rather than asserted to have. |

## Not in scope

**A visual redesign.** Nothing here asks for new artwork, a new layout system or a
new component. Every requirement is about arrangement, honesty and wording, and
each is satisfiable within the existing design system.

**The cockpit and the command line.** The same three faults may exist there. This
document is the app, because the app is where a person arrives first.

**Making the app teach Yam.** Onboarding, tours and sample projects are a
different problem. This is about the app not obstructing somebody who already
knows what they want.
