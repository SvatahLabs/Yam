#!/usr/bin/env bash
#
# A scheduled Svatah workflow (REQ-BEH-2, REQ-AGT-4).
#
# `crontab` is the scheduler. Svatah is a command that takes typed inputs and
# prints typed outputs, and this is the fifteen lines between them.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Secrets through the environment, never on the command line: a password on a
# command line is a password in the process list. `SVATAH_INPUT_<NAME>` supplies
# a story input the same way `--input name=value` does (LLD §10, §15).
export SVATAH_INPUT_LOCATION="${LOCATION:-Indiranagar}"

# stdout is only the outputs; progress goes to stderr. That is what makes the
# pipe below work.
if outputs=$(node packages/cli/dist/bin.js workflow run "Book a slot" evals/fixtures); then
  booking=$(printf '%s' "$outputs" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).booking??""))')
  echo "booked: ${booking}"
  exit 0
fi

# A non-zero exit is not all the same thing (LLD §15), and a scheduled job that
# treated them alike would page someone for a config mistake.
status=$?
case "${status}" in
  10) echo "refused: the story is not idempotent and the environment is production." >&2 ;;
  11) echo "aborted: a step failed and the compensating story ran. Nothing is left behind." >&2 ;;
  12) echo "refused: the plan or the bindings moved since the checkpoint. Re-run from the start." >&2 ;;
  *)  echo "failed with ${status}. The whole account is in runs/, including the audit log." >&2 ;;
esac
exit "${status}"
