# Surface-first release review

**This is a review, not a release.** Nothing in this wave was pushed,
published, tagged or dispatched. What follows is what a person deciding whether
to publish would need: what was measured, on what, and what is still missing —
named, not summarised.

Generated evidence lives under
[`evidence/wave-4/`](evidence/wave-4/); the per-task record is
[`progress/wave-4.md`](progress/wave-4.md). Every number below is re-runnable by
the command beside it.

---

## 1. Does the mission hold?

> **Yam gives humans and agents one dependable way to inspect and control any
> supported digital surface, with explicit targets, model-free execution, and
> verifiable outcomes.**

The primary journey — **connect → inspect → act → verify** — was driven through
every public interface against the **packaged application**, which is the thing
a person installs.

| What | Result | Re-run it with |
|---|---|---|
| Yam drives the packaged Yam | **91 of 91 reached; 1 blocked; 92 attempted** — but not on every run; see the reliability gap below | `pnpm yam-on-yam` |
| Coverage across every interface and platform | **272 of 272 reached; 5 blocked; 277 attempted** | `pnpm coverage` |
| The desktop's own end-to-end suite | **38 of 38** | `pnpm --filter @svatah/yam-desktop exec playwright test` |
| The browser-hosted Surfaces harness | **154 of 154**, at two sizes and at 200% zoom, and by keyboard alone | `pnpm --filter @svatah/yam-desktop exec node test/surfaces-dogfood.mjs` |
| A clean install from the packed artifact | **11 of 11 copied commands** | `pnpm quick-start:surface` |

**The Yam-on-Yam suite is not yet dependable, and that is a release fact.** It
passes — twice in verification, at 91 of 91 — and it also failed several times
on the same machine, with the outer session disappearing around the moment the
application opens its own inner session. The race is not root-caused. Nothing
below should be read as "the suite is green"; it should be read as "the
capability is demonstrated and the harness is not yet reliable enough to gate a
release". The runs are tabulated in
[progress/wave-4.md](progress/wave-4.md#the-reliability-gap-stated-rather-than-averaged).

**The parity gate is not conformant.** `reports/self-parity.md` ends with two
disagreements over the 26 checks both sides reached, where REQ-SELF-2 asks for
100 percent. Both are named in the progress record.

The counts are stated with their denominators on purpose. SF-21 forbids a
headline percentage over a reachable subset, and the blocked rows below are the
part a release decision actually turns on.

## 2. What each interface and platform reached

Derived from [`evidence/wave-4/coverage.json`](evidence/wave-4/coverage.json);
the user-facing form is the generated
[support matrix](../../reference/generated/support-matrix.md).

| Interface | Platform | Passed / reached | Note |
|---|---|---|---|
| `yam surface` | the packaged renderer, attached to | 26 / 26 | the journey and the negative cases |
| MCP over stdio | the packaged renderer, attached to | 25 / 25 | a real `yam mcp` subprocess through the official SDK client |
| `yam surface` | macOS accessibility tree | 17 / 17 | the packaged window, no DOM involved |
| MCP over stdio | macOS accessibility tree | 17 / 17 | the same journey, same tree |
| HTTP | the service's `/v1` routes | 14 / 14 | every catalogue operation described and served |
| desktop | the packaged application | 1 / 1 | launch to Surfaces on screen |
| desktop | **browser-hosted** | 154 / 154 | the built renderer in a browser — kept, and labelled |
| external | independent oracles | 5 / 5, 1 blocked | screenshot, geometry, accessibility audit, fixture bytes, and the pass accounting |
| packaging | a clean install outside the workspace | 11 / 11 | commands read out of the documentation |

**Adapters.** `playwright` and `ax` are **validated** — a session was opened
through each and driven in the run this is generated from. `http` is validated
by the gate's own transport suite rather than by this one. `bidi` and `appium`
are **implemented and unvalidated here**, each with what would have to be true
(a browser started with a BiDi endpoint; an Appium server and a device). `uia`
is **blocked**: no Windows runner. Linux AT-SPI and process/terminal surfaces
are **unimplemented** and have no row.

## 3. Timing, on a named machine

Reference: `darwin arm64, Node v25.6.1`. Every sample is a fresh process, so
cold start is included — which is what a person at a terminal pays.

| What | Budget | p95 | Samples |
|---|---|---|---|
| connect a browser to an application | 5000 ms | 912 ms | 5 |
| a bounded, useful snapshot | 5000 ms | 823 ms | 5 |
| one dispatched action, typing into a real field | 5000 ms | 576 ms | 5 |
| the desktop's first paint, launch to Surfaces | 60000 ms | 1141 ms | 1 |

`requirements.md` calls these *"proposed product budgets to calibrate, not
measured current performance"*. This is the calibration. They are one machine's
and the report always names it.

## 4. What driving the product found

Eight defects reached this branch's subject and none of them could be seen from
the code. Two are defects a user meets on first launch.

| # | Defect | Why it survived |
|---|---|---|
| 1 | **The packaged application could not be built at all** — the shipped renderer failed on a Node `crypto` import pulled in through the schema package's single bundled entry. | The evidence harness aliased `crypto` to a stub of its own, and the desktop's end-to-end suite *skips* when there is no packaged build. "There could not be one" was reported as "nothing to check". |
| 2 | **The broker was version-blind**: an argument a newer client sent to an older broker was dropped and the operation answered `succeeded`, on a target the caller never named. | Nothing compared what a client and a broker each believed the contract was. |
| 3 | **A missing action argument was reported as `TIMEOUT`**, exit 75. An agent reads that as "try again"; no retry supplies an argument. | The adapter's actionability error was mapped to a deadline, and nothing validated the action's arguments before dispatch as SF-11 requires. |
| 4 | **`yam surface` ignored flags it did not know**, so a command that meant "take control" reported the lease's status and exited 0. | The catalogue generated help and parsing and was never used to *reject*. |
| 5 | **The application opened into the project chooser, not Surfaces**, on any machine that had ever opened a project. | The browser-hosted harness stubs the preload bridge with an empty recents list and answers instantly, so it never saw the state a real machine has. |
| 6 | **`yam surface --json` truncated at 64 KiB through a pipe** — one pipe buffer, mid-token — because the process exited before stdout drained. | Every existing suite redirected to a file or read answers small enough to fit. It surfaced the first time Yam read a native accessibility tree of its own window. |
| 7 | **The Accessibility grant belongs to whichever program started the broker**, so `surface doctor` said *granted* and `connect --adapter ax` said *denied* a second apart, both true. | Native sessions had never been opened through the broker on a machine where the desktop application had started it. |
| 8 | **The shipped window jumped `h1` to `h3` and had no `<main>` landmark.** | No accessibility oracle had ever been run against the packaged window. |

Fixing (1) let the desktop's 38 end-to-end cases run for the first time. Three
asserted behaviour that had since deliberately changed, and one contradicted
wave 3's own 200%-zoom fix; all four are restated as the rules now are.

## 5. Open limitations, by name

These are not summarised, and none of them is described as almost done.

| Limitation | Where it stands |
|---|---|
| **Permission-denied is undriven in the desktop.** | The *domain* refusal is now real and driven — defect 7 produced one through the command line, naming the program the grant is needed for. Making the **desktop** render its permission-denied state needs the accessibility grant revoked mid-run, which no unattended host can produce. Its mapping and wording stay covered by `problemFor`'s model tests. |
| **The screenshot preview and pixel actions are unbuilt.** | Surfaces shows the semantic tree only. The tree is the half that is always available, including where screenshots are not; hit-testing a preview onto a semantic reference needs a coordinate→reference mapping no adapter exposes. The design's lower-assurance pixel mode does not exist. |
| **Copy CLI and Copy MCP call are unbuilt.** | The equivalents exist as data — each action carries its `cli` — but generating an executable line with real session and reference values, marking expiring references and routing secrets through a file is its own piece of work. |
| **Streamable HTTP MCP is absent.** | SF-08 and T21, milestone M5. Local stdio MCP is complete and is what the shipped configuration uses. The existing REST API is **not** labelled an MCP transport anywhere. |
| **The connection test does not speak MCP.** | "Connect an agent" checks the broker an agent would share, and the panel says exactly that. Completing a handshake needs a spawned process the renderer cannot start and the service has no route for; adding one is a capability-gated decision (SF-15), not something to slip in. |
| **BiDi and Appium are unvalidated on this host.** | Implemented and registered; nothing here drove them. The support matrix says what would have to be true. |
| **Windows UIA is unreachable here.** | No Windows runner. The adapter refuses with its own sentence about the host. |
| **Linux AT-SPI and process/terminal surfaces are unimplemented.** | SF-22, SF-23, milestone M5. They have no adapter and no row in the support matrix. The README no longer names AT-SPI among the implemented adapters, which it did. |
| **The self-parity gate is not conformant.** | `reports/self-parity.md` is regenerated from a real run and reads *not conformant: 4 disagreements*. Three are the packaged application being terminated mid-run by another source of that gate — run on its own the same suite passes **126 of 129 steps** — and the fourth is a race the flows now avoid and the gate re-broke by killing the application under them. **`yam eval self` does not isolate its sources from each other's applications.** It is not part of the release gate (`pnpm -r test` and `pnpm lint` do not run it), and it had not been re-run since before wave 3; doing so found seven other defects, listed in the wave 4 record. |
| **An expectation is evaluated once; only resolution retries.** | The flow language cannot say "wait until this becomes true" of an element — `should be visible` waits because *resolving* retries, and `should contain` does not. The self flows work around it by resolving something that exists only when the state they want has arrived. Polling element expectations is a runtime change and is named here rather than made. |
| **axe-core is not run by default.** | It is MPL-2.0 and REQ-PKG-3 admits MIT, Apache-2.0 and BSD only, so it is not a dependency. The in-house audit runs on every check; `YAM_AXE=<path>` runs axe-core beside it. |

## 6. What was not touched

- **The projectless workspace is not a project and nothing wrote into it.** The
  fixture project's files are hashed before and after the whole suite and are
  byte-identical. "Save as automation" refuses without a project.
- **No automation semantics changed.** The compiler, the executor, the flow
  language, the binding store and the plan hashes are untouched; the fixture
  plan hashes and the golden suites pass unchanged.
- **Nothing was published.** No push, no `npm publish`, no tag, no release
  dispatch, no GitHub release. That decision is the owner's, and this document
  is what it should be made against.

## 7. The gate, from a clean checkout

```bash
pnpm install --frozen-lockfile
pnpm browsers
pnpm -r build
pnpm -r typecheck
pnpm -r test
pnpm lint
pnpm docs:check
```

No credential is required by any of it. The desktop's end-to-end suite needs a
packaged application (`pnpm --filter @svatah/yam-desktop package`) and skips,
with its reason, when there is not one — which is how defect 1 hid, so the
release review says it out loud: **package the app before reading a green
gate.**
