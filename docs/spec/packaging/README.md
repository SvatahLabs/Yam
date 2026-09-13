# What a person installs

Status: **specified, not started**. Written from the owner's decisions of
2026-09-12: `undici` stays in the base, and `yam mcp` stops being a subcommand so
that a separate package can own it.

Requirement ids use the `PK-` prefix.

## Why this exists

`npm i @svatah/yam` installs everything, and most of it is for somebody else. A
Windows user installs the macOS and Linux adapters. Somebody testing an HTTP API
installs a browser driver and a mobile stack. There is no way to ask for less.

The obvious fix — carve up the 34 publishable packages — is the wrong one, and
the measurements say so:

| | |
|---|---|
| Surface layer (schema, spec, surface, surface-control, **all six** zero-dependency adapters) | **2.8 MB** |
| Authoring stack (compiler, runtime, recorder, healer, bindings, service, tui, …) | **3.0 MB** |
| **Everything Yam wrote** | **~6 MB** |
| `playwright` + `playwright-core` | **19 MB** |
| `@modelcontextprotocol/sdk` | **6 MB** |
| `webdriverio` (Appium) | **4 MB** |
| `undici` (HTTP) | **3 MB** |
| Chromium and friends | **836 MB**, never bundled, always fetched |

Splitting Yam's own packages saves three megabytes. **Six of the eight adapters
have no third-party dependency at all** — `ax`, `uia`, `atspi`, `bidi`, `process`
and `http` — so making those optional buys nothing and costs every user a prompt.

The weight is four third-party packages, and only two of them are avoidable.

## The shape

**Two things a person installs, and one they never see.**

| Package | What it is | Costs |
|---|---|---|
| `@svatah/yam` | The CLI, and the engine the app stages. Everything Yam wrote, the six adapters with no third-party dependency, and `undici`. | **~9 MB** |
| `@svatah/yam-mcp` | The MCP server. Depends on `@svatah/yam` and adds the SDK. What an agent `npx`es. | +6 MB |
| `@svatah/yam-contract` | The operation catalogue and the fingerprint. Never installed directly; all three depend on it. | — |

Out of the box `@svatah/yam` drives native applications on all three desktops, a
terminal, an HTTP endpoint, and a browser *you* started over BiDi. No prompt, no
setup, works offline. A browser Yam launches is the one add-on, and it is the one
thing a person expects to install anyway.

## Functional requirements

| ID | Priority | Requirement and acceptance condition |
|---|---|---|
| PK-01 | P0 | **The base installs in one command and needs no setup.** `npm i @svatah/yam` yields a CLI that connects to a native application, a terminal and an HTTP endpoint on a machine with no browser and no network. Measured: the installed tree is under 12 MB. |
| PK-02 | P0 | **The heavy drivers are optional peers.** `playwright` and `webdriverio` are declared `peerDependenciesMeta: { optional: true }`, as `@playwright/test` already is. The package installs and every command runs without them. |
| PK-03 | P0 | **All eight adapters are always *registered*; not all are *installed*.** `registerAllAdapters` keeps naming every adapter, because `yam surface doctor` has to be able to say "uia: not this host" on a Mac. It gains a third verdict — **not installed**, with the one command that fixes it — distinct from "not this host" and from "not configured". |
| PK-04 | P0 | **A driver is never imported statically.** A repository check fails when an `adapter-*` package imports `playwright` or `webdriverio` at module load. Without it the split closes again silently, which is how the app's connect form became decoration. |
| PK-05 | P0 | **`yam mcp` stops being a subcommand.** `@svatah/yam-mcp` owns the server, and `npx -y @svatah/yam-mcp` is what an agent's configuration says. The CLI's `mcp` and `mcp --http` subcommands are removed rather than deprecated — two entry points to one server is how the app and the CLI ended up with two copies of everything else (`REQ-TUI-1`, Draft 2.26). |
| PK-06 | P0 | **`undici` is in the base.** HTTP surfaces are common enough that a prompt for them costs more than the three megabytes. Stated as a decision so that a later size review does not quietly reverse it. |
| PK-07 | P1 | **One contract, one version.** `@svatah/yam-contract` holds the operation catalogue, and `catalogueFingerprint()` is derived from it. Two installables at different versions interoperate when the contract has not moved, which the fingerprint already guarantees; this makes the guarantee a package boundary rather than a coincidence. |
| PK-08 | P0 | **A contract mismatch names the parties.** The broker's `mismatched` state currently says "speaks a different contract" and "stop it deliberately", which is unusable when three installables can each have started it. The message names which component started the broker, its version and contract, and what to update. With one installable this was rare; with three it is ordinary. |
| PK-09 | P1 | **The app bundle is unaffected and says so.** A person who dragged a `.app` cannot be asked to `npm i`. It stages the host's adapters plus HTTP and process, and fetches a browser on first use — which it must anyway, because Playwright's browsers are never bundled. Nothing in this document shrinks the download. |
| PK-10 | P1 | **`yam surface doctor` is the guided setup.** No new command. It already enumerates every adapter and says why each cannot run; with `PK-03` it also says what to install, and `--fix` offers to run it. |
| PK-11 | P0 | **Every document naming `yam mcp` is updated.** 43 files name it, including `docs/mcp.md`, the getting-started guide, the generated CLI reference, the app's own configuration block and two artboards. A reference to a removed command is a defect of this requirement. |
| PK-12 | P1 | **The published set is checked.** A repository check asserts which packages are publishable and that `@svatah/yam`'s dependency list contains no `adapter-*` driver, so a new hard dependency on a heavy package fails rather than shipping. |

## Non-functional

| ID | Priority | Requirement |
|---|---|---|
| PK-N1 | P0 | The base install is verified by installing the published tarball into an empty directory with no network access to a registry beyond the package itself, and running `yam surface doctor` and one native connect. Not by reading `package.json`. |
| PK-N2 | P1 | The size numbers above are re-measured by the check, so a claim of "~9 MB" that has become fifteen fails rather than ages. |

## Not in scope

**Separate adapter packages.** `@svatah/yam-adapter-playwright` is 352 KB of Yam
code wrapping a 19 MB dependency. Making the *dependency* optional achieves the
whole saving with one fewer package to version.

**A separate "OS control" installable.** On macOS that is the `ax` adapter: 348 KB
and no dependencies. There is nothing to install, and a second package would be a
second thing that can be version-skewed against the broker.

**Shrinking the app bundle.** Whether the app fetches adapters on demand is a
product decision with offline and signing consequences, and is not this.
