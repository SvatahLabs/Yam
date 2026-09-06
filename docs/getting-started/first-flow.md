# Your first flow

A flow is plain sentences with a signature. It compiles to a typed plan you can
read, bindings are recorded by driving the real application, and replay reads
files only.

## 1. Install the command line

```bash
npm install --save-dev @svatah/yam
npx yam init my-project
cd my-project
```

`yam init` writes `yam.config.yaml`, a `flows/` directory with one example and
a `data.yaml`. The config names the adapter (`playwright` by default), the base
URL and the run policy.

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

Every sentence pattern is in [the flow language reference](../flow-language.md).
A `story` is the unit of behaviour, a `test` block says which stories a run
executes, and the `inputs:` line is a typed signature: `secret` values are
redacted everywhere they could be written.

## 3. Compile

```bash
yam lint
yam compile --stable
```

The compiler turns each sentence into a step of the intermediate representation
and writes `.yam/plan.json`. Tier 1 is a deterministic grammar that needs no
model; sentences it cannot parse are refused with a suggestion, or handed to a
local model when [Tier 2](../concepts/compiler-tiers.md) is enabled. `--stable`
makes the output byte-for-byte reproducible, so a committed plan that differs
from a fresh compile is a real change.

## 4. Record the bindings

```bash
yam record --headed
```

The recorder drives the plan against your application. For each target phrase
it grounds the element, either by asking you to click it or through a model
gateway when one is configured, then synthesises candidates and a fingerprint
and writes `bindings/<app>/<page>/<element>.yaml`. Every decision carries its
provenance. Nothing is written until you have seen it.

## 5. Run

```bash
yam run --host playwright        # inside Playwright Test
yam run --host none              # the standalone executor
```

Both hosts execute the same plan and produce the same results. The run
directory `runs/<id>/` holds `results.jsonl`, `summary.json`, `audit.jsonl`,
checkpoints and screenshots. The exit code is the answer: `0` passed, `1`
failed, `6` healed.

Next: [one plan, three ways to run it](one-plan-three-ways.md).
