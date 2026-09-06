# Run a story from cron

The workflow behaviour: a story with a signature is a function, and `yam
workflow run` prints its outputs on stdout as JSON so the command composes.
The worked example, including the script a crontab line calls, is
[`examples/cron/`](../../examples/cron/README.md).

```bash
yam workflow run "Book a slot" --input location=Indiranagar | jq -r .booking
```

```cron
0 7 * * *  cd /srv/booking && ./book.sh >> /var/log/booking.log 2>&1
```

cron is the scheduler. Yam has none and will not: orchestration is external by
design, so the boundary is an exit code and a run directory.

## What makes it safe to leave running

- **The environment policy.** A story not marked `idempotent` is refused
  against a `production` configuration with exit `10` unless the caller passes
  `--allow-side-effects`. A scheduled job that books a slot has to have said,
  once, in the file, that it meant to.
- **Checkpoints and audit are always on.** A workflow that booked three of four
  slots cannot be re-run from the start. `yam workflow run --resume <runId>
  --from <stepId>` picks it up and refuses with exit `12` if the plan or the
  bindings moved since.
- **Secrets come from the environment.** `YAM_INPUT_PASSWORD=…` reaches the
  story, is redacted in every artifact, and never appears in the process list.
- **Outputs come back even when the run failed.** The exit code says whether
  it finished; the JSON says how far it got.

## Exit codes a scheduled job branches on

| Code | Meaning |
|---|---|
| `0` | finished, outputs on stdout |
| `1` | a step failed; partial outputs on stdout |
| `6` | finished, but a binding was healed on the way |
| `10` | refused: not idempotent against production |
| `11` | aborted under a compensation policy; the compensating story ran |
| `12` | resume refused: the plan or bindings changed since the checkpoint |
