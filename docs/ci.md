# Continuous integration, and the two desktop gates

Status: T12.4, revised for Draft 2.18 · For the repository owner

The repository lives at `github.com/SvatahLabs/Yam` and GitHub Actions is the
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
| `app-installers` | ubuntu, macOS, Windows | the app packages on all three and the packaged app opens a project (REQ-ADE-6) |
| `desktop-conformance` (windows, uia) | Windows | the Windows UI Automation gate (REQ-ADP-6) |
| `desktop-conformance` (macos, ax) | macOS | the macOS Accessibility gate (REQ-ADP-7) |
| `yam-on-yam` | macOS | Yam drives the packaged Yam through the command line and MCP |
| `registry-mcp` | ubuntu, **nightly** and on dispatch | the published `@svatah/yam-mcp` from npm, in an empty directory: the README's browser install, `surface doctor`, and one page connected and read over the protocol |
| `self-parity` | macOS, **nightly** and on dispatch | Yam verifies Yam: every check in `evals/self/checks.yaml` run through Yam and through an external oracle, passing only at 100 percent agreement (REQ-SELF-2). **Never run in CI before** — only by hand, as `pnpm self` |
| `desktop-conformance-linux` | ubuntu, **nightly** and on dispatch | the Linux AT-SPI gate (SF-23), against the packaged app on a virtual display. **Never run live before**, so AT-SPI is unvalidated until it has — its first run is the first time the AT-SPI bridge talks to a real registry anywhere |
| `appium-emulator` | ubuntu with an Android emulator, **nightly** and on dispatch | Android Chrome replays the Appium adapter's conformance subset against the sample application (REQ-ADP-5). **Never run live before** — every earlier test of the adapter drove a fake device |
| `grounding-eval` | ubuntu | replays the committed answer cache; never spends |
| `model-evals` | ubuntu, on the schedule | the grounding and healing numbers against the real gateway, with the repository's `ANTHROPIC_API_KEY` — it skips, saying so, while the repository has none, which is today |

Nothing here needs a machine the owner provides.

The three legs marked nightly do not run on a push or a pull request, so none of
them can block one. That is because none of them has been green yet, not because
they are advisory: each fails its leg when its gate could not run — exit 2 from
the two adapter gates, a run that compared nothing from `self-parity` — exactly
as the desktop legs fail on exit 2. Once one has been green on the schedule it
belongs beside its neighbours — the Linux leg as a third entry in
`desktop-conformance`'s matrix. §5 says what each needs and how to run it by hand.

## 2. The macOS AX gate, and the runner it would need if hosted macOS stopped granting it

This page used to say a hosted macOS runner could not grant the Accessibility
permission. It can: the scheduled run of 2026-09-16 (run 35051197120) printed
`ax/accessibility granted` in its doctor step, the ax leg reported *conformant —
10 cases across variants 0, 1 and 2*, and Yam-on-Yam reached 118 of its 119
checks on the same kind of runner.

So `scripts/desktop-conformance.mjs` exiting **2** — "this runner cannot host the
gate" — fails the leg, as exit 1, "the adapter is not conformant", always has
(T7.2). It used to pass with a warning, which would have kept the leg green over
a gate that had stopped running.

If a future hosted image stops granting it, attach one Mac. About twenty minutes:

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

## 3. What each desktop leg publishes

Each desktop leg publishes an artifact:

| Leg | Artifact | What to read first |
|---|---|---|
| macOS, ax | `reports/adapter-ax.md` | the **Bridge** line: nodes, wall time, ms per node, and the one-minute load average with the CPU count. A per-node cost without the load beside it is not a number (LLD §7.5). |
| Windows, uia | `reports/adapter-uia.md` | the same line, and whether any variant was retried |
| Linux, atspi (nightly) | `reports/adapter-atspi.md`, what the app printed at each launch, its `app-debug.log`, and the Xvfb and registry logs | on a failure, the launch logs first: nobody has yet seen what this leg prints when it works |

Paste the reports into the current phase's progress record with the runner's
model and OS version beside them. A conformance number whose machine is not
named cannot be compared with anybody's.

## 4. Status

- Every leg in §1 runs on hosted runners, on every push and on the nightly
  schedule — except `model-evals`, which runs on the schedule and on a manual
  dispatch — and was green at `669430e` and in the scheduled runs after it.
  `self-parity`, `desktop-conformance-linux` and `appium-emulator` were added
  after that, run only on the schedule and on dispatch, and have no green run
  yet.
- Both desktop gates are conformant in CI. The reports committed under
  `reports/` are older, hand-run ones; the current ones are the
  `desktop-conformance-ax` and `desktop-conformance-uia` artifacts of the latest
  run.

## 5. The three nightly legs, and running each by hand

### `desktop-conformance-linux` — the AT-SPI gate

AT-SPI is unvalidated until this leg has passed once: the
[support matrix](reference/generated/support-matrix.md) says so, and nothing
here is evidence that it works. `scripts/desktop-conformance.mjs --adapter atspi` launches the packaged app with
`YAM_A11Y=1` and `ACCESSIBILITY_ENABLED=1` (the second is what Chromium's AT-SPI
connection reads on Linux), finds it on the accessibility bus by the process id
it launched, and runs the same three passes the other desktop legs do. It needs:

- a display — a desktop session, or Xvfb;
- a session D-Bus, with toolkit accessibility on and `org.a11y.Bus` answering;
- `at-spi2-registryd` running on the accessibility bus;
- `python3` with `pyatspi` (`python3-pyatspi`, `gir1.2-atspi-2.0`), which is
  what the adapter's bridge and the gate's own probes run;
- the packaged app, with `chrome-sandbox` root-owned and setuid on a host where
  Chromium cannot use unprivileged user namespaces (Ubuntu 24.04 is one).

It exits 2, naming the missing piece, before it launches anything if one is
absent. On a Debian or Ubuntu desktop:

```bash
sudo apt-get install at-spi2-core python3-pyatspi gir1.2-atspi-2.0 libglib2.0-bin
gsettings set org.gnome.desktop.interface toolkit-accessibility true
pnpm install --frozen-lockfile && pnpm -r build
pnpm --filter @svatah/yam-desktop package
sudo chown root:root apps/desktop/out/Yam-linux-x64/chrome-sandbox
sudo chmod 4755 apps/desktop/out/Yam-linux-x64/chrome-sandbox
node packages/cli/dist/bin.js surface doctor --adapter atspi
node scripts/desktop-conformance.mjs --adapter atspi --report reports/adapter-atspi.md
```

Without a desktop — a server, a container, or what CI does — make the session
first, in the shell that will run the two commands above:

```bash
sudo apt-get install xvfb dbus-x11 gsettings-desktop-schemas dconf-gsettings-backend
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp & export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"
gsettings set org.gnome.desktop.interface toolkit-accessibility true
gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus \
  --method org.freedesktop.DBus.Properties.Set org.a11y.Status IsEnabled '<true>'
/usr/libexec/at-spi2-registryd &
python3 -c 'import pyatspi; print(pyatspi.Registry.getDesktop(0).childCount)'
```

The last line printing a number is the registry answering. What the app printed
at each launch is written beside the report as `atspi-app-variant-N.log`.

### `appium-emulator` — Android Chrome through Appium

`scripts/appium-conformance.mjs` is `packages/adapter-appium/README.md`'s
emulator gate as one command. It does not start Appium or the emulator; it asks
for a booted device with Chrome on it, an Appium server that says it is ready and
`webdriverio` resolving from the adapter, serves the sample application on port
4173 (the emulator reaches it at `10.0.2.2`), runs the README's twelve-case
subset through `yam surface conform --adapter appium`, and writes
`reports/adapter-appium.md`. Exit 2 is a missing piece, 1 a failed case — or a
case in the subset the suite no longer has.

CI pins Appium 2.19.0 and UiAutomator2 driver 4.2.9 (the last driver release
that admits Appium 2), and boots an API 34 x86_64 `google_apis` image, which
ships Chrome. By hand, with the Android SDK installed:

```bash
npm install -g appium@2.19.0
appium driver install --source=npm appium-uiautomator2-driver@4.2.9
appium --port 4723 --allow-insecure chromedriver_autodownload &
emulator -avd <an API 34 Google APIs AVD> -no-window -no-snapshot &
adb wait-for-device
pnpm install --frozen-lockfile && pnpm -r build
node scripts/appium-conformance.mjs --report reports/adapter-appium.md
```

`YAM_APPIUM_URL` points it at a server elsewhere, `ANDROID_SERIAL` at one device
of several, and `YAM_APPIUM_CAPS` is merged over the capabilities it sends.

### `self-parity` — Yam verifies Yam

`yam eval self` without `--update`: the parity report goes to the runner's
temporary directory and is uploaded as the `self-parity` artifact, the sources'
own reports go to a temporary directory of the command's, and the job then
checks that `reports/` is exactly what was checked out. It fails on a
disagreement (exit 1) and on a run in which no check was reached by both sides.
On a Mac with the Accessibility permission granted:

```bash
pnpm install --frozen-lockfile && pnpm browsers && pnpm -r build
pnpm --filter @svatah/yam-desktop package
node scripts/seed-app-recents.mjs
node packages/cli/dist/bin.js eval self --report /tmp/self-parity.md
```

`pnpm self` is the same run with `--update`, which refreshes the committed
reports and is for a person, not for CI.
