# Setup

This page takes you from nothing to a working Yam. It covers the command line,
Yam MCP for agents, the desktop app, and the permissions each one needs.

## What you need first

| | |
|---|---|
| Node | 22 or newer. Check with `node --version`. |
| Disk | About 40 MB for Yam. About 400 MB more if you add Chromium. |
| Network | Needed to install. Not needed to run. |

Yam runs on macOS, Linux and Windows. Which targets it can drive differs by
operating system, and the
[support matrix](reference/generated/support-matrix.md) says which.

## Install the command line

```bash
npm install -g @svatah/yam
```

Check it:

```bash
yam --version
```

This install gives you the flow language, the compiler, the runtime, the
recorder, the healer, the terminal cockpit, and six adapters that need nothing
extra. It does not include a browser.

## Set up Yam MCP for agents

Agents reach Yam through Yam MCP, a separate package, so a plain `yam` install
does not carry the MCP SDK. For Claude Code, one line adds it:

```bash
claude mcp add yam -- npx -y @svatah/yam-mcp
```

For any other agent host, put this in its MCP server list:

```json
{ "mcpServers": { "yam": { "command": "npx", "args": ["-y", "@svatah/yam-mcp"] } } }
```

`npx -y` fetches it when needed and installs nothing permanently.

Add a project directory to give the agent the compile, run, record and heal
tools as well:

```json
{ "mcpServers": { "yam": { "command": "npx", "args": ["-y", "@svatah/yam-mcp", "/path/to/project"] } } }
```

With no directory the agent gets the surface tools only, which is what you want
when the agent is driving a browser or an app rather than working on a project.

To have an agent drive its first page, follow
[Connect an agent with Yam MCP](getting-started/install-and-first-control.md#6-connect-an-agent-with-yam-mcp).
[Yam MCP](concepts/yam-mcp.md) explains how an agent's session works, and the
[MCP reference](mcp.md) lists every tool and option.

## Add a browser

Only if you want to drive a web page that Yam opens for you.

```bash
npm install playwright
npx playwright install chromium
```

Chromium is about 400 MB. Yam never downloads it behind your back. If you skip
this step, `yam surface doctor` will tell you the `playwright` adapter needs it
and print the exact command.

## Check what your machine can do

```bash
yam surface doctor
```

You get one line per adapter. Here is a real run on a Mac:

```
ok    -/platform             darwin arm64, Node v25.6.1
ok    playwright/reachable   1.62.1
ok    ax/reachable           macOS 26.3
ok    ax/accessibility       granted
ok    process/reachable      expect version 5.45
ok    http/reachable         v25.6.1
skip  uia/reachable          UI Automation is Windows'; this host is darwin.
skip  atspi/reachable        AT-SPI is Linux's accessibility bus; this host is darwin.
warn  bidi/reachable         no BiDi endpoint is named. Start Chrome or Firefox
                             with a WebDriver BiDi endpoint and set YAM_BIDI_URL.
warn  appium/reachable       no Appium server answered at http://127.0.0.1:4723.
```

Three words, three meanings:

- **ok** means Yam asked and got an answer.
- **skip** means this computer cannot do it. A Mac cannot run Windows UI
  Automation. That is not a problem to fix.
- **warn** means something is missing and the line tells you what.

`ok` here means the adapter answered on this machine, right now. It is not a
claim that every operation through it works. For that, read the
[support matrix](reference/generated/support-matrix.md), which is generated from
measured runs.

## Permissions on macOS

To drive a Mac app, Yam needs the Accessibility permission. To take screenshots
of one, it needs Screen Recording.

macOS grants a permission to **a program**, not to a person. This matters more
than it sounds. If you run `yam` from Terminal, the grant belongs to Terminal.
If you run the desktop app, the grant belongs to the app. Granting one does not
grant the other.

`yam surface doctor` tells you which program is asking:

```
ok    ax/accessibility       granted
```

If it says denied, open **System Settings**, then **Privacy & Security**, then
**Accessibility**, and turn on the program the message names.

## Install the desktop app

The app is not on npm. Build it from the repository:

```bash
git clone https://github.com/SvatahLabs/yam
cd yam
pnpm install
pnpm -r build
pnpm --filter @svatah/yam-desktop package
```

The app appears under `apps/desktop/out/`. On a Mac that is
`Yam-darwin-arm64/Yam.app`.

## Make a project

```bash
yam init my-tests
cd my-tests
```

`yam init` asks four things: the project name, the adapter, where your app runs
locally, and any remote endpoints. Answer with `--yes` to take the defaults.

You get this:

```
my-tests/
  yam.config.yaml     settings for this project
  flows/              your stories, in sentences
  bindings/           what Yam learned about your elements
  steps/              typed steps you write yourself, if you want them
  data.yaml           values your stories use
  api/                saved HTTP requests
  runs/               what happened, one folder per run
```

## Settings worth knowing

`yam.config.yaml` holds the settings. These four are the ones people change
first.

```yaml
app:
  baseUrl: "http://127.0.0.1:4173"   # where your app runs

adapter: playwright                   # what Yam drives it with

run:
  headless: true                      # false shows you the browser
  workers: 1                          # how many stories run at once

bindings:
  testIdAttributes: ["data-testid"]   # attributes Yam prefers when recording
```

The full list is in [the configuration reference](reference/generated/schemas).

## Secrets

Never put a password in `data.yaml`. Name an environment variable instead:

```yaml
user:
  email: "someone@example.com"
  password: "${YAM_SAMPLE_PASSWORD}"
```

Yam reads the variable at run time. It redacts the value everywhere: prompts,
audit logs, results, traces and screenshots.

You can also pass one for a single run:

```bash
YAM_INPUT_PASSWORD=hunter2 yam run
```

Do not put a secret on the command line. Other users on the machine can see the
process list.

## Where to go next

- [Your first flow](getting-started/first-flow.md) walks through recording and
  replaying.
- [Features](features.md) lists what Yam can do.
- [Examples](examples.md) has working code.

## When something goes wrong

| What you see | What to do |
|---|---|
| `No Yam project here` | You are outside a project. Run `yam init` or `cd` into one. |
| An adapter says `not installed` | The message names the one command that fixes it. |
| `The macOS Accessibility permission is not granted` | The message names the program to grant it to. Grant that one. |
| `The surface broker did not start` | Run `yam surface broker` in another terminal and read what it says. |
| A run fails on one step | Open the run in the app or run `yam runs tail`. Yam lists every way it tried to find the element. |

Every Yam error names the command that resolves it. If one does not, that is a
bug worth reporting.
