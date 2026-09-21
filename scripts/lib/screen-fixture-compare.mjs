/**
 * What the screen-fixture check looks past, and what it still catches.
 *
 * Everything that is true of *when* and *where* the recording was made rather
 * than of what the project contains: the wall clock, the durations, the
 * per-candidate timings inside a resolver failure's message ("matched nothing
 * (37 ms)"), and `configHash`, which covers `app.baseUrl` and therefore the
 * port. All four are kept in the committed file, because the screens show
 * them — the Run screen's audit column is a stamp and its summary line is a
 * duration — and a fixture without them could not test those screens.
 *
 * A change to a status, a candidate, a captured value, a plan hash, a bindings
 * hash, a flow, a story or a binding still fails the check.
 *
 * ## The candidate that ran out of time
 *
 * Normalising `(37 ms)` assumed a slow machine only makes a candidate *slower*.
 * It does not: past `Config.run.candidateTimeoutMs` — two seconds by default —
 * the resolver stops waiting and records something else entirely. A candidate
 * that would have reported `matched nothing` reports
 * `error: candidate timed out after 2000 ms`, under a different key, and the
 * rendered message differs too.
 *
 * So the Windows leg of 2026-09-21's run failed on `checkout.pay-button` with
 * exactly that, having passed on the same commit elsewhere: `testid "pay"`
 * missed quickly on every other machine and ran out of time on a loaded one.
 * The finding is the same either way — this candidate did not identify the
 * element — and which of the two you get is a fact about the runner.
 *
 * What it costs: a candidate that times out for a *product* reason reads here
 * as one that missed. That is the resolver's own suite to catch, which drives
 * the timeout directly; this file compares a recording of the **screens**, and
 * P9-F1 — the defect the check exists for — is about which directory the
 * recorder read, not about the resolver's prose.
 */
export function comparable(text) {
  return (
    text
      .replace(/\(\d+ ms\)/g, "(N ms)")
      .replace(/"configHash": "[0-9a-f]+"/g, '"configHash": "<per-run>"')
      .replace(/"(startedAt|endedAt|at|recordedAt)": "[^"]*"/g, '"$1": "<when>"')
      .replace(/"durationMs": [0-9.]+/g, '"durationMs": 0')
      // The rendered failure message, and the structured entry behind it.
      .replace(/error: candidate timed out after \d+ ms/g, "matched nothing")
      .replace(/"error": "candidate timed out after \d+ ms"/g, '"rejected": "matched nothing"')
  );
}
