# Desktop conformance — `uia` (Windows UI Automation)

Status: **blocked — no Windows host.** Four defects found and fixed without one.
Date: 2026-09-05 · Adapter: `@svatah/yam-adapter-uia` · Task: T8.6 (carried from T7.2; LLD §7.5, §14, REQ-ADP-6, REQ-STD-2)

## The blocked command, and the host's answer

Re-attempted for T8.6 on 2026-09-05, unchanged:

```console
$ node scripts/desktop-conformance.mjs --adapter uia --report reports/adapter-uia.md
The "uia" adapter runs on win32 and this host is darwin, so the conformance suite was not run
and nothing was written to …/reports/adapter-uia.md.
Run this on a win32 host, or attach one as a runner (`bitbucket-pipelines.yml`, the
`desktop-gates` pipeline).
$ echo $?
2

$ node packages/cli/dist/bin.js surface doctor --adapter uia
ok    -/platform             darwin arm64, Node v25.6.1
ok    app/node-runtime       runtime: /opt/homebrew/bin/node (v25.6.1, from PATH)
skip  uia/platform           not Windows

$ which pwsh powershell powershell.exe
pwsh not found
powershell not found
powershell.exe not found
```

The only host available is macOS, and it no longer has the PowerShell 7 install
that T7.2's four defects were found through. `doctor` reports the adapter as
skipped rather than failed, which is the honest answer: UI Automation is not a
permission this machine has not granted, it is an API this machine does not
have.

The gate itself refuses the run now rather than launching an app and waiting a
minute for a window it could not have read (T8.6). Exit 2 is "the host is not
ready", which is the same code a missing macOS permission produces and a
different one from "the adapter is wrong".

**To close this gate**, on Windows:

```powershell
pnpm -r build
pnpm --filter @svatah/yam-desktop exec electron-forge package
node scripts/desktop-conformance.mjs --adapter uia --report reports/adapter-uia.md
```

`bitbucket-pipelines.yml` carries the leg as `custom: desktop-gates`, against a
self-hosted runner labelled `windows`; attaching one is the only step left.

## What was found anyway, by running the scripts against a real PowerShell

T7.2 says "the bridge scripts are untested against a real `UIAutomationClient`".
They were untested against a real **PowerShell**, too: every test in this
package injects its own runner, so nothing in the repository had ever spawned
one, and the live gate has never run (Phase 6 verification, F8, K10).

PowerShell 7.4.6 was installed on the macOS host and the four scripts were run
through it. It cannot do UI Automation — that is Windows — but it is the same
language, and it found four defects that would have failed **every call on
every Windows machine**.

### 1. The request never reached the script

```console
ParserError:
Line |
   6 |  -Request {"process":"Yam","maxNodes":1500}
     |                     ~~~~~~~~~~~~~
     | Unexpected token ':"Yam"' in expression or statement.
```

The bridge spawned `powershell.exe -Command <script> -Request <json>` and every
script began `param([string]$Request)`. That binds nothing. PowerShell's own
documentation: when `-Command` is a string it "must be the last parameter in
the command, because any characters typed after the command are interpreted as
the command arguments" — so the JSON was appended to the script as *text* and
parsed as PowerShell. Not one UIA call could ever have succeeded.

Fixed with `-EncodedCommand`: base64 of UTF-16LE, the request **assigned** in a
preamble with single quotes doubled, no argument list to get wrong.

### 2. Every non-ASCII name would have arrived mangled

A redirected `powershell.exe` writes stdout in the console code page; Node reads
UTF-8. The conformance target's own buttons are called **Open a project…** and
**Import prototype database…**. The preamble now sets
`[Console]::OutputEncoding` to UTF-8 as its first line, before anything writes.

Verified: `Yam — “Open a project…”` round-trips through
`encodePowershell` and back out of PowerShell byte for byte.

### 3. A one-pattern element answered a string, not a list

```console
one is String count=1
{"node":{"patterns":"P0"},"raw":"P0","wrapped":["P0"]}
```

PowerShell unrolls a single-element array on `return`, so `Get-PatternNames`
answered `"Invoke"` rather than `["Invoke"]` and `ConvertTo-Json` wrote a
string. The adapter then calls `patterns.includes("Value")` on it — which on a
string is a *substring* test, so a control supporting exactly one pattern would
have been driven through the wrong one, silently. Fixed with `return ,@($names)`
and `@(Get-PatternNames …)` at the call site.

### 4. A host without UI Automation produced no answer at all

`Add-Type -AssemblyName UIAutomationClient` under `$ErrorActionPreference =
"Stop"` killed the script before it wrote anything, and the bridge reported
"PowerShell answered something that is not JSON" — a diagnostic that sends the
reader to look at the adapter rather than at the host. All four scripts now
catch it and answer `{ ok: false, error: "no-uiautomation: …" }`, the way the
availability check already did.

And when PowerShell *does* write to a redirected stderr it writes **CLIXML**, a
serialised object stream, not text — so a real failure surfaced as a wall of
XML. `readablePowershellError` decodes it.

### After the fixes, on the macOS host

| Script | Parses | Runs | Answers valid JSON |
|---|---|---|---|
| `AVAILABILITY_SCRIPT` | yes | yes | yes — `{"ok":false,"error":"Cannot find path …UIAutomationClient.dll"}` |
| `WINDOW_SCRIPT` | yes | yes | yes — `{"ok":false,"error":"no-uiautomation: …"}` |
| `PERFORM_SCRIPT` | yes | yes | yes — `{"ok":false,"error":"no-uiautomation: …"}` |
| `SCREENSHOT_SCRIPT` | **no** | — | — |

`SCREENSHOT_SCRIPT` will not compile under PowerShell 7 on macOS: its
`[System.Windows.Forms.Screen]` and `[System.Drawing.…]` type literals do not
resolve there, and PowerShell reports it as "an error occurred while creating
the pipeline". Those types exist on Windows, so this is a limitation of the test
host rather than a finding — and it is listed here rather than left out, because
it is the one script of the four that this exercise could not check.

## What Phase 8 changed underneath this gate

Nothing in the UIA bridge, and three things in the harness it runs through, all
of which a Windows run will exercise for the first time:

- The gate launches the app with `YAM_APP_PROJECT` and waits for the
  **project screen**, not merely for a window (T8.1). On Windows that wait uses
  `Get-Process … MainWindowTitle`; on macOS it reads the accessibility tree.
- The packaged app resolves a Node runtime and bundles its own CLI (T8.1). The
  Windows packaged app has never been launched by this gate at all.
- A case with no checks is `skipped`, and each healing case is measured only at
  its own variant (T8.2). The UIA report's shape changes with it.

## What this report does not say

- It does not say the UIA adapter is conformant. Seven cases, two healing cases
  and the snapshot shape are all unrun against a real `UIAutomationClient`.
- It does not say the four fixes are sufficient. They are the defects a real
  PowerShell could see. What a real UI Automation tree does — the
  `ControlType` mapping, `AutomationId`, the pattern calls, the `controlPath` —
  remains exactly as unverified as it was, and everything below the bridge is
  covered by the recorded-tree suites in `packages/adapter-uia/test`.
