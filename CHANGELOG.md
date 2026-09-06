# Changelog

Svatah is a monorepo of packages that release together, so this file is the
whole workspace's changelog and every package version below is the same number.
It follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-06 (ready to publish; the tag is the owner's)

The first release. **Nothing is published to a registry until the owner triggers
the pipeline** (T8.5): `node scripts/publish.mjs` prints the twenty-six exact
`npm publish` commands and stops unless `--publish`, a manual trigger and
`NPM_TOKEN` all hold. Everything it would publish exists and has been driven:
`pnpm release:dry-run` packs the tarballs, and `pnpm quick-start:packed`
installs the module (a) four into an empty Playwright project outside this
workspace and records, runs and heals there.

**Verifying the publish is one command** (T12.5). `pnpm quick-start:registry`
asks the registry whether the four module (a) packages are there at this
version; when they are, it installs them **by name, with no overrides** into an
empty project and runs the same quick start — which is the last thing nobody can
test beforehand, because a `workspace:*` that escaped into what was uploaded
fails there and nowhere else. Until then it says the packages are not published,
runs the tarball quick start instead, and says which mode it took.

The **git tag `v0.1.0` is not created here**. A tag is a claim that a version
exists somewhere, and until the owner triggers `custom: publish` it does not.

**What is measured**, and where the number is:

| | |
|---|---|
| Compiler, exact match | 98.0 % overall over **303** pairs; tier 1 100 % (250/250), tier 2 88.0 % (`reports/eval-compiler.md`) |
| macOS Accessibility conformance | conformant — 10 cases across ADE variants 0, 1 and 2, live against the packaged ADE; 1017 nodes in 1488 ms, 1.46 ms per node at load average 5.15 over 8 CPUs (`reports/adapter-ax.md`) |
| Svatah verifies Svatah | 100 % agreement over the 29 checks both sides reach; Svatah 30 of 48, external 47 of 48 (`reports/self-parity.md`) |
| Java runtime conformance | artifacts valid, zero mismatches (`reports/runtime-java.md`) |
| Healing, grounding, adapter conformance | `reports/eval-healing.md`, `reports/eval-grounding.md`, `reports/eval-conformance.md` |
| Tier 2 fine-tune | **not met**, and withdrawn — see below (`reports/eval-finetune.md`) |

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

### Fixed in Phase 8

The corrections the Phase 7 adversarial verification required — it scored 7.9 and
found that the *packaged* product could not open a project — each reproduced
before it was fixed:

- **The packaged ADE could not open a project.** It spawned `process.execPath` to
  run `svatah serve`; packaged, with the `RunAsNode` fuse off, that is the ADE
  itself, so the child was a second ADE that printed no handshake. The runtime is
  resolved from `SVATAH_NODE`, then a `node` on `PATH` of Node 22 or newer, then
  a Node beside the CLI under `resources/`, and the Project screen's alert names
  all three when none is found (LLD §13.6). The packager now ships the CLI, which
  it never did; `SVATAH_ADE_PROJECT=<dir>` opens a project on ready; and the
  smoke check runs against the packaged application.
- **The macOS Accessibility bridge missed its budget on the screen the budget is
  about.** Phase 7's 10.4 ms per node was measured on the menu-bar tree; the
  ADE's project screen cost 51–55 ms per node, about 25 s for one snapshot. The
  window read is a native helper now — `AXUIElement` directly, no Apple events —
  at **1.5–1.7 ms per node for 588 nodes** (LLD §7.5).
- **The macOS desktop conformance gate is green**: 7 of 7 flow cases and both
  healing cases, live, against the packaged ADE. `reports/adapter-ax.md`.
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
  would make another attempt worth making, and `svatah eval finetune corpus`
  reports it. `reports/eval-finetune.md`.

### Known gaps

Recorded rather than closed, with the command that closes each in
`docs/spec/progress/phase-8.md`:

- The Windows UI Automation gate has no Windows host.
  `reports/adapter-uia.md` has the defects found without one.
- No screenshot was taken through the macOS adapter on this host: `screencapture`
  needs the Screen Recording grant, which is separate from Accessibility.
  `svatah surface doctor` reports it as an advisory check.
- Nothing is published to a registry until the owner triggers the pipeline.

[0.1.0]: https://bitbucket.org/svatah/automator/src/master/
