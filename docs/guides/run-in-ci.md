# Run in CI

The test behaviour, invoked by somebody else's runner. There is nothing Yam
specific in a workflow beyond the command and the exit code. The complete jobs
for GitHub Actions and GitLab are in [`examples/ci/`](../../examples/ci/README.md).

```yaml
- run: pnpm yam compile --stable
- run: git diff --exit-code .yam/plan.json
- run: pnpm yam run --host playwright
```

## What CI has to know

**The exit code.** `0` passed, `1` failed, `6` passed only because a binding
was healed, `10` a non-idempotent story refused against production, `11` a flow
aborted under a compensation policy, `12` a resume whose plan or bindings moved
since the checkpoint. A healed run is green in the sense that the application
works and red in the sense that a binding drifted, so it is its own code and a
job should decide deliberately.

**The run directory.** `runs/<id>/` holds `results.jsonl`, `summary.json`,
`audit.jsonl`, `checkpoints/` and screenshots. Attach it as an artifact and a
failure is readable a month later without re-running anything.

**The plan is committed.** `yam compile --stable` is byte stable, so a compile
in CI that differs from the committed plan is a flow someone edited without
recompiling, and `git diff --exit-code` is the check.

**Nothing calls a model.** Replay is model-free by construction: the runtime
packages cannot import the gateway and the boundary is linted. A CI job needs no
credential.

## Healing is a separate step

```bash
yam run --host playwright || yam heal --run "$(cat .yam/last-run)"
```

A heal proposes a diff and a report and applies nothing. The output belongs in a
pull request where a person decides whether the element found is the element
the flow meant. A job that applied repairs automatically would be a machine for
turning red builds green.

## Browsers and secrets

The Playwright adapter needs a browser: `npx playwright install --with-deps
chromium` in the job. Inputs a story declares as `secret` are read from
`YAM_INPUT_<NAME>` in the environment and never from the command line; they
are redacted in results, audit and summary.
