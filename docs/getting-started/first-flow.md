# Your first flow

Five verbs, in order, and `yam` alone tells you which one is next.

```
init  →  record (or write a flow, then bind it)  →  check  →  run  →  heal
```

## 1. Start a project

```bash
npm install --save-dev @svatah/yam
npx yam init my-project
cd my-project
yam
```

`yam init` asks four things: the project's name, the adapter that drives the
application, where the application runs locally, and whether it runs anywhere
else. The last one is the project's **endpoints**: a local one, and any number
of remote ones, each with a base URL and a kind (`test`, `staging` or
`production`). Then it writes `yam.config.yaml`, a `flows/` directory with
one story that works against any application, and a `data.yaml`.

From a script, the same answers are flags, and nothing is asked:

```bash
yam init my-project --url http://localhost:3000 \
  --endpoint staging=https://staging.example.com@staging \
  --endpoint production=https://example.com@production
```

Every command then runs against the local endpoint until `--endpoint <name>`
(or `YAM_ENDPOINT=<name>`) picks another: its base URL, storage state and kind
replace `app:` and `environment:` for that command, and the policy sees the
kind — a `production` endpoint refuses to record. `yam` with nothing after it
prints where you are, which endpoint you are pointed at, and what to do next,
and it does so at every step from here on:

```
my-project · /home/me/my-project
flows     1 file, 1 story
app       http://localhost:3000 · test (also: staging, production)
plan      missing
last run  none yet

next      yam check
          There is no plan yet.
```

## 2. Record the flow, write it, or let an agent draft it

The quickest first flow is the one you do:

```bash
yam record
```

A browser opens at your application. Drive it: each click and each value you
enter becomes a sentence of the flow, and each element you touch a binding. A
password is never written down; the story declares a `secret` input and the
sentence types it. Press Enter at the terminal when you are done, and the
flow is under `flows/<story>.flow`, ready to check and run:

```
story: Sign in
inputs: password: secret
  Go to "/login"
  Type "someone@example.com" into the username field
  Type {input.password} into the password field
  Click the sign in button
  The URL should contain "/dashboard"

test: Sign in
```

An agent can write the first draft instead: point any MCP host at `yam explore` as its
server, let the agent drive the application saying what it is trying to do,
and when it disconnects the exploration becomes a proposal under
`proposals/<date>/`. `yam` then names it as the next thing to review; move its
flow into `flows/` when it says what you meant. Or write the flow yourself,
and bind its targets afterwards (step 4):

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

A `story` is the unit of behaviour, a `test` block says which stories a run
executes, and `inputs:` is a typed signature: a `secret` is redacted wherever it
could be written. Every sentence pattern is in [the flow language reference](../flow-language.md),
and `yam help flows` shows the ten most used.

## 3. Check

```bash
yam check
```

One verb reads, lints and compiles the flows and writes `.yam/plan.json`.
The grammar compiles each sentence deterministically; a sentence it cannot
parse is refused with a suggestion. The plan records what it was compiled from,
so `run` and `record --flow` notice when the flows changed and check again,
saying so on one line.

## 4. Bind the targets of a flow you wrote

A flow you recorded is already bound; skip to step 5. A flow you wrote, or an
agent drafted, names elements — *the username field* — that have no binding
yet, and `yam` says so:

```bash
yam record --flow flows/sign-in.flow     # or --all, for every unbound target
```

Yam drives the flow against your application, step by step. A browser opens
and, at each target with no binding, an overlay names it and waits for your
click; with a model credential configured a model grounds it instead and shows
you its choice. Either way the recorder then writes
`bindings/<page>/<element>.yaml` with its candidates and fingerprint. Nothing
is written before you have seen it. `yam` now says `next  yam run`.

## 5. Run

```bash
yam run
```

The plan is replayed and the exit code is the verdict: `0` passed, `1` failed,
`6` passed only because a binding was healed. A failed step prints its reason
and the verb that resolves it under the `✗` line. The run directory
`runs/<id>/` holds results, summary, audit, checkpoints and screenshots, and
`yam help exit-codes` is the whole table.

## 6. Heal, when the interface moves

```bash
yam heal
```

With nothing after it, `heal` takes the last run, relocalizes every binding
that stopped resolving against its recorded fingerprint, and proposes a diff for
you to read. `--apply` writes the accepted repairs.

Next: [one plan, three ways to run it](one-plan-three-ways.md). For the
cockpit and the tmux workspace, `yam ui` and `yam ui --tmux`.
