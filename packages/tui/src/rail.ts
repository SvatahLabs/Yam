/**
 * The rail, as a terminal can draw it (TV-14).
 *
 * The app draws a rail from `SECTIONS` and the cockpit drew nothing: `[ ] screen`
 * in the footer names a key, not a list, so there was no way to learn that nine
 * screens exist or which one you are on. Both renderers share the model that
 * knows; only one was showing it.
 *
 * One row, because a column costs 14 of the 80 a narrow terminal has and the
 * regions need them. When the row does not fit, it scrolls rather than
 * truncating: the current screen stays on it, which is the one thing the strip
 * exists to say.
 */
import { RAIL, needsProject, type ScreenId } from "@svatah/yam-screens";

/** One destination, as the strip prints it. */
export interface RailEntry {
  /** What `g` is followed by. Printed on the strip, so it is read not recalled. */
  readonly key: string;
  readonly screen: ScreenId;
  readonly label: string;
  readonly current: boolean;
  /**
   * Whether this destination is shut, right now (`CX-03`, `AX-04`).
   *
   * The same rule the app's rail keeps, from the same table: a screen that is
   * about a project cannot be opened without one, and saying so *on the strip*
   * is what stops it being discovered by pressing `g f` and arriving at a wall.
   * A terminal has no window chrome to carry the navigation, which is the
   * argument for keeping the strip at all — and a strip that lies about where
   * it goes is worse than no strip.
   */
  readonly shut: boolean;
}

/**
 * The letter each destination answers to after `g`.
 *
 * Letters and not `1`–`9`, which is what this was first written as: the strip
 * sits directly above regions numbered `1`–`4`, so a numbered strip put the same
 * digits on the screen twice meaning two things — the ambiguity TV-15 rejected
 * for the mode strip, reintroduced one row higher.
 *
 * `s` and `t` for Session and Settings, `a` and `p` for Agents and API: the two
 * clashes go to a second letter of the word. Nobody has to remember which,
 * because the strip prints them.
 */
const JUMP: Readonly<Partial<Record<ScreenId, string>>> = {
  session: "s",
  flows: "f",
  bindings: "b",
  agents: "a",
  api: "p",
  data: "d",
  import: "i",
  runs: "r",
  settings: "t",
};

/** The strip's entries, in rail order, with their jump keys. */
export const RAIL_ENTRIES: ReadonlyArray<{ key: string; screen: ScreenId; label: string }> = RAIL.map(
  (one) => ({ key: JUMP[one.screen] ?? "", screen: one.screen, label: one.label }),
);

/** Which destinations are shut when no project is open (`CX-03`). */
export const shutWithoutProject = (screen: ScreenId): boolean => needsProject(screen);

/** The screen a jump key names, if it names one. */
export const screenForJump = (key: string): ScreenId | undefined =>
  RAIL_ENTRIES.find((one) => one.key === key)?.screen;

/** The next or previous screen in rail order, wrapping. */
export function walk(from: ScreenId, by: 1 | -1): ScreenId {
  const order = RAIL_ENTRIES.map((one) => one.screen);
  const at = order.indexOf(from);
  if (at < 0) return order[0] as ScreenId;
  return order[(at + by + order.length) % order.length] as ScreenId;
}

/** `1 Session`, and the two columns of padding that follow it. */
const widthOf = (one: { key: string; label: string }): number => one.key.length + 1 + one.label.length + 2;

/**
 * The entries that fit in `width`, keeping the current one on the row.
 *
 * A window rather than a truncation. `more.left` and `more.right` are what the
 * caller draws `‹` and `›` with, so that a strip which has scrolled says so
 * rather than looking like the whole list.
 */
export function railRow(
  current: ScreenId,
  width: number,
  /**
   * Whether a project is open (`CX-03`).
   *
   * Optional and defaulting to "yes", because the strip is drawn in places that
   * do not know — and a strip that marked everything shut on a screen with a
   * project open would be a worse lie than the one it is fixing.
   */
  project = true,
): { readonly entries: readonly RailEntry[]; readonly more: { left: boolean; right: boolean } } {
  const all = RAIL_ENTRIES.map((one) => ({
    ...one,
    current: one.screen === current,
    shut: !project && shutWithoutProject(one.screen),
  }));
  const total = all.reduce((sum, one) => sum + widthOf(one), 0);
  /* One space of leading padding, matching the status bar's. */
  if (total + 1 <= width) return { entries: all, more: { left: false, right: false } };

  const at = Math.max(0, all.findIndex((one) => one.current));
  /* Two columns for the markers, one for the leading pad. */
  let room = width - 3;
  let first = at;
  let last = at;
  /*
   * The current entry is admitted whatever the width, so its *label* is what
   * gives way — "5 Agents and tools" is twenty columns on its own, and a strip
   * that dropped it to fit would be a strip that stopped saying where you are.
   * The property in `test/rail.test.ts` found this at 20 columns on its first
   * run; before it, this line admitted the entry without measuring it.
   */
  const here = all[at] as RailEntry;
  if (widthOf(here) > room) {
    const budget = Math.max(1, room - here.key.length - 3);
    all[at] = { ...here, label: here.label.length <= budget ? here.label : `${here.label.slice(0, Math.max(0, budget - 1))}…` };
  }
  room -= widthOf(all[at] as RailEntry);
  /*
   * Grow outward from the current screen, right first: the screens after this
   * one are the ones a person has not seen yet, and `]` is the key they will
   * reach for.
   */
  for (;;) {
    const next = all[last + 1];
    const previous = all[first - 1];
    const grewRight = next !== undefined && widthOf(next) <= room;
    if (grewRight) {
      room -= widthOf(next);
      last += 1;
      continue;
    }
    const grewLeft = previous !== undefined && widthOf(previous) <= room;
    if (grewLeft) {
      room -= widthOf(previous);
      first -= 1;
      continue;
    }
    break;
  }
  return {
    entries: all.slice(first, last + 1),
    more: { left: first > 0, right: last < all.length - 1 },
  };
}
