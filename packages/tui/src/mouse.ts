/**
 * Reading the mouse (TV-T15, TV-10).
 *
 * The TV-T00 spike established two things about this. The bytes arrive: an SGR
 * 1006 sequence reaches `process.stdin` intact, twenty-two of them for a click.
 * And Ink does not surface them — `useInput` never fired, because it maps known
 * keys and drops what it does not recognise. So the cockpit reads the stream
 * itself, which is what `design.md` said it would before any of this was built.
 *
 * SGR 1006 rather than the older X10 encoding, because X10 packs the column into
 * a byte and gives up past 223 — and a 260-column terminal is ordinary now.
 */

/** One thing a person did with the mouse, in character cells, one-based as the terminal counts. */
export interface MouseEvent {
  readonly kind: "down" | "up" | "wheel-up" | "wheel-down";
  readonly column: number;
  readonly row: number;
}

/**
 * `\u001b[<0;30;10M` → a press at column 30, row 10.
 *
 * The button number carries the wheel in its high bits: 64 and 65 are up and
 * down. `M` is a press and `m` is a release, which is the whole of the SGR
 * extension over what came before.
 */
const SGR = /\u001b\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Every mouse event in a chunk of input, in the order they happened. */
export function decodeMouse(chunk: string): MouseEvent[] {
  const found: MouseEvent[] = [];
  SGR.lastIndex = 0;
  for (;;) {
    const match = SGR.exec(chunk);
    if (match === null) break;
    const button = Number(match[1]);
    const column = Number(match[2]);
    const row = Number(match[3]);
    const released = match[4] === "m";
    if (button === 64) found.push({ kind: "wheel-up", column, row });
    else if (button === 65) found.push({ kind: "wheel-down", column, row });
    else found.push({ kind: released ? "up" : "down", column, row });
  }
  return found;
}

/** Whether a chunk of input is mouse reporting rather than something typed. */
export const isMouse = (chunk: string): boolean => /\u001b\[</.test(chunk);

/** A box, as `regions.ts` solves them: zero-based, in cells. */
interface Boxed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Which region was clicked, and which of its rows.
 *
 * The terminal counts from one and a box from zero, and the frame's border and
 * padding are two rows and two columns of it — so a click on the first row of
 * text is `y + 2`. Getting this wrong puts the cursor one row off, which is the
 * kind of thing nobody reports and everybody notices.
 */
export function hitTest(
  boxes: ReadonlyMap<string, Boxed>,
  event: MouseEvent,
  /** How many rows of chrome sit above the regions. */
  offsetRows = 0,
): { id: string; row: number } | undefined {
  const x = event.column - 1;
  const y = event.row - 1 - offsetRows;
  for (const [id, box] of boxes) {
    if (x < box.x || x >= box.x + box.width) continue;
    if (y < box.y || y >= box.y + box.height) continue;
    /* One row of border and one of title before the first line. */
    const row = y - box.y - 2;
    return { id, row: Math.max(0, row) };
  }
  return undefined;
}
