# The experience: the app, the cockpit, and one brand

Status: **specified, not started**. Written from a walkthrough of 2026-09-11 in
which Yam drove the packaged Yam through the MCP tools with no project open —
`surface_connect --app Yam --adapter ax`, then `surface_snapshot` and
`surface_act` — and read every finding out of the application's own
accessibility tree. The evidence is in [the walkthrough](walkthrough.md); its
blockers are numbered `B1`–`B21` and every requirement cites the ones it closes.
The [prototype](../design/prototype) is the shape being specified, and it is
walkable.

Requirement ids: `EX-` for what is new and shared, `AX-` for the app, `CX-` for
the cockpit. Nothing is renumbered: five requirements written as `AX-*` turned
out to bind both renderers and are listed under *Shared* with their original ids.

## Why this exists

The screen model was built so two renderers could not disagree, and it succeeded:
34 interactive controls on the app's first screen, none unnamed. What nothing
asked was whether the *arrangement* matches what a person arrived to do. It does
not, and the walkthrough found three reasons:

1. **The room is arranged for the furniture.** The toolbar precedes the only task
   a new person can perform; the mode strip, which changes what the toolbar
   *means*, comes after it; the inspector offers an agent's MCP configuration
   before a first connection exists.
2. **Doors are drawn that do not open.** Seven of nine rail destinations, three of
   four toolbar buttons, four of five adapters and one of three modes are present
   and unusable, each discovered by trying it.
3. **The app says what it is, not what to do.** *"A sentence is grounded against
   the session already open and appended to the flow"* is true, and is not an
   instruction.

None is a defect of the model. All are consequences of a view laid out by its
component tree.

## What "usable" is taken to mean

A general word is not checkable, so it is four properties:

| Property | Means | Checked as |
|---|---|---|
| **Reachable** | Everything offered can be done from here | No enabled-looking control refuses |
| **Ordered** | Reading order matches the order of doing | Tree order of the first task's controls |
| **Honest** | What cannot be done is not offered as if it could | Blocked states declared before the click |
| **Instructive** | A dead end names the next keystroke | Zero states end in an action |

## Shared: one brand, one appearance

`EX-01` and `EX-02` are new. The five below them were written as `AX-*` when this
document covered the app alone and **keep those ids** — they turned out to bind
both renderers, which is a change of scope and not of identity. §0 of
[requirements.md](../requirements.md) says ids do not renumber, and re-lettering
them to `EX-*` was the first draft of this file doing exactly that while claiming
it had not.

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| EX-01 | P0 | **One palette across the product.** The app, the cockpit and the website are drawn from one set of values. Today they are two: `@svatah/yam-ui-tokens` is lavender on blue-grey (`#b8a1ff` on `#0f1216`) and the site is green on warm paper (`#7cc9ae`/`#357862` on `#111613`/`#fafbf9`). The site's values win, because a product's own site is its brand. A check fails when a token in `ui-tokens` disagrees with the site's stylesheet. |
| EX-02 | P0 | **Light, dark and system, everywhere.** `prefers-color-scheme` is the default and an explicit choice overrides it, in the app and in the terminal — a person who has chosen gets their choice, one who has not follows the machine. The cockpit reads the same preference and renders it at the depth the terminal admits to (`TV-05`). |
| AX-08 | P1 | **Visual styling is never an accessible name.** Capitals are `text-transform`; a name never begins mid-sentence because its subject is a sibling node. Closes `B3`, `B12`. |
| AX-11 | P1 | **A state means something.** `collapsed` is reported only for roles that can expand. This is the adapter, not the view: `packages/adapter-ax/src/tree.ts` passes Chromium's `AXExpanded=0` through for every control, so a screen reader says "collapsed" on every button in the window. Closes `B11`. |
| AX-13 | P2 | **One sentence, once.** No sentence appears twice on a screen, and none promises a capability the field beneath it does not take. Closes `B18`. |
| AX-14 | P1 | **A name that no longer exists is a defect.** A repository check fails when a rendered string names a screen the model does not have. `tools/repo-checks/test/screen-ids.test.ts` does the locator half; the prose half does not exist. Closes `B4`. |
| AX-15 | P2 | **An ambiguous target says so.** When more than one process answers to a name, the adapter reports the ambiguity rather than reporting that the application has gone. Closes `B21`. |

## The app

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| AX-01 | P0 | **The first task is first.** On a window with nothing connected, the controls that perform the only available task appear before any other interactive control in the accessibility tree, the navigation excepted. Closes `B9`, `B10`. |
| AX-02 | P0 | **No mode is empty.** Every way of working offers at least one enabled control that does that work. Say takes a sentence in the app, as `i` takes one in the cockpit. Closes `B5`. |
| AX-03 | P0 | **No reachable state is a trap.** From any state reachable without a project there is an enabled control that leaves it, and disconnecting is available wherever a session is open. Closes `B6`, `B7`. |
| AX-04 | P0 | **A closed door is drawn closed.** A destination that needs a project says so on the navigation, before it is clicked, and the app offers one invitation to open a project rather than seven identical walls. Closes `B2`. |
| AX-05 | P1 | **The toolbar shows what can be done.** An unavailable control is not drawn ahead of available ones, and a bar whose controls are all unavailable is not drawn. Closes `B8`. |
| AX-06 | P1 | **Adapters are a status, not a catalogue.** What is ready is named; what needs installing is behind one disclosure with the single command each needs. Closes `B19`, and stops `B20` being first on the screen. |
| AX-07 | P1 | **The screen tells you what to do, somewhere on it.** Not every sentence is an instruction — *"an unverified binding is never used without saying so"* is a guarantee and rewriting it would be worse — but a screen with no sentence naming an action is a screen that only describes itself. |
| AX-09 | P1 | **The outline nests.** Headings carry levels saying which section is inside which; a heading that is not drawn is not published. Closes `B13`, `B14`. |
| AX-10 | P1 | **Structure is not built before it has content.** An empty table is not published as a table; a pane with nothing in it publishes its zero state and no scaffolding. Closes `B15`. |
| AX-12 | P2 | **Recents are the person's.** The app's own scratch workspaces are not offered where projects a person made are. Closes `B1`. |
| AX-16 | P1 | **A screen says where its work goes.** It names a place the product has or the artifact its work produces. There is no journey diagram: a stepper across the top is what you print when the screens are not producing one, and it lies on every screen that is a place rather than a step. |
| AX-17 | P0 | **The window is used, at every size.** Responsive is two properties, not one: nothing is unreachable when the window is small **and** the space is used when it is large. The main region's width grows with the window; measured at 1920, 1440, 1100, 760 and 420. |
| AX-18 | P1 | **Every feature the product has is reachable from the app.** Observing, handing a target to an agent and taking it back, healing, and a run's report each have a screen. The walkthrough's narrative had none of them. |

## The cockpit

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| CX-01 | P0 | **The same four properties.** Reachable, ordered, honest, instructive, checked in a pseudo-terminal the way the app's are checked in its accessibility tree. `TV-02` already requires every action be reachable; this adds that a key which can only ever refuse is not reachability. |
| CX-02 | P0 | **The cockpit is on the brand.** `chrome()` renders `EX-01`'s palette, at 24-bit, 256 and monochrome. Today it renders `ui-tokens`' lavender, which is a second opinion about the product's colour. |
| CX-03 | P1 | **Where you are is on the screen.** The rail strip stays: a terminal has no window chrome to carry it, which is the argument that does *not* apply to the app. |
| CX-04 | P1 | **The zero states instruct.** Each names the key that changes it, as `AX-07` requires of the app. |
| CX-05 | P2 | **The two renderers agree about modes.** Which mode an action belongs to is the model's, read by both; `tools/repo-checks/test/action-modes.test.ts` holds them to it. |

## Non-functional

| ID | Priority | Requirement |
|---|---|---|
| EX-N1 | P0 | Every requirement above is checked by driving the packaged application and the cockpit through Yam's own public interfaces — `evals/self/yam-on-yam` and the pseudo-terminal suite — not by reading source. A usability rule only a person can see is one that regresses silently. |
| EX-N2 | P1 | The walkthrough is re-runnable and its output comparable between runs, so a change can be shown to have improved something rather than asserted to have. |
| EX-N3 | P1 | A check that passes on the design it replaces measures nothing. Every rule here is run against the previous artefact as well as the new one, and a rule that cannot tell them apart is marked as such rather than counted. |

## Not in scope

**New artwork or a new component library.** Every requirement is about
arrangement, honesty, wording and palette, and each is satisfiable inside the
existing design system.

**Teaching Yam.** Onboarding, tours and sample projects are a different problem.
This is about not obstructing somebody who already knows what they want.

**The website.** It is the source of the palette and is not changed by this.
