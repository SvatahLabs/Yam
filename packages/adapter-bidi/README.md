# @svatah/adapter-bidi

The WebDriver BiDi adapter: `AgentSurface` over the W3C protocol, against stock
browsers, with no driver SDK and no patched build (REQ-ADP-4, LLD §7.3).

It exists to prove the surface boundary (HLD ADR-8). Nothing in it shares a line
with `@svatah/adapter-playwright` — a WebSocket, a command table, an injected
script, and the same interface on top — so a plan that replays identically
through both is evidence that the boundary is real rather than a description of
Playwright.

```bash
pnpm bidi:independence          # the whole proof, and reports/adapter-bidi.md
svatah surface conform --adapter bidi
svatah run --adapter bidi       # via `adapter: bidi` in svatah.config.yaml
```

## Where the endpoint comes from

A browser exposes BiDi in one of two ways, and the adapter covers both.

| Route | How | For |
|---|---|---|
| Attach | `SVATAH_BIDI_URL=ws://…/session` | Stock Chrome and Edge through chromedriver / msedgedriver started with the `webSocketUrl` capability; geckodriver; a remote grid; a browser launched by hand |
| Launch | A Gecko binary, found in Playwright's browser cache, in `SVATAH_BIDI_BROWSER`, or installed on the machine | CI and the default developer loop |

Firefox's remote agent *is* a BiDi server: `firefox --remote-debugging-port=0`
prints `WebDriver BiDi listening on ws://127.0.0.1:<port>` and serves the
protocol at `<url>/session` with nothing else in the loop. Chrome and Edge expose
CDP rather than BiDi on their remote-debugging port, so their driver hosts the
BiDi mapper and the adapter attaches to it — which is what the W3C protocol
intends and is not a Svatah-specific arrangement:

```bash
chromedriver --port=9515 &
# start a session with { "alwaysMatch": { "webSocketUrl": true } } and read
# `capabilities.webSocketUrl` from the response
SVATAH_BIDI_URL=ws://127.0.0.1:9515/session/<id> svatah surface conform --adapter bidi
```

`svatah surface conform` prints which binary or URL answered, and
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
`@svatah/adapter-playwright` for the thing it is meant to be an independent
implementation of would prove the opposite. What keeps the copy honest is
`packages/cli/test/snapshot-parity.test.ts`, which drives both adapters over the
same pages and requires the same roles, names and states (REQ-SURF-4).

## Environment

| Variable | Meaning |
|---|---|
| `SVATAH_BIDI_URL` | A running BiDi endpoint to attach to |
| `SVATAH_BIDI_BROWSER` | The Gecko binary to launch |
| `SVATAH_BIDI_TRACE=1` | Print every BiDi message sent and received |
