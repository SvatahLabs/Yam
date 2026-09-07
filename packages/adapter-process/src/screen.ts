/**
 * What is on the terminal, after everything the program wrote (T22, SF-22).
 *
 * A terminal's output is not its screen. A program that draws a table redraws
 * it: it moves the cursor home, writes over what was there, erases to the end
 * of the line, and the *stream* is a dozen overlapping copies while the
 * *screen* is one table. So "terminal snapshot" means keeping a grid and
 * applying the escape sequences to it — anything less is a snapshot of a log.
 *
 * The subset implemented here is the one a command-line program and a
 * full-screen TUI actually use: cursor movement, erase, scroll, line wrap, and
 * SGR (which is discarded, because a semantic snapshot is about what the screen
 * says and not what colour it is). An unrecognised sequence is skipped rather
 * than printed, so a snapshot never contains escape bytes.
 *
 * It is deliberately not a terminal emulator. There is no alternate character
 * set, no mouse, no bracketed paste and no scrollback addressing; what those
 * sequences do to a real terminal is not what this does, and the honest place
 * to say so is here and in the adapter's capabilities.
 */

/** The escape that begins a control sequence, and the bell, by name. */
const ESC = "\u001b";
const BEL = "\u0007";

export interface ScreenSize {
  readonly columns: number;
  readonly rows: number;
}

/** A bounded grid of characters, and a cursor. */
export class Screen {
  private grid: string[][];
  private row = 0;
  private column = 0;
  /** Everything ever written, for the streams a caller can read (SF-22). */
  private stream = "";
  private readonly streamLimit: number;
  private pending = "";

  constructor(
    private size: ScreenSize,
    options: { streamLimit?: number } = {},
  ) {
    this.streamLimit = options.streamLimit ?? 1024 * 1024;
    this.grid = Screen.blank(size);
  }

  private static blank(size: ScreenSize): string[][] {
    return Array.from({ length: size.rows }, () => Array.from({ length: size.columns }, () => " "));
  }

  get dimensions(): ScreenSize {
    return this.size;
  }

  resize(size: ScreenSize): void {
    const old = this.grid;
    this.size = size;
    this.grid = Screen.blank(size);
    for (let r = 0; r < Math.min(old.length, size.rows); r += 1) {
      for (let c = 0; c < Math.min(old[r]!.length, size.columns); c += 1) {
        this.grid[r]![c] = old[r]![c]!;
      }
    }
    this.row = Math.min(this.row, size.rows - 1);
    this.column = Math.min(this.column, size.columns - 1);
  }

  /** Everything the program has written, unprocessed, bounded. */
  get raw(): string {
    return this.stream;
  }

  /** The cursor, one-based, as a terminal reports it. */
  get cursor(): { row: number; column: number } {
    return { row: this.row + 1, column: this.column + 1 };
  }

  /** The visible screen, one string per row, trailing blanks trimmed. */
  lines(): string[] {
    return this.grid.map((row) => row.join("").replace(/\s+$/u, ""));
  }

  /** The visible screen as one string. */
  text(): string {
    return this.lines().join("\n").replace(/\n+$/u, "");
  }

  /**
   * Apply what the program wrote.
   *
   * A chunk can end mid-sequence — a pty hands over whatever has arrived — so an
   * incomplete escape is held back rather than printed as characters, which is
   * how a snapshot comes to contain `[2J` as text.
   */
  write(chunk: string): void {
    this.stream = `${this.stream}${chunk}`.slice(-this.streamLimit);
    let input = this.pending + chunk;
    this.pending = "";
    let at = 0;
    while (at < input.length) {
      const ch = input[at]!;
      if (ch !== ESC) {
        this.put(ch);
        at += 1;
        continue;
      }
      const consumed = this.escape(input, at);
      if (consumed === undefined) {
        // Incomplete: keep it for the next chunk.
        this.pending = input.slice(at);
        return;
      }
      at += consumed;
    }
    input = "";
  }

  /** One ordinary character, or a control code. */
  private put(ch: string): void {
    switch (ch) {
      case "\n":
        this.newline();
        return;
      case "\r":
        this.column = 0;
        return;
      case "\b":
        this.column = Math.max(0, this.column - 1);
        return;
      case "\t": {
        const next = Math.min(this.size.columns - 1, (Math.floor(this.column / 8) + 1) * 8);
        this.column = next;
        return;
      }
      case BEL:
        // A bell is a sound, not a character on the screen.
        return;
      default:
        break;
    }
    if (ch < " ") return;
    if (this.column >= this.size.columns) {
      this.column = 0;
      this.newline();
    }
    this.grid[this.row]![this.column] = ch;
    this.column += 1;
  }

  private newline(): void {
    this.row += 1;
    if (this.row < this.size.rows) return;
    this.row = this.size.rows - 1;
    this.grid.shift();
    this.grid.push(Array.from({ length: this.size.columns }, () => " "));
  }

  /**
   * One escape sequence. Returns how many characters it consumed, or
   * `undefined` when the sequence is not complete yet.
   */
  private escape(input: string, at: number): number | undefined {
    const next = input[at + 1];
    if (next === undefined) return undefined;

    /* ── OSC: `ESC ] … BEL` or `ESC ] … ESC \` — a window title, not the screen */
    if (next === "]") {
      const bell = input.indexOf(BEL, at);
      const st = input.indexOf(`${ESC}\\`, at + 2);
      if (bell < 0 && st < 0) return undefined;
      const end = bell < 0 ? st + 2 : st < 0 ? bell + 1 : Math.min(bell + 1, st + 2);
      return end - at;
    }

    /* ── CSI: `ESC [ params intermediate final` ─────────────────────────────── */
    if (next === "[") {
      let cursor = at + 2;
      while (cursor < input.length && /[\d;?<>! ]/u.test(input[cursor]!)) cursor += 1;
      if (cursor >= input.length) return undefined;
      const final = input[cursor]!;
      const params = input
        .slice(at + 2, cursor)
        .replace(/^[?<>!]/u, "")
        .split(";")
        .map((one) => (one === "" ? undefined : Number(one)));
      this.csi(final, params);
      return cursor - at + 1;
    }

    /* ── two-character sequences ────────────────────────────────────────────── */
    if (next === "M") {
      // Reverse index: up one line, scrolling down at the top.
      if (this.row === 0) {
        this.grid.pop();
        this.grid.unshift(Array.from({ length: this.size.columns }, () => " "));
      } else {
        this.row -= 1;
      }
      return 2;
    }
    if (next === "7" || next === "8" || next === "=" || next === ">" || next === "c") return 2;
    // `ESC ( B` and friends: a character set, three long.
    if (next === "(" || next === ")" || next === "*" || next === "+") {
      return input.length > at + 2 ? 3 : undefined;
    }
    return 2;
  }

  private csi(final: string, params: Array<number | undefined>): void {
    const n = (index = 0, fallback = 1): number => {
      const value = params[index];
      return value === undefined || Number.isNaN(value) ? fallback : value;
    };
    switch (final) {
      case "A":
        this.row = Math.max(0, this.row - n());
        return;
      case "B":
        this.row = Math.min(this.size.rows - 1, this.row + n());
        return;
      case "C":
        this.column = Math.min(this.size.columns - 1, this.column + n());
        return;
      case "D":
        this.column = Math.max(0, this.column - n());
        return;
      case "E":
        this.row = Math.min(this.size.rows - 1, this.row + n());
        this.column = 0;
        return;
      case "F":
        this.row = Math.max(0, this.row - n());
        this.column = 0;
        return;
      case "G":
        this.column = Math.min(this.size.columns - 1, Math.max(0, n() - 1));
        return;
      case "d":
        this.row = Math.min(this.size.rows - 1, Math.max(0, n() - 1));
        return;
      case "H":
      case "f":
        this.row = Math.min(this.size.rows - 1, Math.max(0, n(0) - 1));
        this.column = Math.min(this.size.columns - 1, Math.max(0, n(1) - 1));
        return;
      case "J":
        this.eraseDisplay(n(0, 0));
        return;
      case "K":
        this.eraseLine(n(0, 0));
        return;
      case "L": {
        // Insert lines at the cursor.
        for (let i = 0; i < n(); i += 1) {
          this.grid.splice(this.row, 0, Array.from({ length: this.size.columns }, () => " "));
          this.grid.length = this.size.rows;
        }
        return;
      }
      case "M": {
        // Delete lines at the cursor.
        for (let i = 0; i < n(); i += 1) {
          this.grid.splice(this.row, 1);
          this.grid.push(Array.from({ length: this.size.columns }, () => " "));
        }
        return;
      }
      case "P": {
        // Delete characters at the cursor.
        const row = this.grid[this.row]!;
        row.splice(this.column, n());
        while (row.length < this.size.columns) row.push(" ");
        return;
      }
      case "X": {
        // Erase characters at the cursor.
        for (let i = 0; i < n(); i += 1) {
          if (this.column + i < this.size.columns) this.grid[this.row]![this.column + i] = " ";
        }
        return;
      }
      default:
        /*
         * `m` is colour, `h`/`l` are modes, `r` is the scroll region, `s`/`u`
         * save and restore the cursor. None of them changes what the screen
         * *says*, which is what a semantic snapshot is about — and skipping one
         * is what keeps escape bytes out of the text.
         */
        return;
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.grid = Screen.blank(this.size);
      return;
    }
    if (mode === 0) {
      this.eraseLine(0);
      for (let r = this.row + 1; r < this.size.rows; r += 1) {
        this.grid[r] = Array.from({ length: this.size.columns }, () => " ");
      }
      return;
    }
    this.eraseLine(1);
    for (let r = 0; r < this.row; r += 1) {
      this.grid[r] = Array.from({ length: this.size.columns }, () => " ");
    }
  }

  private eraseLine(mode: number): void {
    const row = this.grid[this.row]!;
    const from = mode === 0 ? this.column : 0;
    const to = mode === 1 ? this.column + 1 : this.size.columns;
    for (let c = from; c < to; c += 1) row[c] = " ";
  }
}
