# Running a flow in CI (REQ-BEH-1, REQ-AGT-4)

The test behavior, invoked by somebody else's runner. There is nothing
Svatah-specific in the workflow beyond the command and the exit code.

```yaml
# .github/workflows/svatah.yml
- run: pnpm svatah compile --stable
- run: pnpm svatah run --host playwright
```

`github-actions.yml` beside this file is the whole job. `gitlab-ci.yml` is the
same job for GitLab, so the shape is visible rather than implied.

## What CI has to know

**The exit code** (LLD §15). `0` passed, `1` failed, `6` passed only because a
binding was healed — which is green in the sense that the application works and
red in the sense that a binding drifted, so it is its own code and a job should
decide deliberately. `11` is a flow that aborted under a compensation policy;
`12` is a `--resume` whose plan or bindings moved since the checkpoint.

**The run directory.** `runs/<id>/` holds `results.jsonl`, `summary.json`,
`audit.jsonl`, `checkpoints/` and the screenshots. Attach it as an artifact and
a failure is readable a month later without re-running anything. There is no
service to ask.

**That the plan is committed.** `svatah compile --stable` is byte-stable
(REQ-COMP-7), so a compile in CI that differs from the committed `plan.json` is
a real difference — a flow someone edited without recompiling — and
`git diff --exit-code` is the check. A plan produced fresh on every run would
make the model's decisions invisible, which is the thing ADR-1 exists to prevent.

**Nothing calls a model.** Replay is model-free by construction (REQ-RUN-1): the
runtime packages cannot import the gateway and the import boundary is linted. A
CI job needs no credential, and one that has one is not using it here.

## Healing is a separate step, on purpose

```bash
svatah run --host playwright || svatah heal --run "$(cat .svatah/last-run)" --input password="$PASSWORD"
```

A heal proposes a diff to the bindings store and a report; it does not apply one
(REQ-HEAL-2). The output belongs in a pull request, where a person decides
whether the element the healer found is the element the flow meant. A CI job that
applied repairs automatically would be a machine for turning red builds green.

`--input` is there because a story with a signature cannot replay without its
arguments, and a run records only their *names* — a secret never reaches a run
directory (LLD §10, REQ-NFR-6).
