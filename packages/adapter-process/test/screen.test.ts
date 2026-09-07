/**
 * The screen is what is on the terminal, not what was written to it (T22, SF-22).
 *
 * The distinction is the whole of "terminal snapshot". A program that draws a
 * table redraws it — cursor home, write over, erase to end of line — and the
 * *stream* is a dozen overlapping copies while the *screen* is one table. Every
 * case here is a sequence a real program emits, and what it asserts is the grid
 * afterwards.
 */
import { describe, expect, it } from "vitest";
import { Screen } from "../src/screen.js";

const ESC = "\u001b";
const CSI = `${ESC}[`;

const screen = (columns = 20, rows = 5): Screen => new Screen({ columns, rows });

describe("plain text", () => {
  it("puts characters where the cursor is, and wraps at the edge", () => {
    const one = screen(5, 3);
    one.write("abcdefg");
    expect(one.lines()).toEqual(["abcde", "fg", ""]);
  });

  it("treats a carriage return as a return to column one, which is how a progress bar works", () => {
    const one = screen(10, 2);
    one.write("10%\r100%");
    expect(one.lines()[0]).toBe("100%");
  });

  it("honours a backspace, so an echoed control character can be taken back", () => {
    const one = screen(10, 2);
    one.write("ab\b\bxy");
    expect(one.lines()[0]).toBe("xy");
  });

  it("scrolls when the last line is passed, keeping the newest", () => {
    const one = screen(6, 2);
    one.write("aaa\r\nbbb\r\nccc");
    expect(one.lines()).toEqual(["bbb", "ccc"]);
  });

  /*
   * A line feed moves down and does not return to column one — that is what a
   * terminal does, and a pseudo-terminal's line discipline is what turns a
   * program's `\n` into `\r\n` on the way out. Pinned here because it looks
   * like a bug until you remember which side of the tty you are on: every
   * chunk this screen is given comes from a pty master, so it always has the
   * carriage return.
   */
  it("moves down without returning to column one on a bare line feed", () => {
    const one = screen(8, 3);
    one.write("aaa\nbbb");
    expect(one.lines().slice(0, 2)).toEqual(["aaa", "   bbb"]);
  });

  it("says where the cursor is, one-based, as a terminal does", () => {
    const one = screen(10, 3);
    one.write("ab");
    expect(one.cursor).toEqual({ row: 1, column: 3 });
  });
});

describe("the sequences a redrawing program uses", () => {
  it("erases the display and goes home, which is what `clear` is", () => {
    const one = screen(10, 3);
    one.write("keep me");
    one.write(`${CSI}2J${CSI}H`);
    expect(one.text()).toBe("");
    expect(one.cursor).toEqual({ row: 1, column: 1 });
  });

  it("overwrites in place rather than accumulating, which is the whole point", () => {
    const one = screen(12, 2);
    one.write("Loading…");
    one.write(`${CSI}H${CSI}KReady`);
    expect(one.lines()[0], "one answer, not two").toBe("Ready");
  });

  it("erases to the end of a line without touching what is before the cursor", () => {
    const one = screen(12, 2);
    one.write("abcdefgh");
    one.write(`${CSI}4G${CSI}K`);
    expect(one.lines()[0]).toBe("abc");
  });

  it("addresses a row and column absolutely", () => {
    const one = screen(10, 4);
    one.write(`${CSI}3;5Hx`);
    expect(one.lines()[2]).toBe("    x");
  });

  it("moves the cursor up, down, left and right", () => {
    const one = screen(10, 4);
    one.write(`${CSI}2;2Ha${CSI}B b${CSI}2Ac`);
    expect(one.lines()[1]!.startsWith(" a")).toBe(true);
  });

  it("discards colour, because a semantic snapshot is about what a screen says", () => {
    const one = screen(20, 2);
    one.write(`${CSI}31;1mred${CSI}0m and plain`);
    expect(one.lines()[0]).toBe("red and plain");
  });

  it("skips a sequence it does not implement rather than printing it", () => {
    const one = screen(20, 2);
    one.write(`${CSI}?25labc${CSI}?25h`);
    expect(one.lines()[0], "no escape bytes reach the text").toBe("abc");
  });

  it("skips a window-title sequence, which is not on the screen", () => {
    const one = screen(20, 2);
    one.write(`${ESC}]0;a title\u0007visible`);
    expect(one.lines()[0]).toBe("visible");
  });

  it("deletes and inserts lines", () => {
    const one = screen(6, 4);
    one.write("aa\r\nbb\r\ncc");
    one.write(`${CSI}1;1H${CSI}1M`);
    expect(one.lines().slice(0, 2)).toEqual(["bb", "cc"]);
  });
});

describe("a sequence split across two chunks (T22)", () => {
  /*
   * A pseudo-terminal hands over whatever has arrived, which can be half an
   * escape. A screen that printed the half it had would put `[2` in the text
   * and then treat `J` as a character — which is how a snapshot comes to
   * contain escape bytes.
   */
  it("holds an incomplete escape until the rest of it arrives", () => {
    const one = screen(10, 2);
    one.write("gone");
    one.write(`${CSI}2`);
    expect(one.lines()[0], "nothing printed yet").toBe("gone");
    one.write("J");
    expect(one.text()).toBe("");
  });

  it("holds a lone escape at the very end of a chunk", () => {
    const one = screen(10, 2);
    one.write(`ab${ESC}`);
    expect(one.lines()[0]).toBe("ab");
    one.write("[3Gx");
    expect(one.lines()[0]).toBe("abx");
  });
});

describe("the stream beside the screen (SF-22)", () => {
  it("keeps everything that was written, which the screen does not", () => {
    const one = screen(6, 2);
    one.write("first\r");
    one.write("second");
    expect(one.lines()[0], "the screen is the last thing drawn").toBe("second");
    expect(one.raw, "the stream is everything").toContain("first");
  });

  it("is bounded, so a long-running program is not an unbounded buffer", () => {
    const one = new Screen({ columns: 10, rows: 2 }, { streamLimit: 32 });
    one.write("x".repeat(100));
    expect(one.raw.length).toBe(32);
  });
});

describe("resizing", () => {
  it("keeps what still fits", () => {
    const one = screen(10, 3);
    one.write("abcdefghij");
    one.resize({ columns: 5, rows: 3 });
    expect(one.lines()[0]).toBe("abcde");
    expect(one.dimensions).toEqual({ columns: 5, rows: 3 });
  });
});
