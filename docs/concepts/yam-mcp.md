# Yam MCP

Yam MCP is how an AI agent uses Yam. It is an MCP server, `@svatah/yam-mcp`,
that gives the agent the same surface a person drives with `yam surface`: it can
open a browser, a desktop application, a terminal or an HTTP API, read what is
there, act on it and check the result.

This page explains how that works. To set it up and drive a first session, follow
[Connect an agent with Yam MCP](../getting-started/install-and-first-control.md#6-connect-an-agent-with-yam-mcp).
For every tool, the trajectory format and the server's options, read the
[MCP reference](../mcp.md).

## Two ways to start it

| Start the server with | The agent gets |
|---|---|
| `npx -y @svatah/yam-mcp` | 14 surface tools. No project is needed: the agent drives whatever it connects to. |
| `npx -y @svatah/yam-mcp /path/to/project` | The same 14 and 8 more: `yam_compile`, `yam_lint`, `yam_run`, `yam_record`, `yam_heal`, `yam_bindings`, `yam_results` and `surface_trajectory`. |

The project tools run the same functions the `yam` command runs, so an agent and
a person working on one project get the same plan and the same results.

## A session is a loop

`surface_connect` returns a session ID, and every call after it names that
session:

```
surface_targets    what there is to drive on this machine
surface_connect    open a URL, an application, an API or a terminal -> session id
surface_snapshot   the screen as elements, each with a reference such as r12
surface_act        one action, addressed by a reference
surface_read       a title, a URL, an element's text or value
surface_check      whether something holds, and what Yam saw
surface_close      done
```

A reference belongs to the snapshot it came from. After anything changes the
screen, the agent takes a new snapshot before it acts again.

## Why it suits an agent

**One set of tools for four kinds of target.** The same `surface_snapshot` and
`surface_act` work on a web page, a desktop window, an HTTP API and a terminal
program, so the agent does not learn a new interface for each. How far each
adapter has actually been driven is in the
[support matrix](../reference/generated/support-matrix.md).

**References, not selectors or screen positions.** A snapshot hands back `r12`,
and `surface_act` takes `r12`. The agent never guesses a CSS selector and never
clicks a coordinate, so nothing breaks when a window moves or a page is styled
differently.

**One session, shared with the person watching.** Yam keeps sessions in a single
broker on the machine. If the agent opens a browser, the same browser appears in
the desktop app, `surface_control` decides who is driving, and a person can take
a target back at any time.

**What the agent did can become a test.** A session can be recorded and compiled
into a flow that replays with no model in the loop: fast, free, and the same
every time.

## Intent turns a session into a test

Every surface tool takes an optional `intent`, a short sentence saying why the
agent is making the call. "Sign in as the test user" is an intent; "click r14" is
not.

When the server has a project, calls that carry an intent are written to
`runs/<session>/trajectory.jsonl`, and `yam trajectory compile` turns that file
into a proposal to review. `yam explore --name "Sign in"` does both: it serves the
tools, records what the agent does, and writes the proposal under `proposals/`.
Nothing touches your flows until you accept it.

The other direction exists too. `yam tool serve --expose "Sign in"` offers a test
you already have as a tool the agent calls by name, and records the agent as the
one who invoked it. [Expose a story as an MCP tool](../guides/expose-a-tool-over-mcp.md)
walks through it.

## Where it runs

- **Over stdio, by default.** The agent host starts the server and owns the
  process: there is no port to collide and no token to leak.
- **Over HTTP, when the host cannot start a program.**
  `npx -y @svatah/yam-mcp --http` listens on 127.0.0.1 only, behind a bearer token
  it prints once.
- **On macOS, permissions belong to the MCP client.** macOS grants Accessibility
  to the program that started the server, so grant the agent host, not Yam.

## Related

- [MCP reference](../mcp.md): every tool, the trajectory and the options.
- [Connect an agent with Yam MCP](../getting-started/install-and-first-control.md#6-connect-an-agent-with-yam-mcp):
  setup and a first session.
- [The agent surface](agent-surface.md): the contract every adapter implements
  behind these tools.
