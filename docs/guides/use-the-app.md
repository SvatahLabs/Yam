# Use the desktop app

The desktop app is an Electron client for the local service, and the service's
reference client. Every screen renders a service response or a project file, and
nothing the command line cannot produce.

**It opens on Surfaces**: connect to something, look at it, act on it, check
what happened. No project is needed for any of that, and none is opened until
you ask for one.

## Run it

Installers for macOS, Windows and Linux are attached to each release. From a
checkout:

```bash
pnpm -r build
pnpm --filter @svatah/yam-desktop start
```

Set `YAM_APP_PROJECT=<dir>` to open a project at start, and `YAM_NODE` to name
the Node runtime the packaged app should use when none of Node 22 is on `PATH`.

With no project named, the app starts a service on a private workspace of its
own and comes up on Surfaces. That workspace is not a project: nothing is
written to it, it is not remembered, and the screens that need a project say so
rather than pretending it is one.

## Surfaces

![Surfaces with nothing connected](../spec/surface-first/evidence/wave-5/surfaces-empty-1440x1000.png)

Type a URL, press **Connect surface**, and the session appears in the list with
the adapter the service actually used — not the one you asked for. Discovery
below it is grouped by what a thing *is* — a browser, an app, a device, an API —
and anything unavailable shows the exact prerequisite it is missing rather than
being hidden.

![A connected surface, with its tree and the action inspector](../spec/surface-first/evidence/wave-5/surfaces-connected-1440x1000.png)

Connected, the screen is the surface's semantic tree on the left and the
selected control on the right. Choosing a control opens the form for what you
can do to it — a fill takes a value, a click takes nothing, a drag takes a
second reference — and only actions the adapter can actually complete are
offered, so "choose an action" is never a dead end.

![An action that was dispatched and verified](../spec/surface-first/evidence/wave-5/surfaces-acting-1440x1000.png)

**Dispatch and verification are two separate answers.** An action that reached
the control but was not checked reads *"Dispatched. Not verified — no
postcondition was given."* Add a postcondition and it reads *"Dispatched and
verified"* — or *"Dispatched, but the postcondition did not hold"*, keeping the
value it observed beside the one you expected. Nothing is called verified
because it was sent.

### Copy command and Copy MCP call

Beside **Act**, **Copy command** and **Copy MCP call** put the action the form
holds *now* on the clipboard: your session, your control, your value. The first
is a `yam surface act` line for a POSIX shell (bash, zsh, sh); the second is the
JSON-RPC `tools/call` for `surface_act` an MCP client would send. **What Copy
command and Copy MCP call copy** opens both, with what each assumes.

- **Arguments never meet the shell.** They are passed with `--input -` from a
  quoted heredoc, which expands nothing, so a value with quotes, `$` or a
  newline arrives exactly. cmd and PowerShell have no heredoc; use a file with
  `--input <file.json>` there.
- **A reference expires.** It belongs to the snapshot it was chosen from
  (`--snapshot`), and once the page changes the command is refused as stale
  rather than aimed at whatever is there now. `surface_act` takes no snapshot:
  the MCP call is accepted while a snapshot of the page as it is now contains
  the reference.
- **A password is written into neither.** When the control is a password field,
  the command reads the value from `YAM_SECRET` — set it first, for example
  with `read -rs YAM_SECRET` — and marks it with `--secret`; the MCP call has
  `<YAM_SECRET>` in `args.value` and in `secrets`, for you to replace in both.
- The postcondition in **Verify afterwards** is a separate call
  (`yam surface check`, `surface_check`) and is not copied. While somebody holds
  the target, a copied command from anywhere else is refused, like any other.

### The preview

**Preview**, above the tree, draws a picture of the surface. Pointing at it
draws the box of the control under the pointer and names it; clicking selects
that control, exactly as its row in the tree would. **Nothing is clicked in
the application**: the preview is a way of finding a control, and the inspector
is still where anything is done to it. The picture has no keyboard of its own —
the tree is the same selection, and it is the one a keyboard and a screen
reader use.

The picture is retaken with the tree every time the screen loads, so selecting
a control takes a new one. Its limits:

- A box is in the adapter's units and the picture is in pixels, and no adapter
  reports the ratio. It is inferred — from a box that spans the whole picture,
  from the PNG's own pixels-per-inch (macOS marks a Retina capture 144), or, for
  a web page, one pixel per CSS pixel — and the caption says which. A browser
  joined with its own zoom, a display scaled by a fraction, or a capture of a
  different display will not line up; hovering shows where each box lands
  before anything is selected.
- It can only select controls whose boxes the snapshot carries. The Playwright
  adapter's own walker gives them; when it uses Playwright's AI snapshot instead
  (`YAM_PW_SNAPSHOT=playwright`, or `auto` where the installed Playwright offers
  one) there are none, and the caption says so. The tree still selects, and
  `YAM_PW_SNAPSHOT=own` in the broker's environment brings the boxes back.
- Desktop adapters capture the whole screen, and need the Screen Recording
  permission on macOS; without it the preview says why there is no picture and
  the tree carries on.
- The snapshot and the picture are two calls, so a page that moves between them
  can put a box over the wrong pixels.
- There are still no pixel *actions*.

The screenshots above are the ones the verification harness takes, at
1440×1000. Regenerate them, and the ones at 1280×800 and at 200% zoom, with:

```bash
SURFACES_EVIDENCE_DIR=docs/spec/surface-first/evidence/wave-5 \
  pnpm --filter @svatah/yam-desktop exec node test/surfaces-dogfood.mjs
```

## Sharing a surface with an agent

**Connect an agent** on Surfaces offers a generic MCP configuration — the
installed binary, no plugin — and a connection test. An agent using it reaches
the same broker, so a session either of you opens is one both of you see, and
the session list says who holds each target in words: *You control*, *agent-1
controls*, *Nobody*.

**Test the connection** checks two things and says which is which. The service
starts the server the configuration names, `npx -y @svatah/yam-mcp`, and speaks
MCP to it over stdio — `initialize`, `notifications/initialized`, `tools/list` —
then stops it: *MCP handshake: yam 0.1.0, 14 tools in 3.2 s*. And it asks the
broker an agent would share. The handshake calls no tool, so it says the server
starts, speaks the protocol and publishes its tools, and nothing about a
surface. The command is fixed in the service and never taken from the request;
the first run can take a while, because `npx` may be downloading the package,
and it gives up after 60 seconds with the step it was waiting on.

While somebody holds a target, an action from anybody else is **refused and
told who has it**, never queued and never silently retried. Taking control is
an explicit handoff, and the previous holder is released and told.

## The four sections

| Section | What is under it |
|---|---|
| **Surfaces** | discovery, sessions, the action inspector, connecting an agent. Opens by default. |
| **Automations** | flows, bindings, agents and tools, API, data, import — the screens that are *about* a project. A project is chosen here, not demanded at startup. |
| **Activity** | runs and their evidence. |
| **Settings** | connections, permissions, adapters, evidence retention, preferences. |

**Save as automation**, on Surfaces, promotes what a session actually did into a
proposal for review: one step per mutation, carrying the reference acted on and
what that element was. It writes a flow and its bindings under `proposals/`,
every binding marked unverified, and it runs nothing. With no project open it
says so and points at **Open a project** rather than writing into the private
workspace.

## What it does not do yet

- There are no pixel actions. The preview selects a control; it never clicks
  one.
- The preview cannot select on a surface whose snapshot has no boxes, which
  includes Playwright's AI snapshot; the tree always can.
- The connection test does not call a tool, so a completed handshake says
  nothing about whether a particular surface can be driven.

The [support matrix](../reference/generated/support-matrix.md) says which
adapters have been driven and how far.

## The same thing from a terminal

`yam ui` is the same screen model rendered in the terminal, and
`@svatah/yam-sdk` is the same client as a library. The HTTP API they all use is
[generated from the service's OpenAPI description](../reference/generated/http-api.md),
and `yam surface` is the same operations from a shell — see the
[surface control quick start](../../examples/surface-control/README.md).
