# Yam

**Write a test once in plain English. Yam learns the real buttons. Then it replays without a model.**

Yam is an automation runtime from [Svatah Labs](https://github.com/SvatahLabs).
You describe what you want in sentences. Yam drives the real app once and
records which element each sentence means. After that, every run is a replay.
No model runs during a replay, so runs are fast, cheap, and the same every time.

![Yam driving a real website](docs/images/yam-drives-a-site.gif)

Yam opening a site, going to the docs, filling a login form, and reading the
error. Every step went through Yam's own tools.

## Why people use it

**Tests stop breaking when the page changes.** Yam saves five ways to find each
element, plus a fingerprint of what the element looked like. When a button moves
or gets renamed, Yam finds it again from that fingerprint. It marks the run
`healed`, never `passed`, so you always know a repair happened.

**A run costs nothing to repeat.** A model is used once, when you record. The
replay reads a file. There is no API bill and no waiting.

**One plan runs three ways.** The same file can be a test, a workflow you call
from code, or a tool an AI agent calls. You do not rewrite it for each.

## Install

You need [Node 22 or newer](https://nodejs.org).

```bash
npm install -g @svatah/yam
```

To drive a browser, add Chromium once:

```bash
npx playwright install chromium
```

You do not need a browser to drive a desktop app, a terminal, or an HTTP API.

Check it worked:

```bash
yam --version
yam surface doctor
```

`yam surface doctor` prints one line per adapter. It says what is ready, what
this computer cannot do, and what is missing. It never guesses.

## Your first test

**1. Make a project.**

```bash
yam init my-tests
cd my-tests
```

**2. Write a story.** Open `flows/first.flow` and write sentences:

```
story (tags=smoke): Sign in
inputs: username: string, password: secret
  Go to "/login"
  Type {input.username} into the username field
  Type {input.password} into the password field
  Click the sign in button
  The dashboard heading should be visible

test: Sign in
```

**3. Record it.** Yam opens the app and watches you click:

```bash
yam record --flow flows/first.flow
```

Yam writes what it learned into `bindings/`. Those are plain YAML files. You can
read them, review them, and commit them.

**4. Replay it.** No model runs this time:

```bash
yam run
```

The exit code is the answer. `0` means everything passed. Every code is listed
by `yam help exit-codes`.

**5. Repair it when the page changes:**

```bash
yam heal
```

Longer walkthrough: [Your first flow](docs/getting-started/first-flow.md).

## The desktop app

`yam ui` gives you a version in the terminal. The desktop app gives you the same
screens with a mouse.

![The Yam desktop app](docs/images/app-session.png)

Connect to a browser, an app, an API, or a terminal from one screen. Nothing on
this screen needs a project.

![A tour of the Yam screens](docs/images/yam-app-tour.gif)

When a run fails, Yam shows you why. It lists every way it tried to find the
element and how many things matched.

![A failed run, with the reason](docs/images/app-run.png)

## What Yam can drive

Yam talks to each kind of target through an adapter. How far each adapter has
actually been driven is measured, not claimed. The numbers come from real runs
and live in the [support matrix](docs/reference/generated/support-matrix.md).

| Target | Adapter | Needs |
|---|---|---|
| Web browser | `playwright` | Chromium, installed once |
| A browser you already have open | `bidi` | Chrome or Firefox with a BiDi endpoint |
| macOS apps | `ax` | macOS, and the Accessibility permission |
| Windows apps | `uia` | Windows |
| Linux apps | `atspi` | Linux with an accessibility bus |
| Phones and tablets | `appium` | An Appium server and a device |
| HTTP APIs | `http` | Nothing |
| Terminal programs | `process` | Nothing |

Six of these need no extra download. Read the
[support matrix](docs/reference/generated/support-matrix.md) before you pick
one. An adapter being listed is not proof that it works on your machine, and the
matrix says which ones were driven in the last measured run.

## Healing, with numbers

A healing claim without a number is a slogan. These numbers come from twenty
deliberate interface changes in the sample app.

| | Without test ids | With test ids |
|---|---|---|
| Elements found again | **92.3%** (48 of 52) | 78.9% (15 of 19) |
| Repairs onto the wrong element | 0 | 0 |
| Bindings that stopped working | 0 | 0 |
| Model calls | none | none |

The first row is the measure the eval calls Relocalize-only recovery. It counts
a repair only when the element found is the one the binding was recorded on, not
merely an element that could be found.

The headline is the harder case. An app with a `data-testid` on every control
barely needs healing, so a number taken there measures the app and not the
healer. Both are published so you can see the gap.

Method and per-change tables: [`reports/eval-healing.md`](reports/eval-healing.md).
Regenerate them with `pnpm eval:healing`.

## One plan, three ways

The same compiled plan runs as any of these. You do not rewrite it.

| Way | What it is | Command |
|---|---|---|
| **Test** | Passes or fails. Good for CI. | `yam run` |
| **Workflow** | A function with inputs, outputs and retries. | `yam workflow run` |
| **Tool** | A tool an AI agent can call over MCP. | `yam tool serve` |

Read [One plan, three ways](docs/getting-started/one-plan-three-ways.md).

## Use Yam from an AI agent

Yam ships an MCP server. Point your agent at it and the agent can drive a
browser, an app, or an API through the same engine you use.

```json
{ "mcpServers": { "yam": { "command": "npx", "args": ["-y", "@svatah/yam-mcp"] } } }
```

You and the agent share one session. If the agent opens a browser, you can see
it in the app and take control back. Read [Yam and MCP](docs/mcp.md).

## Already have Playwright tests?

You can take one piece on its own. Add bindings and healing to a Playwright
suite you already have. No flow language, no compiler, no model.

```bash
npm install --save-dev @svatah/yam-playwright-test
```

```ts
import { test, expect } from "@svatah/yam-playwright-test";

test("sign in", async ({ page, bind }) => {
  await page.goto("/login");
  await (await bind("login.username-field", "the username field")).fill("me@example.com");
  await (await bind("login.sign-in-button")).click();
  await expect(page).toHaveURL(/dashboard/);
});
```

`bind()` returns a normal Playwright locator, so everything you already do still
works. Read the [Playwright quick start](docs/getting-started/playwright-quick-start.md),
or the runnable version in
[`examples/plain-playwright/README.md`](examples/plain-playwright/README.md).

## Documentation

| If you want to | Read |
|---|---|
| install it and run something | [Setup](docs/setup.md) |
| see everything Yam does | [Features](docs/features.md) |
| learn from working examples | [Examples](docs/examples.md) |
| look up a command or an endpoint | [API reference](docs/api.md) |
| understand how it works | [Concepts](docs/concepts) |
| work on Yam itself | [Developer guide](docs/developer-guide.md) |
| send a change | [Contributing](CONTRIBUTING.md) |

Everything else is in [`docs/`](docs/README.md).

## What you install

Three packages. Most people install the first one only.

| Package | What it is |
|---|---|
| [`@svatah/yam`](packages/cli) | The `yam` command. Everything above, without the browser driver. |
| [`@svatah/yam-mcp`](packages/mcp) | The MCP server for agents. Adds the MCP SDK. |
| [`@svatah/yam-contract`](packages/contract) | The shared operation list. You never install it directly. |

There is also [`@svatah/yam-playwright-test`](packages/playwright-test) if you
only want bindings in an existing Playwright suite.

## Status

Version 0.1.0 is a release candidate. Nothing is published yet.

Known gaps are written down rather than hidden. See
[CHANGELOG.md](CHANGELOG.md). The specification is the source of truth and
lives in [`docs/spec/`](docs/spec/). It is written before the code, not after.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
