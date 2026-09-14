# Phase 13 — Yam: the name, the clean repository, the documentation

Implementer: this session · Branch `yam-bootstrap` from `master` at `8e7969d` · Host: macOS 15 (Darwin 25.3.0), arm64, Node v25.6.1, pnpm 10.30.2

Spec: Draft 2.18, written on this branch as its first commit (`b2fd9c1`), and Draft 2.19 (the desktop client is Yam) later on the same branch: Phase 13 inserted, process and terminal renumbered to Phase 14, the four documents' change logs extended. No requirement text changed.

## The owner's decisions this phase implements

Made on 2026-09-06, after a naming search that ran through descriptive English (OpenSurface, OneSurface: both registered marks in software), Sanskrit (rejected as regional for a global product), short English nouns (Fig, Tack, Cleat, Kumquat) and fruit: **the product is Yam**, Svatah is the brand and the organisation, the npm scope stays `@svatah`, the GitHub organisation is `SvatahLabs` (github.com/Svatah belongs to an unrelated non-profit), the owner's `svatah.com` hosts every product as a subdomain, and `legacy/` leaves. Yuj, the owner's LLM harness, is a sibling product under the same scheme.

## The contract

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile && pnpm -r build && pnpm -r typecheck && pnpm lint`, Node v25.6.1 | all exit 0 |
| `pnpm -r test`, Node v25.6.1, `CI=true` | 36 packages, **3,688 passed, 0 failed, 1 skipped** on the run alone; the one red line on that run was `yam.test.ts` reading its own source once it was tracked, fixed in the record's commit and green since. A run beside `pnpm lint` and `pnpm -r typecheck` timed out in the BiDi adapter's `session.new`, which is Phase 12's K7 again: the suite is not reliable beside other load, and green on its own |
| `pnpm docs:check` | 67 generated pages current |
| `pnpm release:dry-run` | 30 tarballs under the new names; every content claim holds; no `workspace:*` |
| `node scripts/publish.mjs` | 30 `npm publish` commands in dependency order; refused on all three guards |
| `pnpm quick-start:packed` | 4.6 s of the ten-minute budget, from the 30 tarballs, 3 bindings recorded, no credential |
| `node scripts/migrate-legacy.mjs --check` | clean, from `evals/migrate/source/` |
| `node scripts/record-screen-fixtures.mjs --check` | clean after re-recording under the new names |

Node 22 was not re-run this phase; nothing here touched the runtime's Node-version behaviour, and the release workflow's `tarballs` job runs the packed quick start on 22 and 24.

## T13.1 The organisation and the accounts (owner)

**Status: the owner's.** Nothing here can create an organisation. What the branch assumes, and the release workflow is written for: the GitHub organisation `SvatahLabs`, the repository `SvatahLabs/Yam`, the npm organisation `svatah` with trusted publishing configured for `release.yml`'s `publish` job (`id-token: write` is set and the script accepts the OIDC identity; `NPM_TOKEN` is the fallback), `svatah-yam` on PyPI, and `yam.svatah.com`.

## T13.2 The clean repository

**Status: done.** Commit `aa9791b`.

`legacy/` is gone: 117 tracked files, among them 60 MB of chromedriver and geckodriver binaries. What it still fed is kept: the four v1/v2 sample flows, the locator file, the empty data store and `ActionSynonyms.java` and `SeleniumActionMapper.java` live under `evals/migrate/source/`, and the migrate script, the ADE fixture builder, the layout, golden, migrate and vocabulary checks, the CLI import test and the screens fixture point there. `evals/migrate/expected/` was regenerated from the moved inputs and `--check` is clean.

`bitbucket-pipelines.yml` and the twin-file test are gone; `tools/repo-checks/test/ci.test.ts` now asserts the properties of the one workflow, including T12.1's rule that the two desktop legs have different hosts and run no test suite. `docs/ci.md` is rewritten for GitHub: the hosted legs, the self-hosted macOS runner the AX gate needs, and what to record.

**The history export is the owner's step**, at repository creation:

```bash
git clone --mirror <this repository> yam.git && cd yam.git
git filter-repo --path legacy --invert-paths
git push --mirror git@github.com:SvatahLabs/Yam.git
```

That keeps every phase record and drops the binaries from history. The largest tracked file on this branch's head is 1.3 MB (`packages/recorder/test/fixtures/pages.json`).

## T13.3 The rename

**Status: done.** Commit `12f638a`, 880 files.

One scripted pass with the brand's forms protected: `@svatah/cli` → `@svatah/yam`, every other `@svatah/<dir>` → `@svatah/yam-<dir>`; `dev.svatah` → `com.svatah.yam` and the Java trees moved; `svatah_sdk`/`svatah-sdk` → `svatah_yam`/`svatah-yam`; `https://svatah.dev` → `https://yam.svatah.com`; `github.com/a-t-u-l/svatah` → `github.com/SvatahLabs/Yam`; then `svatah`/`Svatah`/`SVATAH` → `yam`/`Yam`/`YAM` everywhere else. Kept verbatim: the `@svatah` scope, `svatah.com`, `Svatah Labs`, the prototype repository `svatahADE`, and the legacy fixture names `svatah.flow`, `svatah.locator`, `svatah.data`. The progress records and prompts of Phases 0 to 12 keep their text as history. `pnpm-lock.yaml` was regenerated; the only lines that changed are the names.

By hand afterwards: the ESLint boundary rules and the repo checks derive a package's specifier from its directory through `specifierOf` and `dirOf` (`tools/repo-checks/src/repo.ts`); the ADE's bundle id is `com.svatah.yam.ade`; the generated clients, the ADE client, the JSON Schemas (`$id` under `https://yam.svatah.com/schema/1.0.0/`), the migrate outputs and the screen fixtures were regenerated.

**Three things the rename found:**

1. `ade.project`'s check "the open project is named in the window" looked for the product name anywhere in the tree and was satisfied by the fixture flow `svatah.flow` in the flows list. It now looks for the project's name or directory in the crumb (`packages/conformance/src/surface/desktop.ts`).
2. Four bare fixture-name lists (`["simple", "svatah", …]`) had been renamed with the product and put back.
3. `@svatah/` in the dynamic-import lint pattern escaped the scope protection; the pattern is now built from `specifierOf`, and the repo check for it went red, which is what it is for.

`tools/repo-checks/test/yam.test.ts` enumerates every allowed form of the old name and fails on any other; the umbrella package's bin; the release set's count in the documents; the manifests' metadata.

### The desktop client is Yam (Draft 2.19)

A second owner decision, after the first rename had landed: the Electron client is not "the ADE", it is **Yam** — the product's own surface, so that a person can say `Yam.app`. One more scripted pass, with the same shape as T13.3's:

- `Yam ADE` → `Yam` (product name, process name, bundle `Yam.app`, application-support directory); `Yam ADE Test` → `Yam Test`; bundle ids `com.svatah.yam` and `com.svatah.yam.test`; installer names `yam` and `yam_test`.
- `@svatah/yam-ade` → `@svatah/yam-desktop`, and `apps/ade` → `apps/desktop`.
- `YAM_ADE_*` → `YAM_APP_*`; the `ade:*` scripts and IPC channels → `app:*`; the scripts, fixtures, flows, bindings directory, screenshots and the guide renamed from `ade` to `app`.
- The prototype-database import, which was named after the *old* Electron prototype's database, is `yam migrate --from-prototype`, `evals/migrate/prototype-db`, and `prototype-*` diagnostic codes.
- Prose: "the ADE" → "the app"; "Automation Development Environment" → "desktop app".
- Kept: the `REQ-ADE-*` ids, because requirements.md §0 forbids renumbering an id once referenced; the prototype repository's name `svatahADE`; and the Phase 0–12 records and prompts, as history.

Two things the pass needed by hand. Code files were regenerated from their originals with a rule that tells an identifier (`ADE`, a path constant, → `APP_DIR`; `ade`, a process, → `desktopApp`) from prose and from string ids, because several test files already had an `app` in scope and a blind `ade → app` collided with it. And HLD §12's layout line names `desktop/`. The app client, the screen fixtures and the generated documentation were regenerated; the contract below was re-run in full.

## T13.4 The readiness corrections

**Status: done.** Commit `cfdbdd6`.

- The changelog and the release workflow say **30** packages, and the repo check reads the number from `scripts/lib/release-packages.mjs` and asserts both documents carry it. They said twenty-six, from before screens, sdk, ui-tokens and tui joined.
- Every manifest (35: the root, 31 packages, 2 apps, repo-checks) carries `homepage`, `repository` with its `directory`, and `bugs`, pointing at `SvatahLabs/Yam` and `yam.svatah.com`.
- **Trusted publishing.** `release.yml`'s `publish` job has `id-token: write` and installs an npm that can use it; `scripts/publish.mjs`'s third guard is now "a publish identity", the workflow's OIDC token or `NPM_TOKEN` as the fallback, and provenance is attached when the identity is the workflow's. `.npmrc` no longer forces provenance off. The manual-trigger guard is a GitHub `workflow_dispatch` and nothing else.
- The README's status section described Phase 2; it now describes what ships, the known gaps, and every package by module.

## T13.5 The documentation set

**Status: done.** Commit `97a33c8`.

`docs/README.md` is an index by kind. Written by hand: three getting-started pages, nine guides (record, heal, write a flow, CI, cron, MCP, add an adapter, foreign runtime, the ADE), six concept pages (the layers, the surface, determinism and provenance, bindings and fingerprints, the compiler tiers, plus the existing behaviors and privacy pages), and the project pages (versioning, reports, contributing, security, plus the existing CI page). The existing reference documents (the flow language, the agent surface contract, MCP, the REPL, the local model, the fine-tune) stay where they were, because code and tests read them by path.

Generated by `scripts/docs.mjs` (`pnpm docs`, `pnpm docs:check` in CI): the CLI reference from `yam --help`; one page per workspace package with every export, its kind, its signature and its doc line, read from the entry point through the TypeScript compiler API; one page per JSON Schema with its `$id` and root properties; the local service's routes from `openApiDocument()`. 67 pages. `tools/repo-checks/test/docs.test.ts` asserts the index reaches every kind, every relative link under `docs/` resolves, every package has a generated page naming its exports, and the generated set is current.

## T13.6 0.1.0 published as Yam (owner)

**Status: the owner's.** After T13.1: dispatch `release.yml` with `publish`, tag `v0.1.0` at the published commit, `pnpm quick-start:registry`, and the release carries the reports and the installers.

## Deviations

- **D1 — the documents that moved, and the ones that did not.** T13.5 said `docs/` is reorganised by kind. The hand-written reference documents kept their paths (`docs/flow-language.md` and six others) because forty-odd source files and tests read them by path; the index links to them where they are. Reorganising by kind is true of everything new.
- **D2 — the package-per-page API reference is generated from the compiler API, not TypeDoc.** TypeDoc would add a dependency and a build; the entry point's exports with their signatures and doc lines are what a reader needs to know what to import, and the package README carries the rest.
- **D3 — `Svatah` remains in three kinds of place inside the product tree**: the scope, the domain and the organisation; the legacy fixtures' file names; and a recording's machine path. `yam.test.ts` lists each with its reason.

## Known gaps

**K1 — nothing is published and no organisation exists.** T13.1 and T13.6 are the owner's; every script that verifies them ran in its dry or tarball mode.

**K2 — the history export has not been performed**; the branch still carries `legacy/` in its history. The three commands are under T13.2.

**K3 — the desktop gates were not re-run live this phase.** The rename touched the ADE's product name, which is what the AX bridge addresses; the recorded-tree suites for both desktop adapters are green under the new name, and the live gate is one command (`pnpm conform:desktop`) on a host with the permission.

**K4 — the Windows UIA gate, the desktop CI legs and the installer matrix** carry from Phase 12 unchanged, and go green when the repository is on GitHub (Windows, installers) and a macOS runner is attached (AX).
