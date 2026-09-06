# Use the desktop app

The desktop app is an Electron client for the local
service, and the service's reference client. Every screen renders a service
response or a project file, and nothing the command line cannot produce: the
project directory is the only source of truth, and the app stores a theme, a
window size and a list of recent projects and nothing else.

## Run it

Installers for macOS, Windows and Linux are attached to each release. From a
checkout:

```bash
pnpm -r build
pnpm --filter @svatah/yam-desktop start
```

The app spawns `yam serve` on the project you open, reads the bearer token
from its stdout, and talks to it over HTTP and an event stream. Set
`YAM_APP_PROJECT=<dir>` to open a project at start, and `YAM_NODE` to name
the Node runtime the packaged app should use when none of Node 22 is on `PATH`.

## The screens

| Screen | What it shows |
|---|---|
| Project | the config, the flows, the stories with their signatures |
| Flows | the prose editor with lint, and the plan each flow compiles to |
| Record | a recording session: each grounding decision, reviewable before it is written |
| Run | a run with live step events, and the results table |
| Runs | run history, results, audit and screenshots |
| Bindings | the store, and a heal review with the proposed diff |
| API | named requests, and an ad hoc client |
| Data | `data.yaml` with secrets redacted |
| Explorer | the raw surface: snapshot, act, read, check against a live session |
| Agents | the tool panel: which stories are exposed and why others are not |
| Import | a prototype database into the open project |

The command palette reaches every screen and every action; every control has a
name, because the app is also the desktop conformance target for the macOS
Accessibility and Windows UI Automation adapters.

## The same thing from a terminal

`yam ui` is the same screen model rendered in the terminal, and
`@svatah/yam-sdk` is the same client as a library; `pnpm self:sdk` checks that
the app, the terminal and the SDK agree on every screen. The HTTP API they all
use is [generated from the service's OpenAPI description](../reference/generated/http-api.md).
