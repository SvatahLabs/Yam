# `svatah repl`

One sentence at a time against an open session, appended to a session flow and
bindings (REQ-RUN-11, LLD §15).

```bash
svatah repl                                    # the project in the current directory
svatah repl . --base-url http://127.0.0.1:4173
svatah repl . --headless --gateway fake        # what the tests do
```

```
svatah repl — playwright at http://127.0.0.1:4173
  grounding through anthropic:claude-opus-5
  .help for the commands, .exit to write the flow and stop

Click the sign in button
  ✓ click home.sign-in-button (by testid)
Type "someone@example.com" into the username field
  ✓ type login.username-field (by testid)
The login button should be visible
  ✓ expect login.login-button (by testid)
.exit
wrote flows/repl-2026-09-03T20-10-49-480.flow (3 step(s))
```

That file is the point. It is an ordinary flow: `svatah run` replays it, with no
model in the loop, and the elements its sentences name are in the bindings store
where the rest of the toolchain reads them.

## What happens to a sentence

Nothing here is a second implementation, which is the only reason a REPL is
trustworthy at all:

1. **Compiled** by the same compiler `svatah compile` uses — Tier 0, then the
   grammar, then the model tiers if `--tier2` or `--tier3` asked for them.
2. **Grounded**, if it names an element nothing has recorded, by the same
   `ground()` `svatah record` uses.
3. **Performed** by the same `runStep()` the executor uses, against the open
   session.
4. **Appended** to the flow if it passed.

A sentence that failed is not appended. The flow is what the session did
*successfully*; committing a step that failed would produce a flow that fails on
its first run.

## Commands

| | |
|---|---|
| `.help` | the list |
| `.url` | where the session is |
| `.snapshot [n]` | the first `n` lines of the accessibility tree (default 30) |
| `.bindings` | what the store holds, including what this session recorded |
| `.flow` | the flow so far |
| `.undo` | drop the last sentence from the flow — **the page is not undone**, because nothing here can un-click a button |
| `.save` | write the flow and the bindings now, and keep going |
| `.exit` | write them and stop |

A line starting with `//` or `#` is a comment. Anything else is a step; see
[`flow-language.md`](flow-language.md) for the sentence patterns.

## Grounding, and what happens without a model

An unbound target is the normal state of a phrase nobody has recorded, so the
REPL grounds it once and remembers it for the rest of the session.

| | |
|---|---|
| `--gateway anthropic`, or `ANTHROPIC_API_KEY` set | the real one |
| `--gateway fake` | the grounding eval's committed answers — a fixture, not a model, and everything it records says `fake:grounding-cases` in its provenance |
| `--gateway none`, or no credential | no grounding. A sentence naming an unrecorded element says so and names both ways to fix it |

**Nothing is written until the session ends.** A binding is staged in memory as
it is grounded, so the next sentence can use it, and the store is saved on
`.save` or `.exit`. A binding is *kept* only when the step it was grounded for
passed, and rolled back when it did not — REQ-REC-5's "unverified bindings never
reach disk" holds here exactly as it does for `svatah record`.

## Options

| | |
|---|---|
| `--adapter <name>` | override `config.adapter`: `playwright`, `bidi`, `appium` |
| `--base-url <url>` | where the session opens. Then `SVATAH_BASE_URL`, then `config.app` (LLD §15) |
| `--storage-state <path>` | a session to inject, so the REPL starts signed in |
| `--headless` | headed by default, because a REPL is something a person watches |
| `--gateway anthropic\|fake\|none` | as above |
| `--tier2`, `--tier3` | let a model compile the sentences the grammar refuses ([`local-model.md`](local-model.md)) |
| `--out <dir>` | where the flow goes; `config.flows.dir` by default |
| `--name <name>` | the flow's file name; a timestamp by default |
| `--json` | print the flow path, the steps and the bindings on exit |

## Starting from somewhere other than the front door

Most exploration starts behind a login. Two ways:

```bash
# A session recorded once and reused.
svatah repl . --storage-state .svatah/signed-in.json

# Or sign in in the REPL, and let the flow it writes include the sign-in.
svatah repl .
```

The second is usually what you want: the flow that comes out is one that can run
from nothing.

## What it is not

It does not compile a plan, run a flow, or write a run directory. A REPL session
is exploration; `svatah run` is the thing with results, an audit log and an exit
code. What connects them is the file the session leaves behind.
