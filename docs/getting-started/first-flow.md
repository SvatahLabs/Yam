# Your first flow

Six verbs, in order, and `yam` alone tells you which one is next.

```
init  →  write a flow  →  check  →  record  →  run  →  heal
```

## 1. Start a project

```bash
npm install --save-dev @svatah/yam
npx yam init my-project
cd my-project
yam
```

`yam init` writes `yam.config.yaml`, a `flows/` directory with one example and a
`data.yaml`. `yam` with nothing after it prints where you are and what to do
next, and it does so at every step from here on:

```
my-project · /home/me/my-project
flows     1 file, 1 story
plan      missing
last run  none yet

next      yam check
          There is no plan yet.
```

## 2. Write the flow

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
so `run` and `record` notice when the flows changed and check again, saying so
on one line.

## 4. Record the bindings

```bash
yam record
```

The recorder drives the plan against your application. A browser opens and,
for each target phrase, an overlay names it and waits for your click; with a
model credential configured a model grounds it instead and shows you its
choice. Either way the recorder then writes `bindings/<app>/<page>/<element>.yaml` with
its candidates and fingerprint. Nothing is written before you have seen it.
`yam` now says `next  yam run`.

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
