# Desktop conformance — `ax` (macOS Accessibility)

Status: **blocked on this host — no application has an accessible window.**
Date: 2026-09-04 · Adapter: `@svatah/adapter-ax` · Task: T7.1 (LLD §7.5, §14, §16, REQ-ADP-7, REQ-ADE-6)

## The command, and what it answered

```console
$ node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
ok    -/platform             darwin arm64, Node v25.6.1
ok    ax/accessibility       granted
The ADE was launched at variant 0 but showed no window within 60000 ms. That is a launch
failure, not an adapter failure, and it is reported as one so the report is not a list of
cases that never had anything to read.
Nothing was written to …/reports/adapter-ax.md.
`svatah surface doctor --adapter ax` said:
ok    -/platform             darwin arm64, Node v25.6.1
ok    ax/accessibility       granted

$ echo $?
2
```

The permission is **granted**. What is missing is a *display*: this session's
window server is unreachable, so no application on the machine has a window for
the accessibility API to describe.

```console
$ osascript -e 'tell application "System Events" to tell process "Finder" to count windows'
0
$ for p in Finder "Google Chrome" Claude Notes; do …count windows…; done
Finder: 0 | Google Chrome: 0 | Claude: 0 | Notes: 0
$ screencapture -x /tmp/s.png
could not create image from display
```

Every running application answers zero windows, and `screencapture` cannot read
the display at all — which is what a locked or detached session looks like. It
is not specific to the ADE, and it is not the Accessibility permission: the
assistive-access call `svatah surface doctor` makes succeeds, and so does
reading the ADE's own menu-bar tree (below).

**To close this gate**, on a macOS host with the Accessibility permission
granted *and* an unlocked display:

```bash
pnpm -r build
pnpm --filter @svatah/ade exec electron-forge package
node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md
```

It launches the ADE three times — at `SVATAH_A11Y_VARIANT` unset, 1 and 2 —
runs the seven conformance cases and the two healing cases, and writes the
seven-of-seven result, the two relocalization outcomes and the bridge's cost
into this file.

## What *was* measured live, on this host

The bridge itself was rewritten for T7.1 and measured against a real macOS
accessibility tree: the ADE's own **menu bar**, which is reachable without a
window. Same process, same bridge, same Apple events.

| | Phase 6 bridge | T7.1 bridge |
|---|---|---|
| Design | one Apple event per attribute per element | one bulk event per container |
| Cost per node | **650 ms** (verifier, ADE welcome window) | **10.4 ms** (199-node ADE menu-bar tree) |
| Apple events for that tree | ~17 × nodes | **103** |
| Wall time | 9.1–10.2 s for 35 nodes | **2.07 s** for 199 nodes |
| Process invocations per snapshot | 1 | 1 |

Extrapolated to the budget LLD §7.5 sets — the ADE's project screen, "at least
400 nodes, within 10 s" — the project screen is **488 nodes** (measured by
`scripts/record-desktop-tree.mjs`), which at 10.4 ms per node is about **5.1 s**.
The old design would have needed about five minutes. The budget is met with
room, but the number in the table above is the menu-bar tree, not the project
screen, and this report will not claim otherwise until the gate runs.

## The healing cases (LLD §16)

The two cases T6.1 asked for and Phase 6 dropped were implemented in T7.1 and
run against the ADE's recorded trees at variants 0, 1 and 2, through **both**
desktop adapters (`packages/cli/test/desktop-healing.test.ts`). Model-free
relocalization, `@svatah/bindings`' own weights and threshold — the same ones
`svatah eval healing` uses — with the ground-truth `automationId` excluded from
scoring.

| Case | Variant | Binding | Score | Threshold | Outcome |
|---|---|---|---|---|---|
| `ade.heal.renamed-control` | 1 | `screen-flows` tab, renamed *Flow editor* → *Editor* | 0.899 | 0.72 | relocalized |
| `ade.heal.renamed-control` | 1 | `project-open` button, renamed *Open a project…* → *Choose a project…* | 0.912 | 0.72 | relocalized |
| `ade.heal.moved-panel` | 2 | `record-gateway` combobox, moved into a *Session settings* panel | 0.817 | 0.72 | relocalized |

Every proposal was checked against the ground-truth key, not against its own
confidence: "recovered only when the keys match" (LLD §16).

### One measurement worth keeping

The tab rename was first written as *Flow editor* → **Flows**, which shares no
word with the original. Relocalization ranked the right tab first at **0.731**
— above the threshold — but the runner-up scored **0.644**, inside the 0.1
margin, so the healer answered **ambiguous** and refused. That is LLD §6.4
working as designed rather than a defect: eleven sibling tabs are identical
apart from their text, and with the text destroyed there is genuinely not
enough to tell them apart. The committed variant renames to *Editor*, which
keeps a word, and the number above is what that gives. A desktop control whose
entire identity is its label, in a row of look-alikes, is the boundary of
model-free healing on this platform.

## What this report does not say

- It does not say the AX bridge reads a live **window** correctly. The tree it
  was measured against is a menu bar, and the seven conformance cases have not
  been run against `AXUIElement` on this host.
- The healing outcomes are against **recorded** trees — the ones
  `scripts/record-desktop-tree.mjs` reads out of Chromium over the DevTools
  protocol — not against trees the bridge read. The conversion, the scoring and
  the cases are exercised; the bridge is not.
