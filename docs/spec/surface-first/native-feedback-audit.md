# The native adapter's feedback loop — an external computer-control assessment

**Assessed:** 2026-09-09 · macOS 26.3, darwin arm64, Node v25.6.1, `@svatah/yam` 0.1.0 installed globally
from this repository's build. The assessor drove `yam mcp` over stdio from a Python harness rather than
as a registered MCP client, and exercised five surfaces: `playwright` against a local form, `ax` against
Calculator and TextEdit, `process` against a `/bin/sh` pty, and `http` against example.com.

## What the assessment established

Yam controls this computer. The proof it kept is a TextEdit edit driven entirely through
`surface_connect` → `surface_act` that landed on disk (`cat /tmp/yamtest/scratch.txt` showed the typed
line), plus a browser round trip whose screenshot was rendered and read back, a pty whose typing and
screen-reading both worked, and a real `200 OK` over HTTP. The typed error taxonomy, the per-session
event log and `surface_describe`'s native identity all behaved as specified.

The defects it found are all in the **native** adapter, and all one shape: *an action reported success
without establishing that it had happened.* That is the failure mode automation can least afford,
because nothing downstream can detect it.

## The register

| ID | Verdict | Defect | Fix |
|---|---|---|---|
| D1 | Valid, fixed | `surface_screenshot` returned `status: "succeeded"` with a path and wrote no file. `screenshot()` spawned `screencapture` and resolved on `close` **or** `error`, inspecting neither the exit code nor the file. Without the Screen Recording grant `screencapture` exits 1 having written nothing — so an agent driving a native application was blind and was told it was not, while `yam surface doctor` reported the same host honestly one line above. | The bridge now checks the exit code *and* stats the file, removes a zero-byte artefact, and raises `AxBridgeError` naming the Screen Recording grant. `AxSurface.screenshot` wraps it as a `SessionError`, so a screenshot that did not happen is an infrastructure failure rather than a passing step. |
| D2 | Valid, fixed | `resizeWindow` returned `{ok: true}` unconditionally: it dispatched `setSize` and never re-read the frame. Reproduced on TextEdit (box identical before and after) and on Calculator, which is legitimately not resizable and for which the honest outcome is a refusal. | Both `ax` and `uia` now read the window's own box back after the resize. A size within a point of the request succeeds and returns the size actually taken; anything else raises `ActionabilityError`, distinguishing a window that did not move at all from one that clamped the request. |
| D3 | Valid, fixed | `surface_read {kind:"text"}` answered with the accessible **name** before the value, so TextEdit's text area — whose name is the document title — answered `"scratch.txt"` for a field holding `"Second pass ABC"`. `surface_check`'s `text` and `textContains` inherited it, so a true assertion about typed text failed with `actual "scratch.txt"`. | A shared `saidBy` in both native adapters inverts the preference for textual roles only (`AXTextField`/`AXTextArea`/`AXSecureTextField`, UIA `Edit`/`Document`): their words are the value, everything else keeps the name. A button still says its label. |
| D4 | Valid, fixed | `quit` could not be satisfied at runtime. It needed `app.launch.bundle`/`path`, which can only be named in `yam.config.yaml` before the session opens, so an application attached to by process name could never be quit. The refusal's reasoning — a quit by name alone would reach somebody else's copy — was sound but unanswerable. | A new optional `AxBridge.identify()` asks System Events which bundle the *attached* process was started from (`bundle identifier`, `application file`, pid). That resolves the ambiguity from the running process rather than guessing. When identity cannot be had, the honest refusal remains. |
| D5 | Not a defect in this code | Calculator's result display is absent from the AX tree, so `7 × 6 =` could not be confirmed. Calculator publishes only the small expression line; the main display is not an accessibility element. | Not fixable here — the application does not expose it. D1's fix restores the second route the assessment lacked: a screenshot now either works or says why. |

## Two more, found in answering "how does a user install and grant this?"

Neither was in the assessment. Both came out of walking the install and
permission path as a newcomer would.

| ID | Defect | Fix |
|---|---|---|
| D6 | The permission advice said "add the terminal (or the test runner) you are running from", which is correct and unusable: macOS attaches Accessibility and Screen Recording to the **responsible process**, and a reader who did not already know that cannot tell which of the programs on their screen it is. Nothing named it, and nothing could raise the prompt either — the only route offered was a settings pane. | `grant.ts` walks the process tree to the outermost application ancestor and names it, so the sentence became "add **iTerm** (`/Applications/iTerm.app`)". `yam surface grant` raises the real prompts through `AXIsProcessTrustedWithOptions` and `CGRequestScreenCaptureAccess`, reached with the JXA machinery `bridge.ts` already uses — no native module. `--dry-run` reports without spending the one prompt macOS allows. |
| D7 | `yam surface doctor` asked about `ax` and `uia` only, while `probeAdapter` — which `surface targets` and the support matrix read — asked about all eight. Two readiness reporters with different coverage, and every diagnostic pointed a stuck reader at the narrower one: someone whose first run failed for want of a browser was sent to a command with nothing to say about browsers. | The doctor now asks the probe for every adapter and groups each adapter's own checks beneath its `reachable` line. Reachability is **advisory** unless an adapter is named with `--adapter`, because a laptop with no Appium server is an ordinary laptop and a bare run that exited 1 on it would teach everyone to ignore the exit code. `--adapter` remains fatal, which is what `scripts/desktop-conformance.mjs` gates on. |

### Why there is no install-time prompt

The obvious request — prompt during `npm install` — cannot be met, and building
it would make things worse. TCC binds the grant to the application that owns the
process tree, so a prompt fired from a postinstall script grants whatever ran
`npm`: usually a terminal, and usually not the program that will later run
`yam mcp`. The grant would not transfer, and whoever clicked it would believe
they had already answered. `npm install --ignore-scripts` skips postinstall
outright, installs run headless in CI where a dialog can only hang, and each
prompt is shown once per application *forever* — so a dialog raised at the wrong
moment spends the only chance that application had.

The earliest moment the question can be asked correctly is the first time Yam
runs from the program that will drive the desktop, which is what `yam surface
grant` is for. The one place an install-time prompt does work is the signed
desktop app, where `Yam.app` is itself the responsible process.

## One correction to the report

The report states that "`surface_check` offers no way to assert against `value`". A `value` predicate does
exist and reaches the AX adapter (`packages/adapter-ax/src/predicates.ts`, `case "value"`), comparing
against `AXValue`. The reported symptom was real, but its cause was D3 alone: `textContains` answered from
the name. With D3 fixed, both `text` and `value` predicates answer from the right attribute.

## Left alone, deliberately

The assessment's section 5 lists behaviours that are correct but easy to get wrong, and they stay as they
are. Refs are per-snapshot-generation and are renumbered by position on every re-read, so a ref held
across an act may silently resolve to a different node rather than refusing; making that refuse means
generation-tagged references across every adapter, which is a contract change rather than a bug fix. The
same goes for `surface_connect` answering `sessionId` where every other tool takes `session`, and for
holder identity not persisting between `surface_control` calls.

Access is also unchanged: `npx -y @svatah/yam` still 404s because the package is not published, which is
[the owner's call](../../../README.md) and not a defect.

## What was verified, and what was not

Verified on this host: the full workspace suite, typecheck and lint pass; the shipped `IDENTIFY_SCRIPT`
was run through `osascript` against a live process and returned the expected bundle identifier, bundle
path and pid, and the executable path derived from it matched that same pid under `pgrep -f`; and the
new bridge test exercises the real `screencapture`, which on this machine fails exactly as the report
describes and is now raised rather than swallowed.

Not verified: the UIA half of D2 and D3 has no Windows host here and rests on the parity suite; and no
application was quit, so D4's fix is proven up to the point of addressing the right process, not through
termination.

For D6 and D7: both TCC scripts were run against this host through `osascript`, returning `true` for
Accessibility and `false` for Screen Recording — which matches what the doctor and the assessment both
say about this machine. `yam surface grant` was **not** run without `--dry-run`, deliberately: the prompt
it raises is a once-per-application event that cannot be given back, so the prompting path is covered by
tests with an injected runner rather than by spending this machine's remaining prompt. Every command in
[the getting-started guide](../../getting-started/install-and-first-control.md) was executed as written,
against a local page, and its output is what that page produced.
