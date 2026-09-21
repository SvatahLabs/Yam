# Changelog

Yam is a monorepo of packages that release together, so this file is the
whole workspace's changelog and every package version below is the same number.
It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-09-19

### Security

- **An agent over MCP acts under its own name, and cannot force a handoff.**
  `surface_act`, `surface_request` and `surface_control` took a `holder`, and
  `surface_control` a `force`, so an agent could act as `Yam desktop` through a
  hold the person had taken, or take the target from them. Both arguments are
  gone from the MCP tools; the holder is the name the client gave with ` (MCP)`
  after it, so no spelling of a name passes for a person's client, and an agent
  cannot close a session somebody else holds. The desktop and the terminal still
  take a target back.
- **Secrets stay out of what a session is promoted from.** A value typed into a
  password field (web, macOS, iOS, Android), or named in `surface_act`'s new
  `secrets`, is withheld from the trajectory and from the steps "Save as
  automation" compiles; so is the field's own value in a description, a read or
  a check, and a web password field's value in a snapshot. The trajectory
  compiler turns a withheld typed value into a `secret` input and leaves any
  step carrying part of one for a person to write. Before, a password typed with
  an intent reached `trajectory.jsonl`, and the next snapshot read it back.
- **A declared secret is redacted from its own session's answers only**, and a
  secret shorter than three characters only where it is the whole value. The
  broker's redaction replaced until nothing matched, so a secret such as `E`,
  which the placeholder `[REDACTED]` itself contains, never returned and stopped
  the broker every client shares; and one client's secrets blanked words out of
  every other session.
- **Screenshots no longer write where they are told.** `surface_screenshot` took
  any `path` while annotated read-only, and `surface_act` with the `screenshot`
  action did the same; a terminal's screenshot is text, so either could
  overwrite a file. The tool writes into the server's own directory, and the
  action is refused over MCP.

- **An agent starts and drives only what the person configuring the server
  allowed.** Over MCP, `surface_connect` started any program with any arguments,
  drove any running application and opened any URL. It now starts no program
  unless `--allow-program` names it (a terminal's program, or an application
  launched by bundle or path — each one named is checked), drives no running
  application unless `--allow-app` names it, opens `http`, `https` and `about:`
  pages however the URL is passed (and `file:` with `--allow-file-urls`),
  uploads no local file without `--allow-upload`, joins only a browser on
  loopback, and refuses a second session on an application or browser somebody
  else holds (`CONTROL_BUSY`; the rest are `PERMISSION_REQUIRED`). A terminal an
  agent starts gets a shell's environment rather than the broker's, and
  `surface_connect`, `surface_act` and `surface_request` are annotated
  destructive.
- **The HTTP adapter sends a cookie where a browser would.** One jar was sent
  with every request, so a cookie an application set went to any absolute URL a
  caller named. Cookies now keep their `Domain`, `Path`, `Secure` and expiry and
  are matched by one rule shared with the browser adapters — whose own
  Playwright filter had sent host-only cookies to every subdomain. A request to
  a link-local or cloud metadata address — `169.254.0.0/16`, `fe80::/10`,
  `fd00:ec2::/64`, `100.100.100.200`, `168.63.129.16`,
  `metadata.google.internal`, NAT64 forms of them, directly, by a name that
  resolves to one, or by a redirect — is refused unless
  `YAM_HTTP_ALLOW_LINK_LOCAL=1`. Loopback and private networks are unaffected.
- **A project's own code runs only where it is trusted.** Loading a project
  imports the files under `steps/`, so opening a repository somebody else wrote
  — `yam` in it, the desktop, `yam serve`, an MCP server — ran their code; and a
  run started the program its config launches and the Playwright config it
  carries. An untrusted project now loads without its custom steps and warns
  (`W_STEP_UNTRUSTED`), and a run that would start its other code is refused.
  `yam trust` trusts a directory, `yam init` trusts the project it makes, the
  desktop asks when a person opens one, and `CI=true` (or `1`) or
  `YAM_TRUST_PROJECT=1` trust without asking — `CI` not for the MCP server.

### Added

- **Signed, notarized installers, when the owner provides certificates.** The
  desktop build signs and notarizes for macOS and signs for Windows when the
  signing secrets are present (`docs/project/signing.md` names them), and says
  it is unsigned when they are not. macOS gets a DMG beside the ZIP, and the
  release builds an Intel Mac leg as well as Apple silicon.
- **The Surfaces inspector copies what it would do.** "Copy command" and "Copy
  MCP call" copy a `yam surface act` line and an MCP `surface_act` call for the
  action in the form, with the value of a password field read from
  `YAM_SECRET` rather than written into either.
- **A screenshot preview you can click to select.** The session pane can show a
  picture of the target beside its tree; clicking selects the element under the
  pointer, and never clicks the application. The box-to-pixel scale is inferred
  and the preview says how. The service serves the picture at
  `GET /sessions/:session/screenshot.png`.
- **The agent connection test speaks MCP.** "Test the connection" starts the
  server command the panel tells people to configure, performs the MCP handshake
  and lists the tools, and says what it checked (`POST /agents/test`). It used to
  check the broker only.
- **Three nightly CI legs that have never run before:** the Linux AT-SPI desktop
  conformance gate on a virtual display, the Appium adapter's conformance subset
  in Android Chrome on an emulator, and the self-parity gate ("Yam verifies
  Yam"). They run on the schedule and on dispatch, and fail rather than pass when
  their host cannot run them.
- `yam trust [dir]`, with `--revoke`, `--status` and `--list`.
- `waitFor` with no reference waits for the page: `text`, `url` or `title`.
- `launch.inheritEnv` on a session, for a program started with a shell's
  environment only.
- `AgentSurface.cookies(url)`, optional: the cookies a session would send.

### Changed

- An action an adapter can never perform is refused as `UNSUPPORTED_OPERATION`,
  before dispatch when its capability flag is false, and a platform permission
  nobody granted is `PERMISSION_REQUIRED`; `yam surface` exits 22 for both. They
  were `TIMEOUT`, `CONNECT_FAILED` or `OUTCOME_UNKNOWN`, which tell a caller to
  retry or to check whether something happened. Adapters throw the new
  `UnsupportedError` and `PermissionError`. The conformance suite's `throws`
  accepts a list of error names, and `app.no-navigation` accepts
  `UnsupportedError` or `NavigationError`; a runner that implements the suite's
  context itself receives that list.

### Fixed

- `Call the "x" API with the session cookies` sends the run's browser cookies
  for the request's URL. It sent the HTTP adapter's own cookies whether or not
  the phrase was there, and never the browser's, so an API call after a sign-in
  in the browser was not signed in.
- `waitFor` on an element waits for `attached` and `detached` for real; the
  Playwright adapter waited for the element to stop moving, and BiDi's
  `attached` held only for a visible element. And a flow's `Wait for X to be
  hidden` (or present, absent, enabled, disabled) passes that state to the
  adapter at all: every such step waited for visible.
- `Call the "x" API without cookies` sends no cookies, not even the ones an
  earlier API response set.
- The Playwright adapter's snapshot reads a control's value wherever Playwright
  prints it, so a filled field shows its value, and a password field — in a
  shadow root or a child frame too — shows `[REDACTED]`.
- `deselectOption` on macOS and Windows selected the option it was asked to
  deselect; it is refused. On Appium, `hover` and `release` tapped the element,
  and are refused; a web view's `scrollIntoView` scrolled nothing, and a native
  one swiped once whatever the element, and now swipes until it is on screen.
- AT-SPI's `check` answers from the window as it is now rather than the last
  snapshot, and `absent` holds for an element that has gone.
- The AT-SPI readiness probe asked `gdbus --version`, which `gdbus` does not
  have, so every Linux host was told GLib was missing; and the AT-SPI adapter
  acted on the first window of the first application on the bus, whichever it
  was. It acts on the application it read.
- The Appium adapter asks for WebDriver Classic, which WebdriverIO 9 otherwise
  replaces with a BiDi session that UiAutomator2 and Android ChromeDriver can
  refuse.
- `surface_screenshot` returns the image, or a terminal's text, and not only a
  file name an agent over HTTP cannot open; an adapter that reports a screenshot
  and writes none is an error.
- `surface_targets` marks a target ready by the adapter's probe rather than the
  platform table: `appium` and `bidi` said `ready: true` beside a probe, in the
  same answer, that said neither was reachable. A probe that found nothing is
  asked again after ten seconds, so installing what it named is noticed.
- The seven `yam_*` tools are offered only when the MCP server has a project.
  Without one they were listed and could only answer that they needed one.
- A browser that will not launch says `npx playwright@<version> install
  chromium`, pinned to the Playwright that failed, instead of `pnpm exec
  playwright install`, and `yam run` suggests the same command.
- `act`'s `secrets` is in the operation catalogue, so the HTTP API's description
  names it.
- CI fails a desktop conformance or Yam-on-Yam leg that exits 2, "the suite did
  not run". It passed with a warning, from when hosted macOS runners were
  believed unable to grant Accessibility; they grant it.
- CI runs the published `@svatah/yam-mcp` from npm nightly, in an empty
  directory: the README's browser install, `surface doctor`, and one page
  connected and read over the protocol (`scripts/registry-mcp-smoke.mjs`).

## [0.1.0] — 2026-09-15

The first release, and the first under the name **Yam** (Draft 2.18): the
product was renamed before anything was published, so no package has ever
existed under another name. Svatah is the brand and the npm organisation; every
package is `@svatah/yam` or `@svatah/yam-<name>`. **Published to npm on
2026-09-15**, with provenance, by the release workflow's publish job (T8.5):
`node scripts/publish.mjs` prints the 36 exact `npm publish` commands, one per
package of the release set in `scripts/lib/release-packages.mjs`, and stops
unless `--publish`, a GitHub `workflow_dispatch` and a publish identity (trusted
publishing, or `NPM_TOKEN`) all hold. Before that, `pnpm release:dry-run` packed
the tarballs, and `pnpm quick-start:packed` installed the module (a) four into an
empty Playwright project outside this workspace and recorded, ran and healed
there. npm accepts about 25 new packages a day from one organisation, so the
last ten went out a day after the first 25, from the same commit.

**Verifying the publish is one command** (T12.5). `pnpm quick-start:registry`
asks the registry whether the four module (a) packages are there at this
version; when they are, it installs them **by name, with no overrides** into an
empty project and runs the same quick start — which is the last thing nobody can
test beforehand, because a `workspace:*` that escaped into what was uploaded
fails there and nowhere else. Run after the publish, it installed them from the
registry and recorded three bindings in 4.0 s.

The git tag `v0.1.0` marks the published commit, and the GitHub release carries
the installers, the tarballs and the reports.

**What is measured**, and where the number is:

| | |
|---|---|
| Compiler, exact match | 98.0 % overall over **303** pairs; tier 1 100 % (250/250), tier 2 88.0 % (`reports/eval-compiler.md`) |
| macOS Accessibility conformance | conformant — 10 cases across app variants 0, 1 and 2, live against the packaged app; 1017 nodes in 1488 ms, 1.46 ms per node at load average 5.15 over 8 CPUs (`reports/adapter-ax.md`) |
| Yam verifies Yam | 100 % agreement over the 29 checks both sides reach; Yam 30 of 48, external 47 of 48 (`reports/self-parity.md`) |
| Java runtime conformance | artifacts valid, zero mismatches (`reports/runtime-java.md`) |
| Healing, grounding, adapter conformance | `reports/eval-healing.md`, `reports/eval-grounding.md`, `reports/eval-conformance.md` |
| Tier 2 fine-tune | **not met**, and withdrawn — see below (`reports/eval-finetune.md`) |

### Published packages

Every package below is `0.1.0`, Apache-2.0, and ships `dist/`, its type
declarations and its README and nothing else.

| Set | Packages |
|---|---|
| Module (a) — the adoption wedge (REQ-PKG-1) | `@svatah/yam-bindings`, `@svatah/yam-healer`, `@svatah/yam-playwright-test`, `@svatah/yam-bindings-cli`, and their dependencies `@svatah/yam-schema`, `@svatah/yam-surface`, `@svatah/yam-adapter-playwright`, `@svatah/yam-conformance` |
| The command line — module (b) | `@svatah/yam`, whose bin is `yam`, and its workspace dependencies |
| The MCP server (REQ-AGT-1) | `@svatah/yam-mcp`, whose bin is `yam-mcp`. Nothing depends on it, so it is asked for by name rather than reached through a closure |
| The published contract (REQ-STD-1, 2) | `@svatah/yam-schema`, with the generated JSON Schemas under `json/` and the runtime conformance fixture under `conformance/` |

`yam` and `@svatah/yam-desktop` are the two things a person runs, and `yam-mcp`
is the one an agent runs; every other package is a library another package
depends on.

### Added

- **Module (a)** — bindings, model-free relocalization, and `bind()` for plain
  Playwright tests. One dependency and one import: `test` comes from
  `@svatah/yam-playwright-test` instead of `@playwright/test` (REQ-PKG-1, REQ-PKG-2).
- **The flow language and the compiler** — thirty sentence patterns over three
  tiers, a deterministic Tier 1 grammar, and a plan that compiles to the same
  bytes twice (REQ-COMP-7).
- **The runtime** — policies, guards, compensation, checkpoints, resume, and a
  redacted audit log.
- **Behaviors** — one plan run as a test, a workflow, or an agent tool.
- **The agent surface** — one published interface over Playwright, WebDriver
  BiDi, HTTP, Appium, Windows UI Automation and macOS Accessibility, with a
  conformance suite anyone can run against their own adapter (REQ-SURF-3,
  REQ-STD-2).
- **The recorder** — model grounding through a gateway, with every decision
  carrying its provenance and reviewable before anything is written.
- **The app** — an Electron application over the local service, eleven screens,
  installers on three operating systems.
- **A foreign runtime** — `runtimes/java`, conformant against the published
  fixture and writing the published schemas (REQ-STD-3).

### Fixed in Phase 7

The corrections the Phase 6 adversarial verification required, each reproduced
before it was fixed:

- **The macOS Accessibility bridge could not read a window inside the surface's
  deadline.** It asked for one attribute per Apple event — 650 ms per node — so
  the app's smallest window took ten seconds and the live gate failed 0 of 7. It
  reads in bulk now: 10.4 ms per node, measured (LLD §7.5).
- **The Java runtime's artifacts were not in the published schemas.** Every line
  of `results.jsonl` lacked `startedAt`, `endedAt` and `durationMs`, and the
  conformance suite never looked. The runtime writes full records and the suite
  validates before it compares (LLD §14).
- **`Dismiss the dialog` accepted the dialog.** The grammar emitted
  `args.action` and the adapters read `args.accept`, which nothing carried, and
  defaulted to accept. Both read `action` now, and refuse a step without one
  (LLD §3.2).
- **The desktop healing cases** T6.1 asked for and Phase 6 dropped: the app
  gains `YAM_A11Y_VARIANT=1|2`, and a binding recorded against the real
  interface relocalizes against both (LLD §16).
- **`pnpm -r typecheck` was red** in three packages and outside the verification
  contract. Both fixed (LLD §16).
- **The Windows UI Automation bridge never bound its request.**
  `powershell.exe -Command <script> -Request <json>` appends the argument to the
  script as text; every call would have died with a parser error. Four defects
  found by running the scripts through a real PowerShell.
- **The desktop gate script** resolved `--report` against the wrong directory
  and waited a fixed eight seconds for a window that takes fifteen.

### Fixed in Phase 8

The corrections the Phase 7 adversarial verification required — it scored 7.9 and
found that the *packaged* product could not open a project — each reproduced
before it was fixed:

- **The packaged app could not open a project.** It spawned `process.execPath` to
  run `yam serve`; packaged, with the `RunAsNode` fuse off, that is the app
  itself, so the child was a second app that printed no handshake. The runtime is
  resolved from `YAM_NODE`, then a `node` on `PATH` of Node 22 or newer, then
  a Node beside the CLI under `resources/`, and the Project screen's alert names
  all three when none is found (LLD §13.6). The packager now ships the CLI, which
  it never did; `YAM_APP_PROJECT=<dir>` opens a project on ready; and the
  smoke check runs against the packaged application.
- **The macOS Accessibility bridge missed its budget on the screen the budget is
  about.** Phase 7's 10.4 ms per node was measured on the menu-bar tree; the
  app's project screen cost 51–55 ms per node, about 25 s for one snapshot. The
  window read is a native helper now — `AXUIElement` directly, no Apple events —
  at **1.5–1.7 ms per node for 588 nodes** (LLD §7.5).
- **The macOS desktop conformance gate is green**: 7 of 7 flow cases and both
  healing cases, live, against the packaged app. `reports/adapter-ax.md`.
- **A `dialog` step arms the *next* dialog**, and the reference now says so.
  `W_DIALOG_UNARMED` and `W_DIALOG_NEVER_OPENED` in lint, and an audit line when
  a dialog is answered with nothing armed (LLD §3.2, §4.2).
- **The bridge honoured its own deadline rather than the caller's**, a case with
  no checks was not reported as having none, and healing cases were scored at a
  variant they cannot mean anything at. All three fixed.

### Withdrawn from 0.1.0

- **The Tier 2 fine-tune.** ADR-4's five-point target is **not met** — measured
  86.8 % → 13.2 % — the tuned adapter is not used, and no package depends on
  one. Every published compiler number is the base model's. The diagnosis is the
  training set: 83 pairs, all of them sentences the grammar *accepts*, against a
  tier that exists for the ones it refuses. `evals/compiler/refused.jsonl` — 184
  reviewed pairs of a refused sentence and the step it means — is the corpus that
  would make another attempt worth making, and `yam eval finetune corpus`
  reports it. `reports/eval-finetune.md`.

### Known gaps

Recorded rather than closed, with the command that closes each in
`docs/spec/progress/phase-8.md`:

- No screenshot was taken through the macOS adapter on this host: `screencapture`
  needs the Screen Recording grant, which is separate from Accessibility.
  `yam surface doctor` reports it as an advisory check.
- The desktop installers are not signed or notarized, so macOS and Windows warn
  before opening them.
- The Python and Java clients are not on PyPI or Maven Central.

Closed since this entry was written: the Windows UI Automation gate runs on a
hosted Windows runner in CI and is conformant, 10 cases across variants 0, 1
and 2, and so is the macOS one on a hosted macOS runner. The reports attached to
the release, and `reports/adapter-uia.md`, predate those runs.

[0.2.0]: https://github.com/SvatahLabs/Yam/releases/tag/v0.2.0
[0.1.0]: https://github.com/SvatahLabs/Yam/releases/tag/v0.1.0
