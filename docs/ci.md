# Continuous integration, and the three-OS matrix

Status: T12.4 · For the repository owner

Two legs of this project's CI have never run, and both need a machine this
project cannot create for itself:

| Leg | Needs | Where it is defined |
|---|---|---|
| **macOS AX desktop gate** | a macOS host with the Accessibility permission granted to the runner agent | `bitbucket-pipelines.yml` → `custom: desktop-gates` → `ax-gate`; `.github/workflows/ci.yml` → `desktop-conformance` (macos-latest) |
| **Windows UIA desktop gate** | a Windows host | the same two, `uia-gate` / `desktop-conformance` (windows-latest) |
| **ADE installers** | macOS and Windows hosts | `.github/workflows/ci.yml` → `ade-installers` |

Everything else — the workspace build, the tests, the lint, the quick start, the
Java runtime conformance, the generated clients' smoke, the model evals — runs
today on Bitbucket's hosted Linux runners on every branch and pull request.

This document is the whole of what somebody has to do. **It is a decision and
about twenty minutes**, and the decision is the first section.

---

## 1. The choice: attach runners, or mirror to GitHub

Both work. They are not equivalent.

| | Self-hosted Bitbucket runners | Mirror to GitHub |
|---|---|---|
| Machines you provide | two: a Mac and a Windows box, kept online | none — GitHub's hosted `macos-latest` and `windows-latest` |
| Cost | your hardware and your electricity; Bitbucket runner minutes are free for self-hosted | free for a public repository; billed minutes for a private one, and macOS minutes are billed at 10× |
| The AX gate | **works**, because you can grant Accessibility to the runner agent | **exits 2**, because a GitHub-hosted macOS runner has no way to grant it (see §4) |
| The UIA gate | works | works — UI Automation needs no grant |
| The ADE installers | needs the makers' toolchains on your machines | works out of the box |
| Ongoing work | keeping two machines patched and online | none |

**The recommendation is both, and in this order.** Mirror to GitHub first: it is
fifteen minutes and it turns the Windows gate and all three installer legs green
without buying anything. Then attach one self-hosted macOS runner, because the
AX gate is the only leg that a hosted runner genuinely cannot do — and it is the
gate REQ-ADP-7 is about.

---

## 2. Mirror to GitHub

The workflows are already written and already kept in step with
`bitbucket-pipelines.yml` by `tools/repo-checks/test/ci.test.ts`. Nothing in the
repository needs editing.

1. Create the repository on GitHub. It may be empty; do **not** let GitHub add a
   README, a licence or a `.gitignore`, because the push below is not a merge.

   ```bash
   gh repo create <owner>/svatah --private --disable-wiki
   ```

2. Push every branch and tag from this checkout:

   ```bash
   git remote add github git@github.com:<owner>/svatah.git
   git push github --all
   git push github --tags
   ```

3. Keep it in step. Either push to both remotes by hand, or set up Bitbucket's
   mirroring (Repository settings → Repository details → **Links** → *Mirror
   repository*), or add the second URL to `origin` so one `git push` reaches
   both:

   ```bash
   git remote set-url --add --push origin git@bitbucket.org:<workspace>/svatah.git
   git remote set-url --add --push origin git@github.com:<owner>/svatah.git
   ```

4. Nothing else. `.github/workflows/ci.yml` runs on `push` and on
   `pull_request`, and the matrix legs pick up GitHub's hosted runners.

**What turns green:** `ade-installers` on all three OSes, `desktop-conformance`
on `windows-latest` (the UIA gate), and every Linux job a second time.
`desktop-conformance` on `macos-latest` will exit 2 and be tolerated — read §4.

---

## 3. Attach a self-hosted runner to the Bitbucket workspace

Do this on the Mac. The same six steps work on Windows with the obvious changes;
`runs-on` labels are in `bitbucket-pipelines.yml` beside each step.

1. **In Bitbucket:** Repository settings → **Runners** → *Add runner*.
   - System: **macOS**, Architecture: **arm64** (or **x86_64** on an Intel Mac).
   - Labels: `self.hosted` and `macos` — these are exactly the labels the
     `ax-gate` step's `runs-on:` lists, and a label mismatch makes the step
     *queue* rather than fail.
   - Bitbucket shows a `docker run` line and an OAuth client id and secret.
     Keep the page open; the secret is shown once.

2. **On the Mac:** do **not** use the Docker line. A container has no
   WindowServer, so an Electron application launched inside one never gets a
   window and the AX gate exits 2 for a reason that has nothing to do with your
   machine (LLD §7.5, measured). Download the runner archive instead:

   ```bash
   mkdir -p ~/svatah-runner && cd ~/svatah-runner
   curl -fL -o runner.tar.gz \
     https://product-downloads.atlassian.com/software/bitbucket/pipelines/atlassian-bitbucket-pipelines-runner-1.tar.gz
   tar -xzf runner.tar.gz
   ```

3. **Run it as the logged-in user, in a graphical session.** Not as a `launchd`
   daemon and not over SSH: a process outside the user's Aqua session cannot
   open a window an accessibility client can read, which is the whole of
   LLD §7.5's warning and the whole of P8-F1. Log in on the machine, open
   Terminal, and:

   ```bash
   cd ~/svatah-runner
   ./bin/start.sh \
     --accountUuid '{<workspace-uuid>}' \
     --repositoryUuid '{<repository-uuid>}' \
     --runnerUuid '{<runner-uuid>}' \
     --OAuthClientId '<client-id>' \
     --OAuthClientSecret '<client-secret>' \
     --workingDirectory './temp'
   ```

   To survive a reboot, use a **launch *agent*** (`~/Library/LaunchAgents/`),
   never a launch daemon, and leave the machine logged in with the display
   awake. `caffeinate -disu` in the same session keeps it awake; a locked
   display is not a usable one, and `svatah surface doctor --adapter ax` will
   say so in those words.

4. **Grant Accessibility to the runner's Terminal.** System Settings → Privacy
   & Security → **Accessibility** → add the application that runs the runner
   (Terminal, or iTerm, or whatever you started `start.sh` from) and switch it
   on. Then, in that same terminal:

   ```bash
   node packages/cli/dist/bin.js surface doctor --adapter ax
   ```

   It must say `ax/accessibility granted` and `ax/session N application(s) own a
   window`. If it says `refused`, the grant is on the wrong application — the
   grant follows the *process that runs the tests*, not the runner archive.

5. **Screen Recording is separate and optional.** The same Privacy & Security
   pane, **Screen & System Audio Recording**. Without it the adapter still reads
   the accessibility tree and the gate is still conformant; only screenshots are
   missing, and `surface doctor` reports that rather than failing.

6. **Run the gate**, from Bitbucket: Pipelines → *Run pipeline* → branch
   `master` → **custom: desktop-gates**.

For Windows, repeat 1, 2 and 6 with System **Windows**, labels `self.hosted` and
`windows`, and skip 3 to 5: UI Automation needs no permission and no graphical
login beyond a normal interactive session.

---

## 4. Why the AX gate cannot go green on a hosted macOS runner

It is worth writing down, because it looks like a configuration problem and is
not.

The macOS Accessibility permission is granted per-application, by a person, in
System Settings, and it is recorded in a TCC database that is protected by System
Integrity Protection. There is no supported command that grants it, and
`tccutil` only *resets*. A GitHub-hosted macOS runner gives you a fresh VM with
no way to click that switch.

So `scripts/desktop-conformance.mjs` exits **2** there, and both CI files treat
exit 2 as "this runner cannot host the gate" and pass the leg with a message.
Exit 1 — "the adapter is not conformant" — always fails it. The two are never
confused, which is what T7.2 was about.

This is why §1 recommends one self-hosted Mac even after mirroring: it is the
only way REQ-ADP-7's live number gets measured by anything but a person's
laptop.

---

## 5. What to record when a runner exists

The task this document belongs to (T12.4) asks for the pipeline runs and their
reports. Both legs publish an artifact:

| Leg | Artifact | What to read first |
|---|---|---|
| `ax-gate` | `reports/adapter-ax.md` | the **Bridge** line: nodes, wall time, ms per node, **and the one-minute load average with the CPU count**. A per-node cost without the load beside it is not a number (LLD §7.5). |
| `uia-gate` | `reports/adapter-uia.md` | the same line, and whether any variant was retried |
| `ade-installers` | the makers' output | that each OS produced an installer at all |

Paste the two reports into `docs/spec/progress/phase-12.md` under T12.4 and
T12.6, with the runner's model and OS version beside them. A conformance number
whose machine is not named cannot be compared with anybody's.

---

## 6. Status on the branch that wrote this

Nothing here has been performed. Creating accounts, attaching runners and
mirroring repositories are the owner's actions, and this document exists so each
is one step rather than an afternoon.

- `custom: desktop-gates` — **blocked**: no self-hosted runner is attached to the
  Bitbucket workspace. The step queues rather than failing, which is why it lives
  in a `custom:` pipeline and not the default one.
- `ade-installers` — **blocked**: it exists only in `.github/workflows/ci.yml`
  and this repository has no GitHub remote.
- The macOS AX gate has been run **by hand on the implementer's host** and is
  conformant; `reports/adapter-ax.md` is that run. The Windows UIA gate has
  never run anywhere.
