# Continuous integration, and the two desktop gates

Status: T12.4, revised for Draft 2.18 · For the repository owner

The repository lives at `github.com/SvatahLabs/yam` and GitHub Actions is the
only CI. `.github/workflows/ci.yml` runs on every push and pull request;
`.github/workflows/release.yml` runs on a tag or a manual dispatch and is the
only place a publish can happen (`scripts/publish.mjs`, T8.5).

## 1. What runs on GitHub's hosted runners, today

| Job | Runner | What it proves |
|---|---|---|
| `workspace` | ubuntu, macOS, Windows | the six-command contract, the licence check, compatibility, privacy mode, the examples (REQ-NFR-7) |
| `quick-start` | ubuntu | the ten-minute quick start, timed, and the committed bindings reproduce (REQ-PKG-2) |
| `runtime-conformance` | ubuntu with a JDK | the Java runtime writes the published schemas and agrees with the fixture (REQ-STD-3) |
| `clients-smoke` | ubuntu with a JDK and a Python | the generated clients have not drifted and drive a live service (REQ-SDK-1, 2) |
| `ade-installers` | ubuntu, macOS, Windows | the ADE packages on all three and the packaged app opens a project (REQ-ADE-6) |
| `desktop-conformance` (windows, uia) | Windows | the Windows UI Automation gate (REQ-ADP-6) |
| `desktop-conformance` (macos, ax) | macOS | **exits 2 on a hosted runner** — see §3 |
| `grounding-eval` | ubuntu | replays the committed answer cache; never spends |
| `model-evals` | ubuntu, on the schedule | the grounding and healing numbers against the real gateway, with the repository's credential |

Nothing here needs a machine the owner provides, except the one leg below.

## 2. The macOS AX gate needs a self-hosted runner

The macOS Accessibility permission is granted per application, by a person, in
System Settings, and recorded in a database that System Integrity Protection
guards. No command grants it and `tccutil` only resets. A hosted macOS runner is
a fresh virtual machine with nobody to click the switch, so
`scripts/desktop-conformance.mjs` exits **2** there, and the workflow treats exit
2 as "this runner cannot host the gate" and passes the leg with a message. Exit 1,
"the adapter is not conformant", always fails it (T7.2).

Attaching one Mac turns the leg green. About twenty minutes:

1. **In GitHub:** the organisation's Settings → Actions → **Runners** → *New
   runner* → macOS, arm64 (or x64 on an Intel Mac). Give it the labels
   `self-hosted`, `macOS` and `ax-gate`. GitHub shows the download and
   configure commands; keep the page open, the token is short-lived.

2. **On the Mac, in a graphical session as the logged-in user**, run the
   commands GitHub showed to download and configure the runner. Do not use a
   container and do not run it as a launch daemon or over SSH: a process
   outside the user's Aqua session cannot open a window an accessibility client
   can read (LLD §7.5, P8-F1). To survive a reboot use a launch *agent*
   (`~/Library/LaunchAgents/`), leave the machine logged in, and keep the
   display awake with `caffeinate -disu` in the same session. A locked display
   is not a usable one, and `yam surface doctor --adapter ax` says so.

3. **Grant Accessibility to the application that runs the runner** (Terminal,
   or whatever started `run.sh`): System Settings → Privacy & Security →
   **Accessibility**. Then, in that same terminal:

   ```bash
   node packages/cli/dist/bin.js surface doctor --adapter ax
   ```

   It must say `ax/accessibility granted` and `ax/session N application(s) own a
   window`. If it says `refused`, the grant is on the wrong application: it
   follows the process that runs the gate, not the runner directory.

4. **Screen Recording is separate and optional.** The same pane, **Screen &
   System Audio Recording**. Without it the adapter still reads the accessibility
   tree and the gate is still conformant; only screenshots are missing, and
   `surface doctor` reports that rather than failing.

5. **Point the leg at the runner.** In `ci.yml`, the macOS entry of
   `desktop-conformance`'s matrix names its runner; change its `os` from
   `macos-latest` to the label set `[self-hosted, macOS, ax-gate]` and the next
   push runs the gate there. `tools/repo-checks/test/ci.test.ts` still requires
   the two legs to have different hosts and to run no test suite beside the
   gate (T12.1).

## 3. What to record when the runner exists

Both desktop legs publish an artifact:

| Leg | Artifact | What to read first |
|---|---|---|
| macOS, ax | `reports/adapter-ax.md` | the **Bridge** line: nodes, wall time, ms per node, and the one-minute load average with the CPU count. A per-node cost without the load beside it is not a number (LLD §7.5). |
| Windows, uia | `reports/adapter-uia.md` | the same line, and whether any variant was retried |

Paste the two reports into the current phase's progress record with the runner's
model and OS version beside them. A conformance number whose machine is not
named cannot be compared with anybody's.

## 4. Status

- The Windows UIA gate and the three installer legs run on hosted runners as
  soon as the repository is pushed to GitHub (T13.1, T13.2).
- The macOS AX gate has been run by hand on the implementer's host and is
  conformant; `reports/adapter-ax.md` is that run. It goes green in CI when the
  owner attaches the runner above.
