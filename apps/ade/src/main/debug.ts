/**
 * The ADE's window-lifecycle log (Draft 2.13 §13.6, P10-F1).
 *
 * > the ADE logs its window lifecycle to its user-data directory when
 * > `YAM_ADE_DEBUG=1`
 *
 * The finding this exists for: a packaged ADE that "runs without a window".
 * Every symptom of that is *outside* the application — a gate polling System
 * Events, a bridge asking the accessibility API — and none of them can tell
 * "Electron never made a window" apart from "Electron made one and something
 * else cannot see it". Those two send a reader to opposite ends of the system,
 * and Phase 10 spent a verification on the second while looking at the first.
 *
 * So the application says what it did, in its own words, in a file that
 * survives it: created, shown, loaded, failed to load, closed, gone. One line
 * per event, an instant, and the facts as key–value pairs.
 *
 * ## Off unless asked
 *
 * `YAM_ADE_DEBUG=1`. A log is a file with a person's project paths in it and
 * the ADE stores nothing it does not have to (REQ-ADE-2), so it is opt-in, it
 * says where it is on the first line, and it never records a token or a URL
 * with one in it.
 *
 * ## Synchronous, and unguarded by design
 *
 * `appendFileSync`. The events worth having are the ones around a crash and a
 * quit, and a queued write is a write that does not survive either. The cost is
 * a few dozen small writes over a session.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Where the log goes, under the user-data directory Electron chose. */
export const debugLogPath = (userDataDir: string): string =>
  join(userDataDir, "ade-debug.log");

/** Is the log on? `YAM_ADE_DEBUG=1`, and nothing else. */
export const debugEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env["YAM_ADE_DEBUG"] === "1";

/**
 * One line: an instant, an event name, and the facts.
 *
 * Exported and pure so `test/debug.test.ts` can check the shape without a
 * filesystem — a log nobody can parse is a log nobody reads.
 */
export function debugLine(
  event: string,
  detail: Readonly<Record<string, unknown>> = {},
  now: Date = new Date(),
): string {
  const pairs = Object.entries(detail)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${format(value)}`);
  return `${now.toISOString()} ${event}${pairs.length === 0 ? "" : ` ${pairs.join(" ")}`}\n`;
}

/**
 * A value as one field. Spaces become underscores so a line stays parseable by
 * `split(" ")`, and a token-shaped string is never written: the ADE's service
 * URL carries one, and a debug log is the easiest place in the world to leak it
 * (REQ-NFR-6).
 */
function format(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "object") return JSON.stringify(value) ?? "?";
  return String(value).replace(/\s+/g, "_");
}

/** A logger, or one that does nothing when the flag is off. */
export interface DebugLog {
  readonly enabled: boolean;
  readonly path?: string;
  (event: string, detail?: Readonly<Record<string, unknown>>): void;
}

/**
 * Open the log for this session.
 *
 * A failure to write is swallowed once and turns the logger off: a read-only
 * user-data directory must not stop the application a person is trying to
 * start.
 */
export function openDebugLog(
  userDataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): DebugLog {
  if (!debugEnabled(env)) {
    const off = (): void => undefined;
    return Object.assign(off, { enabled: false as const });
  }

  const path = debugLogPath(userDataDir);
  let live = true;
  const write = (event: string, detail: Readonly<Record<string, unknown>> = {}): void => {
    if (!live) return;
    try {
      appendFileSync(path, debugLine(event, detail), "utf8");
    } catch {
      live = false;
    }
  };

  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    live = false;
  }
  write("log.opened", { path, pid: process.pid, platform: process.platform });
  return Object.assign(write, { enabled: true as const, path });
}
