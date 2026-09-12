/**
 * The palette's matching and ordering (TV-T13, TV-08).
 *
 * The cockpit's palette could not move its selection: `Enter` ran the first
 * match, always, so an action four rows down was reachable only by typing until
 * it was first. And it matched with `includes`, so "hl" found nothing and
 * "heal" found everything with the word in it, in registry order.
 *
 * This is the arithmetic — scoring, ordering, and what a row says about itself —
 * with no Ink in it, so it is checked without a terminal.
 */
import type { Action, ScreenStateBase } from "@svatah/yam-screens";

export interface PaletteRow {
  readonly id: string;
  readonly label: string;
  readonly area: string;
  readonly cli?: string;
  /** Which characters of the label the query matched, for the highlight. */
  readonly hits: readonly number[];
  /** Whether this action can run where the person is standing. */
  readonly available: boolean;
  /** Why not, when it cannot. Shown rather than hidden (TV-08). */
  readonly why?: string;
  readonly score: number;
}

/**
 * Score one candidate against a query, subsequence-wise.
 *
 * Every character of the query must appear in order, so `hl` finds "Heal" and
 * `xyz` finds nothing. What raises a score is what a person is doing when they
 * type: the start of a word, a run of characters together, the beginning of the
 * label. Nothing here is tuned; each rule is one a reader can check against
 * their own typing.
 */
export function score(query: string, text: string): { score: number; hits: number[] } | undefined {
  if (query === "") return { score: 0, hits: [] };
  const lower = text.toLowerCase();
  const hits: number[] = [];
  let at = 0;
  let points = 0;
  let run = 0;
  for (const letter of query.toLowerCase()) {
    const found = lower.indexOf(letter, at);
    if (found < 0) return undefined;
    /* A word's first letter is what a person aims at. */
    const boundary = found === 0 || /[\s.\-_/]/.test(lower[found - 1] ?? "");
    points += boundary ? 8 : 1;
    /* Consecutive characters mean they are typing the thing, not stumbling on it. */
    run = found === at ? run + 1 : 0;
    points += run * 3;
    hits.push(found);
    at = found + 1;
  }
  /* An earlier first match beats a later one, all else equal. */
  return { score: points - Math.floor((hits[0] ?? 0) / 4), hits };
}

export interface PaletteOptions {
  readonly query: string;
  readonly state?: ScreenStateBase;
  /** Action ids, most recently run first. */
  readonly recents?: readonly string[];
}

/**
 * The rows to draw, in the order to draw them.
 *
 * Unavailable actions are *listed*, greyed, with the reason — an action that
 * vanishes teaches nothing, and a person who typed its name deserves to be told
 * why it is not offered rather than left wondering whether they misremembered
 * it (TV-08).
 */
export function rowsFor(actions: readonly Action[], options: PaletteOptions): PaletteRow[] {
  const query = options.query.trim();
  const recents = options.recents ?? [];
  const rows: PaletteRow[] = [];

  for (const action of actions) {
    const against = [action.label, action.id, action.cli ?? ""];
    let best: { score: number; hits: number[] } | undefined;
    let bestAt = 0;
    against.forEach((text, at) => {
      const found = score(query, text);
      if (found === undefined) return;
      /* The label is what is drawn, so a match on it is worth more. */
      const weighted = { score: found.score + (at === 0 ? 6 : 0), hits: at === 0 ? found.hits : [] };
      if (best === undefined || weighted.score > best.score) {
        best = weighted;
        bestAt = at;
      }
    });
    if (best === undefined) continue;
    void bestAt;

    const available = options.state === undefined ? action.group === "Go to" : action.availableWhen(options.state);
    const recent = recents.indexOf(action.id);
    rows.push({
      id: action.id,
      label: action.label,
      area: action.id.split(".")[0] ?? action.id,
      ...(action.cli === undefined ? {} : { cli: action.cli }),
      hits: best.hits,
      available,
      ...(available ? {} : { why: "not available on this screen" }),
      score:
        best.score +
        (recent >= 0 ? 40 - recent * 4 : 0) +
        /* Available first, but present either way. */
        (available ? 20 : 0),
    });
  }

  return rows.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

/** Where the selection goes, clamped, with nothing to wrap around to. */
export const moveSelection = (at: number, by: number, total: number): number =>
  total === 0 ? 0 : Math.max(0, Math.min(total - 1, at + by));
