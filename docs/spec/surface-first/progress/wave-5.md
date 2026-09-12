# Surface-first wave 5 progress

Wave 5 is milestone M5, with one task before it that came out of wave 4's
verification: **T00** (make the Yam-on-Yam suite dependable and the parity gate
conformant), then **T21** (Streamable HTTP MCP), **T22** (process/PTY) and
**T23** (native and mobile reach).

Branch: `surface-first-wave-5`, from `master`.

Nothing in this wave is published. No push, no `npm publish`, no tag, no release
dispatch.

**The host this wave was built and measured on**, because several answers below
are the host's rather than the product's:

```
darwin arm64, Node v25.6.1, macOS 26.3
```

**The display was locked for the first part of this wave and unlocked for the
last.** That matters and is said rather than tidied away, because it is why some
measurements below are `blocked` and the final ones are not. A locked display
makes macOS answer *every* application's window list with the application itself,
so no accessibility client can read any window — the Finder included, which is
how the suite tells "this host cannot be asked" from "Yam could not read Yam".

- While it was locked, every accessibility row of the Yam-on-Yam suite was
  `blocked` with `yam surface doctor`'s own sentence
  (`CGSSessionScreenIsLocked`), and the run reported **57 of 57 reached, 35
  blocked, 92 attempted**. Nothing was omitted and nothing was counted as
  passing.
- The work that did not need a window went on regardless: the broker race, the
  CDP half of the parity gate, the MCP transport, the terminal surface and the
  adapter probes were all measured with it locked.
- **The ten runs and the final parity gate below were made with it unlocked**,
  so the accessibility passes are real results rather than blocked rows:
  `yam surface doctor` answers `ax/accessibility granted` and `ax/session 9
  application(s) own a window`.

Screen recording is still refused on this host
(`ax/screen-recording refused — could not create image from rect`), which the
doctor reports and which costs the run nothing: the adapter still reads the
accessibility tree.

---

## T00 — Make the Yam-on-Yam suite dependable, and the parity gate conformant

**Status:** complete. The suite is dependable — ten consecutive unattended runs,
identical counts, no failures — and it is a gate in CI behind the packaged
build. The parity report is regenerated and its verdict, with its denominator,
is below.

**Requirements:** SF-18, SF-21. Added to
[tasks.md](../tasks.md) in M5 with those references.

### The intermittency, root-caused

Wave 4 recorded the signature and could not explain it:

> The failing runs share one signature: the **outer session disappears**
> (`SESSION_NOT_FOUND`) around the moment the application opens its own inner
> session… It is a race and it is **not root-caused**.

It is two defects, both in how a client decides which broker is *the* broker,
and the phrase "around the moment the application opens its own inner session"
is the clue: that moment is the first time the packaged application's own
service needs a broker, and therefore the first moment two clients ask for one
at the same instant.

| # | Defect | How it was reproduced | Fix |
|---|---|---|---|
| 1 | **A machine could get two brokers.** Starting one was "look for a descriptor; if there is none, spawn one and wait for a descriptor to appear", with nothing between the looking and the spawning. Two clients that look at the same instant both spawn; both bind a port and write `broker.json`; the second write wins. The loser keeps running and keeps every session opened on it, and nothing can address it again — so the client whose session landed there gets `SESSION_NOT_FOUND` on its next command. | Two concurrent `yam surface` commands on a cleared field: **two `surface broker` processes**, one descriptor. | `acquireStartLock` — `open(2)` with `O_CREAT｜O_EXCL`, which the kernel makes atomic. The winner starts a broker and publishes it; the losers wait for *that* descriptor rather than starting a rival. `yam surface broker` run directly takes the same lock. |
| 2 | **A busy broker was taken for a dead one.** Liveness was a boolean over a two-second deadline. A broker launching a browser for somebody else can take longer than that, and the caller that read the `false` removed its descriptor and started a second broker — without ever asking whether the process was still there. | `brokerState` unit cases: a `/health` that answers after 5 s, probed with a 150 ms deadline. | `brokerState` answers `serving`, `busy`, `mismatched` or `gone`. Only `gone` is a reason to replace anything; `busy` is a reason to wait, and it is told from `gone` by asking whether the descriptor's **pid** is alive. |
| 3 | **The service made the decision a second time.** `surfaceRoutes` did its own discover-and-check with the same two-second boolean, so the packaged application's service could start a rival broker on its own. | Reading it against defect 2. | The route calls `connectToBroker` and nothing else. One place decides how a broker comes to exist. |
| 4 | **An attached session was recorded as one Yam had launched.** `dispatchConnect` never passed a mode, so the store's default — `launch` — was on every session, including `--attach <endpoint>` on somebody's running application. SF-05 asks the broker to publish ownership mode, and it published the wrong one. | `yam surface connect --attach …` then `yam surface sessions`: `"mode": "launch"`. | `attach` whenever the caller named an endpoint or an application that already exists. `closeAll` and the TTL sweep now close *every* session and let the adapter decide what closing means — which is what it already did correctly, and what the old skip turned into a leak. |
| 5 | **`SESSION_NOT_FOUND` said nothing about which case it was.** A session id nothing recognises is either one that was closed or one opened on a different broker, and the message was `Session s_… not found` either way. Wave 4 spent a verification pass on that sentence. | Reading the message against the two causes. | It names both, and points at `yam surface sessions` as the inspection route SF-14 asks a caller to be given instead of a retry. |

Shown by `packages/surface-control/test/one-broker.test.ts` (14 cases) and the
three ownership cases in `contract-guard.test.ts`. The demonstration that the
lock works, re-run three times:

```
$ for round in 1 2 3; do
    pkill -f "surface broker"; rm -f ~/Library/Application\ Support/yam/broker.{json,lock}
    for i in $(seq 1 8); do node packages/cli/dist/bin.js surface sessions --json & done; wait
  done
round 1: brokers=1  succeeded=8/8  starting=1  waiting=7
round 2: brokers=1  succeeded=8/8  starting=1  waiting=7
round 3: brokers=1  succeeded=8/8  starting=1  waiting=7
```

**A defect in the fix, found by the fix's own evidence.** The first version
printed "starting the surface broker" three times out of five, which a lock that
works cannot do. `writeFileSync(…, { flag: "wx" })` is two steps — create, then
write — and a second caller that reads the file in between finds it *empty*,
decides the lock is the residue of a crash, removes it and takes it. The lock is
now created with `openSync(…, "wx")` and its pid written through the same
descriptor, and an unreadable lock is re-read for a grace period before anything
is broken.

### A sixth thing, which is the harness's and not the product's

The packaged application's own service runs the copy of the command line staged
inside the bundle. If that copy speaks a different contract, the broker guard
does exactly what it should — stops the mismatching broker and starts one that
matches — and the suite driving through it loses its session mid-run. That is a
**stale build**, and it reads exactly like a defect in Yam.

So the suite states it as its own precondition, as a check in the denominator:

```
FAIL [launch] the packaged application speaks this build's contract
  — the packaged application carries a copy of the command line that speaks
    contract 4f81267a38e4468a, and this build speaks 4efddf7e75a5dccb. Re-run
    `pnpm -r build && pnpm --filter @svatah/yam-desktop package` …
```

It bit for real during this wave, the first time the catalogue changed.

### The denominator no longer moves, on any host

SF-21's vocabulary is worth nothing if `attempted` means "however far it got".
Wave 4 fixed that for the journey; three places still had it.

- **The negative cases** recorded only what they reached, and only one row when
  the session did not open. They declare `negativeChecks(kind)` now.
- **The oracles** recorded a differently-named row when they could not look, and
  a second, undeclared row for a failed screenshot. They declare
  `WINDOW_ORACLE_CHECKS`.
- **A host with no packaged application** reported *one* blocked row per pass —
  seven rows where a healthy run reports ninety-five. `CHECKS_OF` maps every
  pass to its declared list and `blockEverything` blocks all of them, so the
  attempted count is the same number on every host and what differs is how many
  are blocked and with which sentence.

The suite is **119 checks on any host**: 2 launch + 4×17 journey + 10
negative-cli + 9 negative-mcp + 4 window oracles + 2 run oracles + 2×12 terminal
(T22). Demonstrated by running it on hosts that can reach three different
amounts, with the bundle moved aside and the pseudo-terminal allocator denied:

| The host | Reached | Blocked | **Attempted** | Exit |
|---|---|---|---|---|
| everything available | 118 | 1 | **119** | 0 |
| no packaged application | 26 | 93 | **119** | 0 |
| no application **and** no pseudo-terminal | 2 | 117 | **119** | 2 |

```
$ mv apps/desktop/out/Yam-darwin-arm64/Yam.app /tmp/Yam.app.aside
$ node evals/self/yam-on-yam/run.mjs
  26 of 26 reached check(s) passed; 93 blocked; 119 attempted
$ YAM_PTY_ALLOCATOR=no-such-allocator node evals/self/yam-on-yam/run.mjs
  2 of 2 reached check(s) passed; 117 blocked; 119 attempted
  Nothing was reached on this host: every check is blocked…
```

The one blocked check on a healthy host is axe-core, which is MPL-2.0 and so not
a dependency of this repository; `YAM_AXE=<path>` runs it beside the in-house
audit.

### It is a gate now, with three exits

A suite that exits 0 on a host that could reach nothing is a green build that
proved nothing — the failure the whole blocked/reached vocabulary exists to
prevent. So the run exits **1** when a check failed, **2** when nothing was
reached beyond the two run-level oracles, and **0** otherwise. Those are the
three the desktop conformance gate already uses, for the same reason, and the
table above is each of them demonstrated.

`.github/workflows/ci.yml` gains a `yam-on-yam` job on `macos-latest`, behind
`pnpm --filter @svatah/yam-desktop package`, which tolerates exit 2 with a
warning and fails on exit 1. A hosted macOS runner cannot grant the
Accessibility permission, so its two AX passes will be blocked with the doctor's
own sentence — and the browser, negative and terminal passes still have to
pass.

### Ten consecutive runs, unattended

```
$ pnpm -r build && pnpm --filter @svatah/yam-desktop package
$ pnpm yam-on-yam:repeat
```

**Nothing is cleaned between them** beyond what the suite itself does, because a
suite that needs a fresh machine between runs has not been fixed — it has been
rescheduled. The table is counted from each run's own `yam-on-yam.json` rather
than from what the runner printed: wave 4's third verification defect was a
per-pass table typed by hand where every row was wrong, and a summary that reads
the evidence cannot drift from it.

| Run | Started | Passed | Failed | Blocked | Attempted | Exit |
|---|---|---|---|---|---|---|
| 01 | 2026-09-09 05:38:00Z | 118 | 0 | 1 | **119** | 0 |
| 02 | 2026-09-09 05:40:12Z | 118 | 0 | 1 | **119** | 0 |
| 03 | 2026-09-09 05:42:14Z | 118 | 0 | 1 | **119** | 0 |
| 04 | 2026-09-09 05:44:20Z | 118 | 0 | 1 | **119** | 0 |
| 05 | 2026-09-09 05:46:20Z | 118 | 0 | 1 | **119** | 0 |
| 06 | 2026-09-09 05:48:21Z | 118 | 0 | 1 | **119** | 0 |
| 07 | 2026-09-09 05:50:21Z | 118 | 0 | 1 | **119** | 0 |
| 08 | 2026-09-09 05:52:21Z | 118 | 0 | 1 | **119** | 0 |
| 09 | 2026-09-09 05:54:22Z | 118 | 0 | 1 | **119** | 0 |
| 10 | 2026-09-09 05:56:24Z | 118 | 0 | 1 | **119** | 0 |

```
10 run(s): the same 119 attempted every time; no failures
```

The one blocked check on every run is axe-core, which is MPL-2.0 where REQ-PKG-3
admits MIT, Apache-2.0 and BSD only; the in-house audit runs on every one of
them, over the packaged window's own live DOM.

Each run's whole record is under
[`evidence/wave-5/per-run/`](../evidence/wave-5/per-run/) — `yam-on-yam.json` with
every check, `yam-on-yam-transcript.txt` with every command line and every MCP
tool call, and the window's screenshot and DOM. `ten-runs.json` is the summary,
and it asserts the two things that matter rather than leaving them to be
compared by eye: that `attempted` was the same number every time, and that no
run had a failure. The last run's evidence is also at the top of
`evidence/wave-5/`, which is the run the coverage report describes.

### The parity gate: which oracle was wrong

**`app.screen-through-two-adapters` — the CDP oracle was wrong**, and the fix is
in it.

The disagreement was that the same flow passed through the accessibility tree
and failed over CDP expecting "Flows" in the toolbar title. Driven six times over
CDP alone, before anything was changed: **three failures out of six**. The
failing message said only *"and it was not so"*, which is why a whole wave went
by without a cause — so the first change was to make an expectation keep what it
observed (SF-11 asks for exactly that: "Checks returning false use
`failed/CHECK_FAILED` while retaining the actual observed value"). It then said:

```
✗ The toolbar title should contain "Flows"
    Expected textContains "Flows" of "the toolbar title", and it was not so;
    what was there was "Surfaces".
```

*Surfaces* — the application had not finished navigating. Traced directly over
CDP, polling every 100 ms after a click on the Flows rail item:

```
clicked the Flows rail item
t+0ms    title="Surfaces"  save=visible
t+100ms  title="Surfaces"  save=visible
t+200ms  title="Flows"     save=visible
```

**The Save flow button becomes visible up to 200 ms before the toolbar title
beside it changes.** Wave 4's mitigation was to wait by resolving that button —
which arrives *earlier* than the thing being asserted, so it closed nothing. The
accessibility side agreed with the application only because a native tree read of
a thousand nodes is slow enough that the frame has always landed.

The cause is that **an expectation was evaluated exactly once**, which wave 4
named and declined to fix ("polling element expectations is a runtime change and
is named here rather than made"). It is made here: `config.run.expectTimeoutMs`
(default 2 s; `0` restores the single evaluation) re-asks an expectation until it
holds. A **guard** is deliberately not polled — "only if the login error is
hidden, click sign in" is a question asked now, and one that waited would change
what the sentence means and delay every step it guards.

Six runs of the same flow after the change:

```
run 1..6: 6 passed, 0 failed, 0 skipped   (was 3 of 6 before)
```

`packages/runtime/test/expectations.test.ts` holds both sides, including the
negative case shown *failing*: with `expectTimeoutMs: 0` the same screen that the
budget catches fails, and asks exactly once.

**`app.record-opens-and-every-control-on-it-is-named-and-id-d` — the Yam side
was wrong, and wave 4's T20 had already fixed it.** The disagreement was that Yam
could not resolve `app.record-fake-gateway`, a note that renders only for a
running fake-gateway session; the external side passed. Asserting it
unconditionally was the flow's error, not the application's — a screen's default
gateway depends on whether the host has a display. T20's defect 5 rewrote that
story to assert what is true of the *control* rather than of one machine's
default, and `app.record-fake-gateway` is referenced by no flow on this branch:

```
$ grep -rn "record-fake-gateway\|fake gateway note" evals/self --include=*.flow
(no matches)
```

**A third thing the gate got wrong, found by running it.** Two checks were
reported one-sided with *"the catalogue names something the source does not
have"* — blaming the catalogue for what the host did. When the accessibility run
is stopped part-way by a locked display, every story after that point produces no
result, and a missing name means "this machine could not be asked" rather than
"the catalogue and the source disagree". `SourceAnswers.hostStopped` carries the
host's own sentence forward, and a name the source did not answer for is
`unreachable` with it.

### The parity report

```
$ node scripts/seed-app-recents.mjs
$ node packages/cli/dist/bin.js eval self --update
```

```
Run at 2026-09-09T06:17:28.151Z on darwin arm64, Node v25.6.1.
**100 percent agreement** over the 32 check(s) both sides reached.
The gate passes only at 100 percent (REQ-SELF-2).

| Checks reached | Yam 34 of 52 | External 50 of 52 |
```

Master's copy read **not conformant, 4 disagreements over the 14 both sides
reached, Yam reaching 16 of 52**. The denominator is the part worth looking at:
SF-21 says a high agreement percentage on a small reachable subset cannot
satisfy coverage, so *thirty-two agreed* matters where *four agreed* would not.

All three checks this wave touched now pass on both sides:

| Check | Was | Now |
|---|---|---|
| `app.screen-through-two-adapters` | AX passed, CDP failed on the toolbar title | **pass / pass** |
| `app.record-opens-and-every-control-on-it-is-named-and-id-d` | Yam could not resolve a note that renders only for a fake-gateway session | **pass / pass** |
| `cockpit.pseudo-terminal` | one-sided: *"driving a terminal needs a pseudo-terminal adapter, and Yam has none"* | **pass / pass** — T22 built the adapter, and the Yam-on-Yam suite drives `yam ui --capture` through it |

`cockpit.json-is-the-model` stays one-sided, and its reason is rewritten rather
than left: T22 removes the *adapter* half of the old excuse and not the rest.
Yam can run a command in a terminal and read its screen; comparing `--json` with
the screen model ten times and diffing them is a program, not a flow. What is
missing there is a sentence, not an adapter, and the catalogue now says so.

The gate is `pnpm self`, several minutes, and is still a report rather than part
of `pnpm -r test`. The Yam-on-Yam suite *is* now part of CI, which is the gate
T00 was asked for.

### Validate

| T00 Validate item | Shown by |
|---|---|
| The intermittency is root-caused, and the cause is fixed rather than the symptom | The five defects above, each with how it was reproduced. `one-broker.test.ts` (14) and the three ownership cases in `contract-guard.test.ts`. |
| Ten consecutive runs, unattended, with their counts published | `pnpm yam-on-yam:repeat`, the table above, `evidence/wave-5/ten-runs.txt`, `ten-runs.json` and the ten `runs/run-NN/` directories with every check and every transcript. |
| Every pass declares its checks; a check not reached is a failure saying where it stopped | `JOURNEY_CHECKS`, `negativeChecks(kind)`, `WINDOW_ORACLE_CHECKS`, `TERMINAL_CHECKS`, `LAUNCH_CHECKS`, and `CHECKS_OF` mapping each pass to its list. Demonstrated by three hosts reporting the same 119 attempted. |
| The two disagreements resolved, with the oracle that was wrong named | `app.screen-through-two-adapters`: the **CDP** oracle, asking before the screen arrived — traced to a 200 ms gap and fixed by re-asking. `app.record-opens-…`: the **Yam** oracle, already fixed by T20 and referenced by no flow. |
| The parity report | `reports/self-parity.md`, regenerated from the run below. |
| The suite is a gate, behind the packaged build | `.github/workflows/ci.yml`'s `yam-on-yam` job, after `pnpm --filter @svatah/yam-desktop package`; exit 2 tolerated with a warning, exit 1 fails. |

```
pnpm -r build && pnpm --filter @svatah/yam-desktop package
pnpm yam-on-yam:repeat                       # ten runs, into evidence/wave-5/
node packages/cli/dist/bin.js eval self --update
```

---

## T21 — Add Streamable HTTP MCP

**Status:** complete.

**Requirement:** SF-08.

### The same server, a second transport

`yam mcp --http [--port n] [--token t] [--allow-origin o,o]`.
`packages/cli/src/commands/mcp-http.ts` connects the **same** `buildMcpServer`
the stdio command connects — the whole tool surface, generated from the
catalogue — to the SDK's `StreamableHTTPServerTransport`. No tool, schema,
annotation, route or flag is decided there; a transport that could add one would
be a second contract.

It is **not** `/v1`. The service's REST routes answer the same operations from
the same catalogue, which makes them a sibling rather than an instance: an MCP
client cannot initialize against them, list tools, or cancel a call with a
JSON-RPC notification. SF-08 says so and the test drives it — `GET /v1/sessions`
on this transport is a 404.

### Pinned, and an upgrade is a red build

`PINNED_PROTOCOL_VERSION = "2025-11-25"`, compared in a test with the SDK's own
`LATEST_PROTOCOL_VERSION` from `@modelcontextprotocol/sdk` **1.30.0** (pinned in
`pnpm-workspace.yaml` as `^1.30.0`). The cancellation and resumption semantics
below are that revision's; an SDK that moves makes the test red rather than
changing behaviour quietly.

### The corpus is the corpus, imported rather than copied

`packages/cli/test/mcp-corpus.ts` is eight cases written once against an ordinary
SDK `Client`: every catalogue operation is a tool, every tool has a schema and a
description, the primary journey, a failing postcondition, a stale reference, a
missing argument, an unknown session and an unknown tool. `mcp.test.ts` runs it
over **stdio, as a real subprocess**; `mcp-http.test.ts` runs the same list
unchanged over Streamable HTTP.

**A defect the corpus found**, in both transports at once. `design.md` says
"failed/refused tool executions carry `isError: true`", and no surface tool ever
set it: a `CHECK_FAILED`, a `STALE_REFERENCE` and a `CONTROL_BUSY` all arrived as
*successful* tool calls whose text happened to describe a refusal. An agent that
trusted the protocol rather than parsing the body was told every call worked.
`text()` now derives `isError` from the envelope's own status.

### Session isolation, driven rather than assumed

Each initialization builds its own `McpServer` and its own transport. What the
tests drive:

- two clients get different MCP session ids;
- a session id the server did not issue is a 404, so one cannot be borrowed;
- a surface lease taken by `agent-alpha` refuses `agent-beta` **by name** —
  which is the observable difference between two clients sharing a broker and
  one client with two connections;
- closing one client leaves the other usable;
- `terminateSession()` leaves nothing behind: the id afterwards is a 404;
- a client that disconnects **leaves its broker sessions open**, which is the
  rule stdio keeps (SF-05) and which a transport that tidied up would break by
  closing a browser somebody is looking at;
- a cancelled call is abandoned and the connection is still usable afterwards.

Authentication and origin: a request with no bearer token is 401 with
`WWW-Authenticate: Bearer` and a message naming the credential; a wrong token is
refused; an origin that was not named at start-up is 403 naming the origin; a
named one is accepted; the listener binds `127.0.0.1`. DNS-rebinding protection
is on, with loopback hosts and only the origins the caller named.

### Reconnect, and exactly how far it is proved

`createEventStore` gives the SDK the `Last-Event-ID` resumption the pinned
revision defines, bounded per stream, and the transport is constructed with it.
Four cases drive the store: it replays what came after the named event, does not
replay another stream's, answers nothing for an id it never issued, and forgets
an event past its bound rather than half-remembering it.

**What is not driven end to end** is a client losing a live stream and resuming
it: that needs a long server-initiated stream to interrupt, and a case built
around one would be measuring its own timing. So the claim here is bounded —
resumption is *offered* (the SDK does not offer it at all without a store) and
its store keeps its half of the bargain — rather than "a client reconnected and
got its messages", which nothing here has shown.

### Validate

| T21 Validate item | Shown by |
|---|---|
| Pinned protocol and SDK versions | `PINNED_PROTOCOL_VERSION` vs `LATEST_PROTOCOL_VERSION`, in a test; SDK `1.30.0` in `pnpm-workspace.yaml`. |
| Negotiated transport | `transport.protocolVersion` after a real handshake; `/health` publishes it before a client has a token. |
| Authentication | 401 with `WWW-Authenticate`, wrong token refused, loopback bind. |
| The stdio conformance corpus, unchanged | `MCP_CORPUS`, imported by both test files. |
| Session isolation between two clients, tested | Five cases above, including a lease refused by name. |
| Cancellation and reconnect of the pinned version | The cancellation case and the four event-store cases. |
| No accidental exposure beyond configured scope | Origin refusal, 404 on `/v1`, loopback. |
| The REST API is not called an MCP transport | Said in the module header and driven by the 404 case. |

```
pnpm --filter @svatah/yam exec vitest run test/mcp-http.test.ts   # 28 passed
pnpm --filter @svatah/yam exec vitest run test/mcp.test.ts        # 22 passed
```

---

## T22 — Deliver process/PTY

**Status:** complete on this host, with the platform limit stated.

**Requirement:** SF-22.

### The catalogue gains nothing

`packages/adapter-process` reaches the operations that already exist. What a
person does in a terminal maps onto the vocabulary that is already there:

| In a terminal | Operation | Action |
|---|---|---|
| read the screen | `snapshot`, `read`, `check` | — |
| type something | `act` | `type` |
| press Enter, ↑, or `^C` | `act` | `press` |
| clear the screen | `act` | `clear` |
| wait for a prompt | `act` | `waitFor` |
| end the program | `act` | `quit` |
| keep a copy of the screen | `act` | `screenshot` |
| what it exited with | `read` | `result` |

`press "Control+C"` is not a signal API bolted on the side: writing `0x03` to a
pseudo-terminal is what a keyboard does, and the terminal's line discipline turns
it into `SIGINT` for the foreground process group. The test proves the signal
arrived rather than that something killed the process — the program traps `INT`
and exits 42, and 42 is what the exit state says.

**One thing the catalogue did gain, and it is the design's own.** `design.md`
says "Adapter-specific launch details live in a typed nested options object or
config file", and `connect` had no way to carry any: a desktop adapter could not
be told a bundle and a terminal could not be told a program's arguments. One
typed `launch` object — `bundle`, `path`, `args`, `env`, `timeoutMs`, `size` — in
the catalogue, so it reaches the CLI (`--launch <json>`, or `--input` for one
with a secret in it), the MCP tool and the service route at once.

### A pseudo-terminal a caller can write to

The repository already reached a pty through `script(1)`, and its own note says
why that could only ever be half a terminal surface:

> Typing into a pseudo-terminal means writing to its *master*, and `script`
> gives a caller no way to reach one: its only input is its own stdin, which
> must already be a terminal.

Measured here: `script -q /dev/null …` with a piped stdin answers
`script: tcgetattr/ioctl: Operation not supported on socket` and exits 1.

So the allocator is a program the operating system already ships, and there are
two because no single one is on every host:

| Allocator | Where it is | Where it is not |
|---|---|---|
| `expect(1)` | every macOS install, and most BSDs | not installed by default on Debian/Ubuntu |
| `python3` with its `pty` module | every mainstream Linux | not on a stock macOS without the developer tools |

No dependency and no native build, which is the constraint that ruled out
`node-pty`. **Both are driven on this host** rather than one being claimed on the
strength of the other: `ProcessSurface({ allocator })` and `YAM_PTY_ALLOCATOR`
name one, and the test drives each and asserts which answered.

**A defect the driving found, in the allocator's own quoting.** The first version
built `expect`'s script by writing the command into it with Tcl brace quoting.
Inside `{ }` Tcl performs no substitution at all, so the backslashes the quoting
added *survived into the argument*: `echo hello $who` reached the program as
`echo hello \$who` and printed the variable's name. The command vector now
travels as environment variables, which have no quoting rules, and `{*}$cmd`
expands a list without re-parsing it — so no value a caller supplies is ever
parsed as Tcl.

### The snapshot is the screen, not the stream

A terminal's output is not its screen: a program that draws a table redraws it,
and the stream is a dozen overlapping copies. `screen.ts` keeps a grid and
applies the escape sequences a command-line program and a full-screen TUI
actually use — cursor movement, erase, scroll, insert and delete lines, wrap,
and SGR, which is discarded because a semantic snapshot is about what a screen
says. An unrecognised sequence is skipped rather than printed, so no escape byte
reaches the text, and an escape split across two chunks is held rather than
printed as characters. Twenty cases in `screen.test.ts`.

It is **not** a terminal emulator: no alternate screen buffer, no mouse, no
bracketed paste, no scrollback addressing. Said in the module header, in
`capabilities()` and in the support matrix rather than discovered.

### No shell, and no read outside the declared root

There is no shell anywhere: the command and its arguments are `exec`'d as a
vector, so a value containing `;` or `$(…)` is an argument — driven by a case
that passes `hello; touch <marker>` to `/bin/echo` and then checks the marker was
not created.

The declared root is `launch.path`. `read` with `kind: "attribute"` and
`name: "file:<path>"` reads under it and refuses outside it, and the containment
test is made on the **resolved real** path rather than on the string, because a
symbolic link inside the root pointing outside it is exactly what a check made
before resolution misses. Four cases: a file under the root; `..` climbing out;
an absolute path; a symbolic link that leaves.

**A negative case that passed for the wrong reason, corrected.** The suite's
out-of-root case first asked for `../../etc/hosts` from a temporary directory,
where that path does not exist — so the refusal was "there is no such file" and
the containment check was never reached. It now names a file that exists outside
the root, and asserts the refusal *says* `resolves outside`.

### Yam drives its own CLI and TUI through it

`evals/self/yam-on-yam/terminal.mjs` — twelve checks, run through both public
interfaces (`cli-terminal` and `mcp-terminal`), so the terminal surface is in the
same denominator and the same evidence file as everything else. It does not need
the packaged application, and on a host with no pseudo-terminal every check is
blocked with the probe's own sentence.

```
ok [cli-terminal] a terminal session opens on Yam's own command line
ok [cli-terminal] the terminal snapshot is the screen, not the stream
ok [cli-terminal] a command that succeeds exits 0, and the session says so
ok [cli-terminal] a command that fails exits nonzero, and the session says so — exitCode=21
ok [cli-terminal] a program that reads from stdin is typed into and answers — "name? ada\nhello ada"
ok [cli-terminal] a program is signalled by pressing Control+C — exitCode=42, screen "waiting\n^CCAUGHT"
ok [cli-terminal] the cockpit draws its panes in the terminal — the Flows pane is on the screen
ok [cli-terminal] a file under the declared root can be read
ok [cli-terminal] a file outside the declared root is refused — INVALID_ARGUMENT: … resolves outside
ok [cli-terminal] a symbolic link that leaves the root is refused — INVALID_ARGUMENT
ok [cli-terminal] the terminal refuses an action a terminal does not have — INVALID_ARGUMENT
ok [cli-terminal] the session closes
```

The cockpit check is the one a pipe cannot make: Ink asks whether its output is a
terminal and draws nothing when it is not, so panes on the screen mean a real
pseudo-terminal. `--capture <ms>` is the product's own flag, not a test hook.

**A defect in an error code, found by the refusal case.** A terminal refusing
`click` answered `TIMEOUT` — the same shape as wave 4's defect 3, where an agent
reads "try again" for a request no retry can fix. `DataError` now maps to
`INVALID_ARGUMENT` in the dispatcher, which is what a `DataError` has always
meant: the caller's argument, and nothing dispatched.

### Validate

| T22 Validate item | Shown by |
|---|---|
| Terminal snapshot | `screen.test.ts` (20), the `snapshot` case in `surface.test.ts`, and the suite's "the snapshot is the screen, not the stream". |
| Input | `type` and `press`, with a program that reads from a terminal. |
| Streams | `read` `attribute: "stream"` beside the screen, and the case that shows they differ. |
| Signals | `Control+C` → `SIGINT` → the trap runs → exit 42; `quit` is SIGTERM then SIGKILL. |
| Exit state | `read kind: "result"`, and `check` with a `value` predicate over the exit code. |
| Bounded artifact and filesystem access | Four root cases, including the symbolic link; `screenshot` writes the screen as text. |
| Yam drives its own CLI and TUI | `cli-terminal` and `mcp-terminal`, twelve checks each. |
| Exit codes and state checked | `exitCode=0` for `--version`, `exitCode=21` for a bad session, `exitCode=42` for the signal. |
| No undisclosed shell escape | No shell at all; the metacharacter case proves it. |
| No read outside the declared root | The three refusals. |
| CLI tests reported as externally driven until this lands | No longer needed; the support matrix now carries a `process` row derived from these runs. |

```
pnpm --filter @svatah/yam-adapter-process exec vitest run      # 40 passed
YAM_ON_YAM_PASSES=cli-terminal node evals/self/yam-on-yam/run.mjs
```

---

## T23 — Expand native/mobile coverage

**Status:** the discovery and capability gaps are **closed and validated here**;
AT-SPI is **implemented and unvalidated here**, with what would have to be true.
That split is the honest answer and is what the support matrix says.

**Requirement:** SF-23.

### Support labels are derived from runs, never from a dropdown

The gap, in wave 4's own words:

> Neither is `available: true`, which means registered and on a matching
> platform — a claim about this machine, not about the adapter.

`appium: available` on a machine with no Appium server; `bidi: available` with no
browser started with a BiDi endpoint. Both were true about a
`Record<string, string[]>` and false about the host — and SF-09 asks readiness to
report "adapter version, readiness and reasons for unavailable operations", of
which there was no version at all.

`packages/surface-control/src/probes.ts` asks the host instead. `yam surface
targets` and the coverage report use it; `connect` keeps the cheap table answer,
because a probe on the path of every session would put a process spawn in front
of one, and the adapter refuses with its own sentence a moment later anyway.

What this host answers, which is the run the labels come from:

```
appium      available=false  no Appium server answered at http://127.0.0.1:4723 …
atspi       available=false  AT-SPI is Linux's accessibility bus; this host is darwin.
ax          available=true   macOS 26.3
bidi        available=false  no BiDi endpoint is named. Start Chrome or Firefox with one …
http        available=true   v25.6.1
playwright  available=true   Version 1.62.1
process     available=true   expect version 5.45
uia         available=false  UI Automation is Windows'; this host is darwin.
```

Every adapter also carries the **version range this repository has driven**
(`DRIVEN_RANGES`), which is what a reader deciding whether their Appium 1.x will
work needs — and it is deliberately not a claim about versions nobody here ran.

### AT-SPI

`packages/adapter-atspi` implements the Linux desktop through AT-SPI2, reaching
the accessibility bus with `python3`+`pyatspi` (the binding every Linux
accessibility tool already uses) and probing it with `gdbus`, which ships with
GLib — the same "a program the operating system already has" pattern as the
terminal surface's `expect` and the macOS adapter's `osascript`. No native
module, no licence outside REQ-PKG-3's set.

`ATSPI_ROLE_MAP` joins the published role tables in `packages/surface/src/roles.ts`
and the generated table in `docs/agent-surface.md`, so `push button`, `AXButton`
and `Button` all land on `button` — which is what makes one recorded binding
resolve on three platforms.

**What is validated, and where.** Everything above the bridge is a pure function
of an `AtspiNode[]`, and all of it is driven by
`packages/adapter-atspi/test/tree.test.ts` (33 cases) on this machine, with no
bus anywhere: the role table including the enumeration spelling a toolkit may
pass through, the state **inversion** (AT-SPI has `enabled` and no `disabled`,
`showing` and no `hidden`), the naming order, reference scope across
generations, the index path a command addresses an element by, `interactiveOnly`,
the action-preference selection, and every refusal — a stale reference, a
candidate kind this surface cannot answer, a gesture the element declares no
action for, a web action, a screenshot it will not fake.

**What is not validated, plainly.** `bridge.ts`'s conversation with a live
registry has never been run: no Linux runner is provisioned for this repository.
The support matrix says *implemented, unvalidated here*, and for it to become
*validated* all of the following would have to be true on a provisioned runner:

1. a Linux host with a session bus;
2. toolkit accessibility on, and `at-spi2-registryd` running;
3. `python3` with `pyatspi`;
4. an application publishing a window on the bus.

`probeAdapter("atspi")` answers with which of those it could not find. Nothing in
the coverage report counts an AT-SPI row as passing.

### Validate

| T23 Validate item | Shown by |
|---|---|
| AT-SPI implemented against the same extension contract | `packages/adapter-atspi`, registered in `packages/cli/src/adapters.ts` like every other adapter; role table in the shared vocabulary and the generated doc. |
| Discovery and capability gaps closed for Appium, UIA and BiDi | `probes.ts`: each is a probe with a version or a reason; `probes.test.ts` (9 cases) asserts the *rule* rather than this machine's answer. |
| Each newly supported capability has a reproducible conformance result | `tree.test.ts` (33) for AT-SPI's mapping; `surface.test.ts` (40) for the terminal; both in `pnpm -r test`. |
| Limitations and version range | `DRIVEN_RANGES` per adapter, published in the coverage report and the support matrix; the AT-SPI limitations are the four conditions above. |
| Support labels evidence-derived | The coverage report's adapter table is built from probes and from the transcript of the run it comes from. |
| A platform with no runner stays unvalidated with the reason | `atspi` and `uia` on this host; `appium` and `bidi` likewise, each with what would have to be true. |

---

## How this is committed

Four commits, `T00`, `T21`, `T22`, `T23`, in that order. They are a **reading
order, not four independently green trees**, and it is worth saying so rather
than implying otherwise: several files carry more than one task's change —
`dispatcher.ts` has T00's ownership mode and T22's launch object,
`surface-control.ts` has T00's start lock and T22's `--launch`, `checks.yaml`
has T00's parity work and T22's cockpit side — and splitting those by hunk would
have produced commits that do not build, which is worse than a commit that
carries two tasks' lines.

The gate is green at the tip, and every artefact was generated there.

## The artefacts, and when they were made

Wave 4's worst defect was an evidence file written twenty-six minutes before the
screen it describes was changed. So the order here is written down:

1. every line of code for T00, T21, T22 and T23 was finished;
2. `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm lint` — green;
3. `pnpm --filter @svatah/yam-desktop package`;
4. the ten runs;
5. the browser-hosted renderer suite, into the same wave directory;
6. `node scripts/coverage-report.mjs` and `node scripts/docs.mjs`;
7. `node packages/cli/dist/bin.js eval self --update`.

Nothing was changed after step 1 that the artefacts describe. Twice during this
wave a string was changed after a batch of runs had started, and both times the
batch was **thrown away and re-run** rather than reasoned about — once for a
change to `run.mjs`'s exit codes, once for two words in a probe's message that
the suite never reads. The second was almost certainly harmless and it cost
twenty minutes to not have to say so.

The coverage report and the support matrix are generated from
`evidence/wave-5/`, and the path is no longer written down anywhere: both
scripts take the newest `evidence/wave-N` directory, because a path that has to
be edited every wave is a path that will be forgotten, and the failure it invites
is a page that keeps rendering a previous wave's runs.

## A defect the wave's own gate found, in the gate

`pnpm -r test` was red at the end of this wave, on
`apps/desktop/test/shell.spec.ts` — *"the Record review chooses its gateway and
says what a fake session is"*, failing because `#record-fake-gateway` was not on
the screen. It passed run on its own and failed run after another.

**It is not this wave's defect, and this wave is why it is visible.** Those
thirty-eight Playwright cases *skip without a packaged build*, which is T18's
first defect still doing its work: a tree with no packaged build is what
`pnpm -r test` runs in, so they had been dormant. Wave 5 packages the
application because the Yam-on-Yam suite needs one — and they ran. Checked
against `master` in a worktree of its own:

```
master, no packaged build:   Test Files 7 passed; Tests 123 passed; 38 skipped
master, packaged:            1 failed, 37 passed
                             ✘ the Record review chooses its gateway …
```

The same case, the same way, on the code this branch started from.

The cause is in the case. It walks Radix's select by keyboard, and it walked
straight from `waitFor` on the listbox into `ArrowDown` — the listbox *existing*
is not the listbox *listening*, so the presses made while the portal was still
mounting went nowhere, `Enter` took whatever was under it (`human`, the current
value), and the failure surfaced three lines later on the note, saying only that
an element was not found. It now waits for something to be highlighted, walks by
re-reading the highlight after each press, and **asserts what was chosen before
asserting what the choice makes the screen say** — so a mis-selection fails at
the selection. Three consecutive runs of the whole desktop suite: 38 passed,
38 passed, 38 passed.

**And a mistake of mine, on the way to finding it.** I read `pnpm -r test`'s
result from a compound shell command whose exit status was a `grep`'s, and said
the suite was green when it had stopped at `packages/cli`. It is the same error
in the same family as the ones this wave exists to remove — a harness's own
state read as a product result — and it is written here because a record that
only lists the product's defects is not the record this project keeps.

## Deviations

- **T23's AT-SPI is implemented, not delivered.** SF-23 says "Deliver Linux
  AT-SPI", and what is here is an adapter whose pure half is fully driven and
  whose bridge has never spoken to a registry. Writing a thousand lines of D-Bus
  conversation that nothing can run and calling it delivered is the exact failure
  this wave's own contract names — "something was asserted about the code rather
  than the product" — so it is labelled for what it is, in the code, in the
  support matrix and here. What would make it delivered is a Linux runner, and
  the four conditions are written down.
- **An expectation now polls, which wave 4 declined to change.** Wave 4 recorded
  it as a runtime change and did not make it. It is made here, because the
  measurement above shows the parity gate's longest-lived disagreement was
  nothing but a screen half-arrived, and because a suite whose expectations are
  coin flips cannot be a gate. `expectTimeoutMs: 0` restores the old behaviour
  and is kept under test.
- **`connect` gained one flag.** The wave's decisions say a new adapter gets no
  flag the catalogue does not define; this is a flag the *catalogue* gained, in
  the one place that generates the CLI, the MCP tool and the route together, and
  it is `design.md`'s own "typed nested options object". Without it the terminal
  surface could run no program with arguments and the desktop adapters could not
  be told a bundle.
- **The accessibility side was blocked for most of this wave, and is not blocked
  in the artefacts.** The display was locked while the work was done, and while
  it was, every AX row of the Yam-on-Yam suite and the whole `yam` source of the
  parity gate were `blocked`/`unreachable` with the doctor's own sentence and
  the Finder cross-check — counted, never omitted, never counted as passing.
  **The ten runs and the parity report committed here were made with it
  unlocked**, so their accessibility rows are real results: `cli-ax` and
  `mcp-ax` pass seventeen checks each in all ten, and the one blocked check on a
  healthy run is axe-core's licence. This bullet claimed the opposite until
  verification read the evidence against it. The header of this record had it
  right; the deviation was left over from the locked half of the wave.

## Known gaps

- **AT-SPI has no runner**, so its bridge is implemented and undriven. Above,
  with the four conditions.
- **Twenty of the parity gate's fifty-two checks are still one-sided**, each
  naming what Yam lacks. They are the list LLD §13.9 expects to shrink wave by
  wave; this wave shrank it by one, and the one it shrank is the cockpit, which
  had been waiting for the terminal surface since phase 9.
- **Windows UIA, Appium and BiDi remain unvalidated**, each now with a probe's
  reason and a driven version range rather than a platform table's silence.
- `permission-denied` in the desktop is still undriven, as since wave 3.

---

## Verification of wave 5

Done against the verification contract in
[wave-5-implementation.md](../wave-5-implementation.md). **Two defects**, both
in the record and its artefacts rather than in the product — which is the first
time in five waves that verification has not found a defect in the code, and is
worth saying plainly rather than leaving to be inferred from a short list.

| # | Defect | Found by | Fix |
|---|---|---|---|
| 1 | **A deviation contradicted the evidence.** *"The accessibility side of everything is blocked on this host. The display is locked for the whole wave. Every AX row … `blocked`"* — while the header of the same record says the ten runs were made with it unlocked, and all ten evidence files show `cli-ax` and `mcp-ax` passing seventeen checks each with one blocked check in total. The bullet was left over from the locked half of the wave. | Reading the deviations against `per-run/run-01/yam-on-yam.json`. | Rewritten to say both halves: blocked while the work was done, unlocked for the artefacts, and which of the two the committed numbers are. |
| 2 | **Forty of the forty-five megabytes of evidence were redundant.** Each run leaves a 4 MB machine-readable transcript, and ten of them went into a repository whose whole history is sixty-six — for content the record does not list among a run's artefacts and that is byte-for-byte the same calls with different session ids. Committed evidence is forever. | `git diff --numstat`: eleven files of 160 000 lines each, 1.76 M of the branch's 1.79 M inserted lines. | The per-run machine transcripts are removed and `yam-on-yam-repeat.mjs` no longer keeps them, so it does not recur. Each run still has every check with its outcome, the transcript in the form a person reads, the screenshot and the DOM — the four the record names — and the last run's machine-readable transcript stays at the top of the wave directory, which is the one the coverage report reads. Evidence: **53 MB → 13 MB**. |

### The claim this wave exists to make, re-measured

T00's whole subject is that one green run proves nothing. So the suite was run
here, on this machine, with **nothing cleaned between runs** and nothing cleaned
before the first beyond what the suite does itself:

| Run | Passed | Failed | Blocked | Attempted | Exit |
|---|---|---|---|---|---|
| 1 | 118 | 0 | 1 | **119** | 0 |
| 2 | 118 | 0 | 1 | **119** | 0 |
| 3 | 118 | 0 | 1 | **119** | 0 |
| 4 | 118 | 0 | 1 | **119** | 0 |
| 5 | 118 | 0 | 1 | **119** | 0 |
| 6 | 118 | 0 | 1 | **119** | 0 |

The sixth is the single run used to check that the evidence trim above behaves.
Six for six, the same denominator every time, on a machine that had just built,
packaged and run the whole gate. Wave 4's runs of the same suite on the same
machine gave 24 of 33, 36 of 41, 91 of 91, 20 of 25, 29 of 76 and 12 of 42.

### What was verified, and how

| Contract step | Result |
|---|---|
| The gate with no credential; tree clean; `pnpm docs --check` | Green. 32 packages, lint, 71 generated pages current. |
| **Five consecutive unattended runs, same attempted count, no failures** | Six, above. |
| `reports/self-parity.md` conformant, and the wrong oracle named | **100 percent agreement over 32 checks** both sides reached, none disagreeing — against master's *not conformant, 4 disagreements over 14*. Both resolved oracles are named in T00. |
| Streamable HTTP driven by a client the repository does not own | The SDK's own `Client` over a real listener, 28 cases in the gate. Driven again by hand here: `/health` publishes `2025-11-25` before any token, no token is `401` with `WWW-Authenticate: Bearer realm="yam"`, and `GET /v1/sessions` on that port is `404`. |
| A real terminal: nonzero exit, stdin, a signal, no read outside the root | Driven by hand through `yam surface`: `--app /bin/sh --launch '{"args":["-c","echo hello; exit 21"]}'` reads back `exitCode: 21`, the screen says `hello`, and `file:/etc/hosts` is refused `INVALID_ARGUMENT`. The signal and stdin cases are the suite's `cli-terminal` pass, in all six runs above. |
| The support matrix read against the runs it came from | Every adapter's label derived; `ax`, `playwright` and `process` **validated** with the session kind each opened; `appium`, `atspi`, `bidi` and `uia` carry the probe's own sentence and what would have to be true. |
| The fixture project unchanged | The suite's own oracle, in all six runs. |
| Packed artifacts, copied commands verbatim | 11 of 11, and the coverage report **reproduced independently here**: re-running it gave the same 300 of 300 reached, 6 blocked, 306 attempted, differing only in a timestamp, the temporary directory's name and timing jitter of a few milliseconds. The wave's own copy is what is committed, because it was generated in the order this record sets out. |
| The desktop's dormant Playwright cases | 38 passed against the packaged build — the cases T18's first defect had been hiding, which this wave is why anyone can see. |

### Known gaps after verification

Unchanged from the wave's own list, and none of them is newly discovered:

- **AT-SPI is implemented and unvalidated**, with the four conditions a Linux
  runner would have to meet. The support matrix says so and nothing counts it as
  passing.
- **Twenty of the parity gate's fifty-two checks are one-sided**, each naming
  what Yam lacks.
- **Windows UIA, Appium and BiDi are unvalidated**, each with a probe's reason
  and a driven version range.
- `permission-denied` in the desktop is still undriven, as since wave 3.
- The generated support matrix's *"Evidence, or the reason"* column joins the
  probe's sentence, the coverage reason and the prerequisite list with dashes,
  which reads as a run-on and repeats itself for the four unvalidated adapters.
  It is a rendering nit in a page a person choosing a platform reads; recorded
  rather than fixed here, because changing it changes a generated page and this
  verification's job was to test what the wave shipped.
