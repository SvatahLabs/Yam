# Install Yam and control something

Fifteen minutes, from nothing to a browser and a native application driven from
your terminal. No project, no flow file, no model — those come later and are
optional.

If you only want bindings inside an existing Playwright suite, skip this and
read [Bindings in a plain Playwright project](playwright-quick-start.md)
instead; it is a smaller thing to adopt.

## What Yam is, in three sentences

Yam gives every kind of software the **same four verbs**: snapshot it, act on
something by reference, read a value back, and check a condition. A browser
page, a macOS or Windows window, a terminal and an HTTP API all answer those
four the same way, so what you learn on one works on the next. You can drive
them yourself from the CLI, or hand the same surface to an agent over MCP.

## 1. Install

```bash
npm install -g @svatah/yam
yam --version
```

You need **Node 22 or newer**. That one install brings every adapter Yam has:
browser, macOS, Windows, Linux, terminal and HTTP.

What it does **not** bring is the things those adapters drive. Nothing here is
downloaded until you ask for it:

| To drive | You also need |
|---|---|
| a browser (Playwright) | `npx playwright install chromium` |
| macOS applications | macOS, and the Accessibility permission — step 3 |
| Windows applications | Windows; nothing else |
| Linux applications | `at-spi2-registryd` running, toolkit accessibility on |
| a terminal | `expect` (already on macOS; a package on Linux) |
| an HTTP API | nothing |
| a phone (Appium) | a running Appium server and a device |
| a browser over BiDi | a browser you started with a BiDi endpoint |

## 2. Ask what this machine can actually do

```bash
yam surface doctor
```

Every adapter gets a line saying what it found, or what would have to be true:

```
ok    playwright/reachable   Version 1.62.1
ok    ax/reachable           macOS 26.3
ok    ax/accessibility       granted
warn  ax/screen-recording    not granted
warn  appium/reachable       no Appium server answered at http://127.0.0.1:4723 …
ok    process/reachable      expect version 5.45
ok    http/reachable         v25.6.1
```

`warn` is not a fault. A laptop with no Appium server is an ordinary laptop, and
the command exits 0. It exits non-zero only when you name an adapter you intend
to use and it is not ready:

```bash
yam surface doctor --adapter ax    # exit 1 if this host cannot drive macOS apps
```

## 3. Grant the macOS permissions

**Skip this on Windows and Linux** — neither has a permission to grant.

macOS needs two, and they are separate:

- **Accessibility** — required to read or drive any other application.
- **Screen Recording** — only for screenshots. Everything else works without it.

```bash
yam surface grant
```

### The one thing everybody gets wrong

macOS does not grant permissions to Yam. It grants them to **the program that
starts Yam** — your terminal, your editor, or the MCP client that spawned
`yam mcp`. Yam is a script inside that program and can never be granted anything
of its own.

So the answer changes depending on where you run it:

| You run Yam from | macOS grants | Settings entry to switch on |
|---|---|---|
| iTerm | iTerm | iTerm |
| VS Code's terminal | VS Code | Visual Studio Code |
| Claude Desktop, via `yam mcp` | Claude Desktop | Claude |
| ssh or CI | nothing — no app owns the process | none exists |

`yam surface grant` tells you which one you are in, by name:

```
macOS grants these to iTerm (`/Applications/iTerm.app`), not to Yam — Yam is a script it starts.

ok    accessibility      granted — reading and driving other applications' windows
warn  screen-recording   not granted — screenshots; the accessibility tree reads without it
```

Two consequences worth knowing before you click:

- **A grant does not carry.** Granting iTerm does nothing for VS Code. If you
  use Yam from an MCP client, grant *that client*.
- **macOS asks once, ever.** Each prompt appears one time per application. If it
  was dismissed or refused, no command can raise it again — the only route left
  is System Settings → Privacy & Security, followed by restarting that program,
  because macOS does not re-read the setting for a process already running.

Use `yam surface grant --dry-run` to see what would be asked without spending
that one chance.

## 4. Drive a browser

No project and no configuration. Open a session, and it stays open between
commands:

```bash
npx playwright install chromium
```

Make a page to drive, so the output below is exactly what you will see:

```bash
mkdir -p /tmp/yamdemo && cat > /tmp/yamdemo/page.html <<'HTML'
<!doctype html><title>Yam demo</title>
<h1>Hello</h1>
<input id="name" aria-label="Your name">
<button id="go">Say hello</button>
HTML

yam surface connect --adapter playwright --url file:///tmp/yamdemo/page.html
# → {"sessionId":"s_7ef55c603f6b", …}
```

Keep that `sessionId`. Ask the page what is on it:

```bash
yam surface snapshot --session s_7ef55c603f6b --interactive-only
```

```
- textbox "Your name" [ref=r0]
- button "Say hello" [ref=r1]
```

Those `[ref=…]` handles are how you act. Type into one, read it back, and assert
on it:

```bash
echo '{"value":"Ada"}' | yam surface act --session s_7ef55c603f6b --action type --ref r0 --input -

yam surface read --session s_7ef55c603f6b --kind value --ref r0
# → {"value":"Ada"}

echo '{"predicate":{"kind":"value","value":{"kind":"literal","value":"Ada"}},"subject":"ref"}' \
  | yam surface check --session s_7ef55c603f6b --ref r0 --input -
# → {"ok":true,"actual":"Ada","expected":"Ada"}
```

When you are done:

```bash
yam surface close --session s_7ef55c603f6b
```

That is the whole vocabulary: **connect → snapshot → act → read → check →
close**.

### Two rules that save an hour

- **Take a new snapshot after every act.** References belong to the snapshot
  they came from. After anything changes the screen, ask again and re-find your
  element by name — `r5` may be a different element than it was.
- **`--input -` reads JSON from stdin.** `--input <file.json>` reads a file. The
  argument names are exact: `type` takes `value`, `setChecked` takes `checked`,
  `press` takes `key`.

## 5. Drive a native application

Same verbs, different adapter. On macOS, with Accessibility granted:

```bash
yam surface connect --adapter ax --app TextEdit
yam surface snapshot --session <id> --interactive-only
```

On Windows use `--adapter uia`, on Linux `--adapter atspi`. A terminal is
`--adapter process`, and an HTTP API is `--adapter http` with
`yam surface request`.

## 6. Hand the same surface to an agent

Everything above is also available over MCP, so an agent can do it:

```bash
claude mcp add yam -- yam mcp
```

The agent gets `surface_connect`, `surface_snapshot`, `surface_act`,
`surface_read`, `surface_check` and the rest — the same session model you just
used by hand. **The MCP client is now the program macOS grants**, so if it has
not been granted, run `yam surface doctor` *from that client* and follow what it
says. [MCP reference](../mcp.md) has the full tool list and the HTTP transport.

## Where to go next

You now have live control. The rest of Yam is about making a session
**repeatable**:

- [Your first flow](first-flow.md) — describe a behaviour in plain language,
  bind it to real elements once, then replay it deterministically with no model
  in the loop.
- [One plan, three ways to run it](one-plan-three-ways.md) — the same flow as a
  test, a workflow and an agent tool.
- [The agent surface](../concepts/agent-surface.md) — what the four verbs
  guarantee, and what each adapter can and cannot do.
- [Support matrix](../reference/generated/support-matrix.md) — how far each
  adapter has actually been driven, measured rather than claimed.

## If something is wrong

Ask the host first; it usually knows.

```bash
yam surface doctor              # every adapter
yam surface doctor --adapter ax # one of them, fatally
yam doctor                      # the host and a project together
```

Common answers:

| Symptom | Cause |
|---|---|
| `browser not installed` | `npx playwright install chromium` |
| macOS reads nothing, or times out | Accessibility not granted to the program running Yam — step 3 |
| screenshots refuse | Screen Recording not granted; the tree still reads |
| `no window` on macOS | the display is locked, or you are over ssh |
| a ref is not found | the screen changed — take a new snapshot |
