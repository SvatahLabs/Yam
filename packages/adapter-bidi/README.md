# @svatah/yam-adapter-bidi

The WebDriver BiDi adapter: `AgentSurface` over the W3C protocol, against stock
browsers, with no driver SDK and no patched build (REQ-ADP-4, LLD §7.3).

It exists to prove the surface boundary (HLD ADR-8). Nothing in it shares a line
with `@svatah/yam-adapter-playwright` — a WebSocket, a command table, an injected
script, and the same interface on top — so a plan that replays identically
through both is evidence that the boundary is real rather than a description of
Playwright.

```bash
pnpm bidi:independence          # the whole proof, and reports/adapter-bidi.md
yam surface conform --adapter bidi
yam run --adapter bidi       # via `adapter: bidi` in yam.config.yaml
```

## Where the endpoint comes from

A browser exposes BiDi in one of two ways, and the adapter covers both.

| Route | How | For |
|---|---|---|
| Attach to a **server** | `YAM_BIDI_URL=ws://…/session` | geckodriver, Firefox's remote agent, a remote grid — an endpoint where no session exists yet |
| Attach to a **session** | `YAM_BIDI_URL=ws://…/session/<id>` | Stock Chrome and Edge through chromedriver / msedgedriver started with the `webSocketUrl` capability |
| Launch | A Gecko binary, found in Playwright's browser cache, in `YAM_BIDI_BROWSER`, or installed on the machine | CI and the default developer loop |

The two attach shapes differ by one path segment and behave completely
differently (LLD §7.3, Draft 2.6). A bare `/session` is a server: the adapter
creates a session with `session.new`. A `/session/<id>` is a session someone
already created through a driver, and `session.new` there is answered with
`session not created: session already exists` — so the adapter does not send it,
and learns the browser from `session.status` instead. It also leaves that session
alone on close: it did not create it, and whoever did will `DELETE /session/<id>`
when they are finished.

Firefox's remote agent *is* a BiDi server: `firefox --remote-debugging-port=0`
prints `WebDriver BiDi listening on ws://127.0.0.1:<port>` and serves the
protocol at `<url>/session` with nothing else in the loop. Chrome and Edge expose
CDP rather than BiDi on their remote-debugging port, so their driver hosts the
BiDi mapper and the adapter attaches to it — which is what the W3C protocol
intends and is not a Yam-specific arrangement:

```bash
chromedriver --port=9515 &
# start a session with
#   { "alwaysMatch": { "webSocketUrl": true, "unhandledPromptBehavior": "ignore" } }
# and read `capabilities.webSocketUrl` from the response
YAM_BIDI_URL=ws://127.0.0.1:9515/session/<id> yam surface conform --adapter bidi
```

`unhandledPromptBehavior: "ignore"` is not optional. Without it the driver
answers every dialog itself the moment it opens — WebDriver's default is
*dismiss and notify* — so a confirm a flow says to accept is already dismissed
when the adapter tries to accept it. The adapter asks for `ignore` on the
sessions it creates; on a session a driver hosts, whoever creates it has to.

`node scripts/bidi-independence.mjs` runs exactly those commands for you whenever
a chromedriver or msedgedriver is on `PATH` or named by `YAM_CHROMEDRIVER`,
and records the browser it reached in `reports/adapter-bidi.md`.

`yam surface conform` prints which binary or URL answered, and
`reports/adapter-bidi.md` records it, because "BiDi passes" is not a result
without it.

## What BiDi cannot do

Capability flags declare it rather than emulating it (LLD §7.3). The executor
refuses a plan whose actions need a missing capability at start, not mid-run.

| Flag | | Why |
|---|---|---|
| `dialogs` | yes | `browsingContext.userPromptOpened` and `handleUserPrompt` |
| `frames` | yes | Frames are browsing contexts; `switchFrame` narrows to one |
| `windows` | yes | `contextCreated` / `contextDestroyed` |
| `upload` | yes | `input.setFiles` |
| `drag` | yes | `input.performActions` pointer streams |
| `screenshot` | yes | `browsingContext.captureScreenshot`, masked by a page overlay |
| `restore` | yes | Navigate plus `storage.setCookie` |
| `trace` | **no** | BiDi has no tracing. Playwright's trace viewer is a Playwright artefact; a file this adapter wrote would be a different thing with the same name |
| `webmcp` | **no** | REQ-ADP-9, P2 for every adapter |

## Two things the adapter has to do that Playwright does for you

**Actionability.** There is no "wait until this button is ready" in the protocol,
so `session.ts` implements the wait LLD §7.3 names — visible, enabled, and a box
unchanged over two frames — and no caller above the surface has to.

**Accessible names and roles.** BiDi exposes the DOM, not an accessibility tree
with references. `page-script.ts` computes both. It is a *port* of the Playwright
fallback's walker, copied rather than imported: an adapter that reached into
`@svatah/yam-adapter-playwright` for the thing it is meant to be an independent
implementation of would prove the opposite. What keeps the copy honest is
`packages/cli/test/snapshot-parity.test.ts`, which drives both adapters over the
same pages and requires the same roles, names and states (REQ-SURF-4).

## Environment

| Variable | Meaning |
|---|---|
| `YAM_BIDI_URL` | A running BiDi endpoint to attach to |
| `YAM_BIDI_BROWSER` | The Gecko binary to launch |
| `YAM_BIDI_TRACE=1` | Print every BiDi message sent and received |
