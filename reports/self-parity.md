# Svatah verifies Svatah — the parity gate

Run at 2026-09-06T19:36:31.789Z on darwin arm64, Node v25.6.1.

**100 percent agreement** over the 29 check(s) both sides reached. The gate passes only at 100 percent (REQ-SELF-2).

| | Svatah | External |
|---|---|---|
| Checks reached | 30 of 48 | 47 of 48 |
| Wall time | 216.6 s | 422.0 s |

## Disagreements

None. Every check both sides reached, they answered the same way.

## One-sided checks — Svatah's own shortcomings

Every one names the adapter or the step Svatah lacks, and the list is
expected to shrink phase by phase (LLD §13.9). A row whose reason is the
*host* — a locked display, a refused permission — is not a shortcoming of
either side: it is what this machine could not be asked, said in the
doctor's own words rather than guessed at (P10-F1, P10-F5).

| Check | Reached by | Why the other side does not |
|---|---|---|
| `ade.launch-open-read-quit` | Svatah | no Playwright case launches or quits the application: `_electron.launch` cannot open a packaged build with the `RunAsNode` fuse off (T8.1), so the ADE's own suite attaches to a build somebody else started. Launching and quitting is what T11.2 gave Svatah and the external side does not have. |
| `gate.desktop-conformance` | external | the gate *is* Svatah's surface conformance suite, driven by a script that launches three ADE variants and carries recorded fingerprints between them. A flow cannot relaunch its own application at a different variant mid-run: `app.launch` opens the session, and there is no sentence for a second one. |
| `cockpit.pseudo-terminal` | external | driving a terminal needs a pseudo-terminal adapter, and Svatah has none: the surface kinds are `web`, `desktop`, `mobile` and `http` (LLD §2.4). `script(1)` and `ink-testing-library` are the external side. |
| `cockpit.json-is-the-model` | external | the same missing adapter: a flow cannot run a command and read its stdout. `svatah ui --json` is the SDK's own answer and comparing it with the model is a program, not a flow. |
| `clients.generated-smoke` | external | an HTTP flow could call the service's routes, and it would be testing the *service* rather than the clients. What the smoke checks is that three generated clients agree, which is a comparison between programs and not something a flow observes. |
| `design.artboards-fit` | external | the artboards are HTML files rendered headless, not an application with a window; there is nothing for a desktop adapter to attach to and no service for an HTTP one. A `web` flow could open them, and it would still need geometry assertions over sets (see the toolbar checks). |
| `oracle.axe-sheet` | external | external by design (REQ-SELF-3). |
| `oracle.healing-ground-truth` | external | external by design (REQ-SELF-3). |
| `oracle.tree-agreement` | external | external by design (REQ-SELF-3). |
| `ade.record-on-the-flows-screen-starts-a-session-with-the-fake-ga` | external | the Record button starts a recording session, and a recording session is what a Svatah *run* is not: `svatah record` and `svatah run` are different commands, and a flow cannot ask for one from inside the other. |
| `ade.run-on-the-flows-screen-starts-a-run-and-opens-the-run-scree` | external | pattern 19 now waits on a service's answer, so the *sentence* exists. What is missing is the request: the ADE's own service listens on a port it chose at start-up, and an `api/` request names a URL. A flow that could ask the ADE which port it is on would close this one. |
| `ade.the-run-screen-shows-the-run-s-steps-audit-and-inspector` | external | needs a run to read, and starting one means starting a Svatah run from inside a Svatah run: the click works, and what is missing is a sentence that waits for a *second* run to finish and reads its result. The screen itself is reachable and every control on it is bound. |
| `ade.the-run-toolbar-keeps-its-buttons-on-one-line-however-long-t` | external | a *geometry* assertion — box heights and right edges across the toolbar's children. `Expect … to have size/location` exists for one element (pattern 24); comparing two elements' boxes does not. |
| `ade.the-inspector-says-each-of-its-headings-once` | external | pattern 32 quantifies over a set — `Every`, `No` — and this needs a *count*: "each heading appears once" is a uniqueness claim, and neither quantifier can say it. An `Exactly one …` or a `… should be unique` is the sentence that would close it. |
| `ade.the-audit-pane-renders-the-call-detail-the-model-carries` | external | pattern 32 can now assert over the audit's rows, and what it cannot assert is their *shape*: the case matches each row against a regular expression, and the predicate set has no regex outside a scope guard (pattern 29's `matches`). The rows also only exist while a run is in flight, which is the second half of the same gap. |
| `ade.run-again-is-a-button-on-the-run-screen-and-it-starts-anothe` | external | the button is bound and clickable; what cannot be asserted is that a second run started, because a flow has no sentence that waits for a run other than its own and reads its result. |
| `ade.a-run-started-from-the-run-screen-can-be-stopped-from-it-t10` | external | needs a run in flight to stop, which means starting a Svatah run from inside a Svatah run — and no sentence waits for a second run or reads its state while it is going. |
| `ade.a-flow-is-edited-and-saved-through-the-ade-and-re-linted-k6` | external | Draft 2.15 gave `Type` its multi-line value, which was the sentence this needed. What is left is the *restore*: the case rewrites a file in the committed fixtures project and puts it back, and a flow that failed between the two would leave the checkout modified. `onFailure: compensate:<flow>` is the mechanism (REQ-AUTO-4) and no compensating story is written, so this stays the external side's. |
| `ade.a-saved-api-request-is-edited-and-saved-through-the-ade-k7` | external | adds a header by filling the blank last row of a table, and addressing "the last row" of a growing list is a positional target the language has no sentence for. |

## Kept external by design (REQ-SELF-3)

Three oracles sit *below* the surface Svatah drives, and they are what keeps
this gate from grading its own homework.

| Oracle | Why it stays external |
|---|---|
| `oracle.axe-sheet` | REQ-SELF-3. axe-core is a second implementation of the accessibility rules Svatah's own audit implements; checking one with the other is the point, and checking either with Svatah would be checking a thing with itself. |
| `oracle.healing-ground-truth` | REQ-SELF-3. The ground-truth key is stamped on the sample application *outside* the surface and `bindings.ignoreAttributes` removes it from synthesis, fingerprints and `native` — so nothing Svatah can see may know the answer. A self flow that could read it would be the eval finding the answer in the answer key. |
| `oracle.tree-agreement` | REQ-SELF-3. This is the check that the *adapter's picture of a window is the window*: its two sides are the DOM Chromium renders and the accessibility tree macOS publishes from it, and Svatah is in neither. Every other check goes through something Svatah wrote. |

## Every check

| Check | Svatah | External | What it says |
|---|---|---|---|
| `ade.launch-open-read-quit` | pass | unreachable | Svatah launches the packaged ADE, opens the fixtures project through its Recent list, reads the Flows toolbar, and quits it. |
| `ade.screen-through-two-adapters` | pass | pass | The same flow drives the ADE's Flows screen through the accessibility tree and through the DOM over CDP. |
| `gate.desktop-conformance` | unreachable | pass | The live macOS desktop conformance gate is conformant at ADE variants 0, 1 and 2. |
| `cockpit.pseudo-terminal` | unreachable | pass | `svatah ui` draws its panes in a real pseudo-terminal and its `--json` equals the model's state. |
| `cockpit.json-is-the-model` | unreachable | pass | `svatah ui --json` prints exactly what the screen model loads, ten times without a diff. |
| `clients.generated-smoke` | unreachable | pass | The generated Python and Java clients drive the local service and agree with the TypeScript SDK. |
| `design.artboards-fit` | unreachable | pass | Every artboard fits its own frame: one-row toolbars, a twelve-character title, an inspector that contains its contents. |
| `oracle.axe-sheet` | unreachable | pass | axe-core and the in-house audit both report zero violations on the component sheet. |
| `oracle.healing-ground-truth` | unreachable | pass | The healing eval recovers a degraded binding onto the element the ground-truth key names. |
| `oracle.tree-agreement` | unreachable | pass | The ADE's renderer tree over CDP and its accessibility snapshot agree about every identified control's role and name. |
| `ade.opens-into-the-new-flows-screen-not-the-eleven-tabs` | pass | pass | opens into the new Flows screen, not the eleven tabs |
| `ade.every-interactive-control-on-the-flows-screen-is-named-and-i` | pass | pass | every interactive control on the Flows screen is named and id'd (P8-F3) |
| `ade.record-on-the-flows-screen-starts-a-session-with-the-fake-ga` | unreachable | pass | Record on the Flows screen starts a session with the fake gateway |
| `ade.run-on-the-flows-screen-starts-a-run-and-opens-the-run-scree` | unreachable | pass | Run on the Flows screen starts a run and opens the Run screen |
| `ade.the-run-screen-shows-the-run-s-steps-audit-and-inspector` | unreachable | pass | the Run screen shows the run's steps, audit and inspector |
| `ade.the-run-toolbar-keeps-its-buttons-on-one-line-however-long-t` | unreachable | pass | the Run toolbar keeps its buttons on one line, however long the title |
| `ade.the-inspector-says-each-of-its-headings-once` | unreachable | pass | the inspector says each of its headings once |
| `ade.the-audit-pane-renders-the-call-detail-the-model-carries` | unreachable | pass | the audit pane renders the call detail the model carries |
| `ade.run-again-is-a-button-on-the-run-screen-and-it-starts-anothe` | unreachable | pass | Run again is a button on the Run screen, and it starts another run |
| `ade.a-run-started-from-the-run-screen-can-be-stopped-from-it-t10` | unreachable | pass | a run started from the Run screen can be stopped from it (T10.4) |
| `ade.the-command-palette-opens-on-k-and-lists-the-registry-s-acti` | pass | pass | the command palette opens on ⌘K and lists the registry's actions |
| `ade.flows-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | flows opens and every control on it is named and id'd |
| `ade.runs-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | runs opens and every control on it is named and id'd |
| `ade.bindings-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | bindings opens and every control on it is named and id'd |
| `ade.agents-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | agents opens and every control on it is named and id'd |
| `ade.api-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | api opens and every control on it is named and id'd |
| `ade.data-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | data opens and every control on it is named and id'd |
| `ade.import-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | import opens and every control on it is named and id'd |
| `ade.settings-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | settings opens and every control on it is named and id'd |
| `ade.record-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | record opens and every control on it is named and id'd |
| `ade.run-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | run opens and every control on it is named and id'd |
| `ade.heal-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | heal opens and every control on it is named and id'd |
| `ade.explorer-opens-and-every-control-on-it-is-named-and-id-d` | pass | pass | explorer opens and every control on it is named and id'd |
| `ade.the-runs-screen-filters-and-its-inspector-shows-the-failing-` | pass | pass | the Runs screen filters, and its inspector shows the failing step's evidence |
| `ade.the-bindings-screen-shows-the-store-and-one-element-s-resolv` | pass | pass | the Bindings screen shows the store and one element's resolver order |
| `ade.the-heal-review-offers-the-runs-worth-healing` | pass | pass | the Heal review offers the runs worth healing |
| `ade.the-record-review-chooses-its-gateway-and-says-what-a-fake-s` | pass | pass | the Record review chooses its gateway and says what a fake session is |
| `ade.the-api-screen-shows-a-saved-request-and-its-headers` | pass | pass | the API screen shows a saved request and its headers |
| `ade.the-data-screen-names-every-secret-and-shows-none-of-them` | pass | pass | the Data screen names every secret and shows none of them |
| `ade.the-surface-explorer-refuses-a-call-with-no-intent` | pass | pass | the Surface explorer refuses a call with no intent |
| `ade.the-import-screen-previews-into-the-open-project-and-nowhere` | pass | pass | the Import screen previews into the open project and nowhere else |
| `ade.the-settings-screen-shows-the-project-and-never-a-credential` | pass | pass | the Settings screen shows the project and never a credential |
| `ade.the-agents-screen-lists-what-an-agent-may-call` | pass | pass | the Agents screen lists what an agent may call |
| `ade.the-legacy-screens-are-gone-t10-3` | pass | pass | the legacy screens are gone (T10.3) |
| `ade.the-record-screen-s-toolbar-keeps-its-title-its-select-and-a` | pass | pass | the Record screen's toolbar keeps its title, its select and availableWhen (P10-F3) |
| `ade.a-toolbar-that-runs-out-of-room-sheds-into-the-palette-and-s` | pass | pass | a toolbar that runs out of room sheds into the palette, and says so (P10-F3) |
| `ade.a-flow-is-edited-and-saved-through-the-ade-and-re-linted-k6` | unreachable | pass | a flow is edited and saved through the ADE, and re-linted (K6) |
| `ade.a-saved-api-request-is-edited-and-saved-through-the-ade-k7` | unreachable | pass | a saved API request is edited and saved through the ADE (K7) |

## The sources, and what each cost

| Source | Command | Wall | Answered about |
|---|---|---|---|
| `ade-playwright` | `npx playwright test --reporter=json` | 16.3 s | 38 name(s) |
| `artboards` | `node scripts/audit-artboards.mjs` | 0.8 s | 1 name(s) |
| `axe-sheet` | `node scripts/audit-sheet.mjs` | 0.6 s | 1 name(s) |
| `client-smoke` | `node scripts/smoke-clients.mjs` | 24.2 s | 1 name(s) |
| `desktop-gate` | `node scripts/desktop-conformance.mjs --adapter ax --report reports/adapter-ax.md` | 74.7 s | 1 name(s) |
| `healing-eval` | `node scripts/eval-healing.mjs --report reports/eval-healing.md` | 218.2 s | 1 name(s) |
| `svatah` | `node packages/cli/dist/bin.js run evals/self --host none` | 215.0 s | 26 name(s) |
| `svatah-cdp` | `node packages/cli/dist/bin.js run evals/self/cdp --host none` | 1.6 s | 1 name(s) |
| `tree-agreement` | `node scripts/tree-agreement.mjs` | 4.5 s | 1 name(s) |
| `tui-pty` | `npx vitest run test/tui-pty.test.ts --reporter=json` | 82.7 s | 78 name(s) |
