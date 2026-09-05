# Running a story as a function, on a schedule (REQ-BEH-2, REQ-AGT-4)

The workflow behavior. A story with a signature is a function: it takes typed
inputs, returns typed outputs, and `svatah workflow run` prints them on **stdout
as JSON** so the command composes.

```bash
svatah workflow run "Book a slot" --input location=Indiranagar | jq -r .booking
```

That is the whole integration. `book.sh` beside this file is the script a
`crontab` line would call, and `crontab` is the scheduler — Svatah does not have
one and will not (REQ-AGT-4, HLD ADR-13).

```cron
# Book tomorrow's slot at 07:00, and let cron mail me the output.
0 7 * * *  cd /srv/booking && ./examples/cron/book.sh >> /var/log/booking.log 2>&1
```

## What makes this safe to leave running

**The environment policy** (REQ-AUTO-7). A story that is not marked `idempotent`
is *refused* against a `production` config with exit 10 unless the caller passes
`--allow-side-effects`. A scheduled job that books a slot has to have said, once,
in the file, that it meant to.

**Checkpoints and audit are on**, whatever the project's config says (LLD §13.2).
A test that is not checkpointed can be re-run from the start; a workflow that
booked three of four slots and stopped cannot. `svatah workflow run --resume <id>
--from <step>` picks it up, refusing with exit 12 if the plan or the bindings
moved since (REQ-AUTO-3).

**Secrets are read from the environment**, not the command line
(`SVATAH_INPUT_<NAME>`): a password on a command line is a password in the
process list. It reaches the story, is redacted in the audit, the results and the
summary, and is never written to the run directory (REQ-NFR-6).

**Outputs come back even when the run failed.** A workflow that got three steps
in captured something, and a caller deciding what to do next needs it. The exit
code says whether it finished; the JSON says how far it got.

## Exit codes a scheduled job branches on

| Code | Meaning |
|---|---|
| `0` | every step passed; the outputs are complete |
| `1` | a step failed; the outputs are what it captured before stopping |
| `10` | refused: not `idempotent`, environment is `production`, no override |
| `11` | aborted: a failure triggered a compensating story, which ran |
| `12` | `--resume` refused: the plan or the bindings moved since the checkpoint |
