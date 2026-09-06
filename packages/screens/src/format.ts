/**
 * The formatting a **renderer** does, and the model does not (T10.4, P9-F4,
 * Draft 2.12 §13.7).
 *
 * > State carries **timestamps**, never a relative time as text; "20 s ago" is
 * > the renderer's, so two loads of one state are equal.
 *
 * The Flows screen's list used to carry `"run 20 s ago"` as a string in its
 * state. Two loads a second apart therefore produced two different states for a
 * project nothing had happened to — which made `svatah ui --json` unequal to a
 * second evaluation of the same screen, and flaked
 * `tui-pty.test.ts › prints the Flows screen the same way` on Node 22 with
 * `"run 19 s ago"` against `"run 20 s ago"`.
 *
 * A state is a value. A value that changes when nothing changed cannot be
 * compared, cached, or printed for an agent twice — so the model carries the
 * instant (`lastRunAt`, an ISO timestamp the service wrote) and this is what the
 * ADE and `svatah ui` each call to turn it into words. Both call the *same*
 * function, so the two renderers still say the same thing.
 */

/**
 * `"run 22 min ago"`, from an ISO timestamp and the moment now.
 *
 * Whole units, as the mockups write them (`Main`: "3 stories · run 22 min ago").
 * `undefined` in, `undefined` out — a flow that has never run has no line here
 * rather than a line saying so.
 *
 * `now` is a parameter and not `Date.now()` so this is a pure function: the
 * renderers pass the clock, and a test passes a fixed instant.
 */
export function ago(at: string | undefined, now: number): string | undefined {
  if (at === undefined) return undefined;
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return undefined;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return `run ${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `run ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `run ${hours} h ago`;
  return `run ${Math.round(hours / 24)} d ago`;
}
