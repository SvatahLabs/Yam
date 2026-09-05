# Changelog

Svatah is a monorepo of packages that release together, so this file is the
whole workspace's changelog and every package version below is the same number.
It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — unreleased (release candidate)

The first release candidate. **Nothing is published to a registry**: T7.6's
release candidate is packed tarballs, a release workflow that stops at the
artifact step, and a quick start that runs from the tarballs. `pnpm
release:dry-run` produces them; `pnpm quick-start:packed` installs the module
(a) four into an empty Playwright project outside this workspace and records,
runs and heals there.

### Published packages

Every package below is `0.1.0`, Apache-2.0, and ships `dist/`, its type
declarations and its README and nothing else.

| Set | Packages |
|---|---|
| Module (a) — the adoption wedge (REQ-PKG-1) | `@svatah/bindings`, `@svatah/healer`, `@svatah/playwright-test`, `@svatah/bindings-cli`, and their dependencies `@svatah/schema`, `@svatah/surface`, `@svatah/adapter-playwright`, `@svatah/conformance` |
| The command line — module (b) | `@svatah/cli` (published as `svatah`) and its twenty-five workspace dependencies |
| The published contract (REQ-STD-1, 2) | `@svatah/schema`, with the generated JSON Schemas under `json/` and the runtime conformance fixture under `conformance/` |

`svatah` and `@svatah/ade` are the two things a person runs; every other package
is a library another package depends on.

### Added

- **Module (a)** — bindings, model-free relocalization, and `bind()` for plain
  Playwright tests. One dependency and one import: `test` comes from
  `@svatah/playwright-test` instead of `@playwright/test` (REQ-PKG-1, REQ-PKG-2).
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
- **The ADE** — an Electron application over the local service, eleven screens,
  installers on three operating systems.
- **A foreign runtime** — `runtimes/java`, conformant against the published
  fixture and writing the published schemas (REQ-STD-3).

### Fixed in Phase 7

The corrections the Phase 6 adversarial verification required, each reproduced
before it was fixed:

- **The macOS Accessibility bridge could not read a window inside the surface's
  deadline.** It asked for one attribute per Apple event — 650 ms per node — so
  the ADE's smallest window took ten seconds and the live gate failed 0 of 7. It
  reads in bulk now: 10.4 ms per node, measured (LLD §7.5).
- **The Java runtime's artifacts were not in the published schemas.** Every line
  of `results.jsonl` lacked `startedAt`, `endedAt` and `durationMs`, and the
  conformance suite never looked. The runtime writes full records and the suite
  validates before it compares (LLD §14).
- **`Dismiss the dialog` accepted the dialog.** The grammar emitted
  `args.action` and the adapters read `args.accept`, which nothing carried, and
  defaulted to accept. Both read `action` now, and refuse a step without one
  (LLD §3.2).
- **The desktop healing cases** T6.1 asked for and Phase 6 dropped: the ADE
  gains `SVATAH_A11Y_VARIANT=1|2`, and a binding recorded against the real
  interface relocalizes against both (LLD §16).
- **`pnpm -r typecheck` was red** in three packages and outside the verification
  contract. Both fixed (LLD §16).
- **The Windows UI Automation bridge never bound its request.**
  `powershell.exe -Command <script> -Request <json>` appends the argument to the
  script as text; every call would have died with a parser error. Four defects
  found by running the scripts through a real PowerShell.
- **The desktop gate script** resolved `--report` against the wrong directory
  and waited a fixed eight seconds for a window that takes fifteen.

### Known gaps

Recorded rather than closed, with the command that closes each in
`docs/spec/progress/phase-7.md`:

- The macOS Accessibility gate has not been run against a live window: the only
  host available has no reachable display. `reports/adapter-ax.md` has the
  evidence and the command.
- The Windows UI Automation gate has no Windows host.
  `reports/adapter-uia.md` has the four defects found without one.
- Nothing is published to a registry, by design.

[0.1.0]: https://bitbucket.org/svatah/automator/src/master/
