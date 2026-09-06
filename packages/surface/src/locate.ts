/**
 * How long an adapter's `locate` may keep asking.
 *
 * Two clocks bound the same question. The **resolver** races each candidate
 * against `config.run.candidateTimeoutMs` (`DEFAULT_CANDIDATE_TIMEOUT_MS`,
 * 2000 ms) so one bad candidate cannot hold up a step; the **adapter** retries
 * a locate that found nothing, because a click is a request and the page it
 * changes answers a moment later (T11.2).
 *
 * Given the same budget the outer clock wins, and an element that is genuinely
 * absent is reported as `error: candidate timed out after 2000 ms` rather than
 * as `matched nothing` — a "could not tell" published as a cause, which is
 * exactly what P10-F5 says never to do. So the adapter stops short: it keeps
 * a margin for its answer to travel back, and the resolver hears the truth.
 */
export const LOCATE_RETURN_MARGIN_MS = 250;

/**
 * The instant an adapter's retrying `locate` must answer by, given the
 * resolver's per-candidate budget. `0` — the default when no budget is
 * configured — means "do not retry", which is what every adapter did before.
 */
export function locateDeadline(candidateTimeoutMs: number | undefined, now = Date.now()): number {
  const budget = candidateTimeoutMs ?? 0;
  if (budget <= 0) return now;
  return now + Math.max(0, budget - LOCATE_RETURN_MARGIN_MS);
}
