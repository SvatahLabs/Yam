/**
 * The widgets' one rule (TV-T05, TV-04).
 *
 * **A widget given a height draws exactly that many lines.** Everything else in
 * this file is a consequence: the padding when there is too little, the window
 * when there is too much, the scrollbar that says where the window is, and the
 * zero state that names a next action rather than drawing an empty box.
 */
import { describe, expect, it } from "vitest";
import { render } from "ink";
import { EventEmitter } from "node:events";
import { Empty, Frame, StatusBar, scrollbar, window as slice } from "../src/widgets.js";
import type { PaneContent } from "../src/rows.js";

class FakeStdout extends EventEmitter {
  frames: string[] = [];
  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    super();
  }
  write = (frame: string): void => {
    this.frames.push(frame);
  };
  last = (): string => this.frames[this.frames.length - 1] ?? "";
}

/** Draw one element into a terminal of this size and hand back its lines. */
function draw(element: React.JSX.Element, columns = 60, rows = 20): string[] {
  const stdout = new FakeStdout(columns, rows);
  const instance = render(element, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
  });
  const frame = stdout.last();
  instance.unmount();
  return frame.replace(/\n$/, "").split("\n");
}

const content = (n: number, footer = false): PaneContent => ({
  title: "Rows",
  empty: "nothing here yet · press n to make one",
  lines: Array.from({ length: n }, (_, at) => ({
    key: `k${at}`,
    cells: [{ text: `row ${at}`, grow: true }],
  })),
  ...(footer ? { footer: { text: "a footer", tone: "abort" as const } } : {}),
});

describe("a frame fills its box (TV-04)", () => {
  it("draws exactly as many lines as it was given, with nothing in it", () => {
    for (const height of [3, 5, 12, 30]) {
      const lines = draw(
        <Frame
          box={{ x: 0, y: 0, width: 40, height }}
          title="Rows"
          focused={false}
          content={content(0)}
          cursor={0}
        />,
        40,
        height,
      );
      expect(lines.length, `an empty frame of ${height} drew ${lines.length}`).toBe(height);
    }
  });

  it("draws exactly as many with more rows than it can show", () => {
    for (const height of [4, 8, 20]) {
      const lines = draw(
        <Frame
          box={{ x: 0, y: 0, width: 40, height }}
          title="Rows"
          focused
          content={content(500)}
          cursor={250}
        />,
        40,
        height,
      );
      expect(lines.length, `a full frame of ${height} drew ${lines.length}`).toBe(height);
    }
  });

  it("is never wider than its box, at any width", () => {
    for (const width of [20, 40, 80, 120]) {
      const lines = draw(
        <Frame
          box={{ x: 0, y: 0, width, height: 8 }}
          title="A title long enough to want more room than this"
          focused
          content={content(20)}
          cursor={0}
        />,
        width,
        8,
      );
      for (const line of lines) expect(line.length, `${width}: "${line}"`).toBeLessThanOrEqual(width);
    }
  });

  it("says what is not there, and what makes one", () => {
    const lines = draw(
      <Frame
        box={{ x: 0, y: 0, width: 50, height: 6 }}
        title="Rows"
        focused={false}
        content={content(0)}
        cursor={0}
      />,
      50,
      6,
    );
    expect(lines.join("\n")).toContain("press n to make one");
  });

  it("keeps room for a footer without losing a row of the box", () => {
    const lines = draw(
      <Frame
        box={{ x: 0, y: 0, width: 40, height: 10 }}
        title="Rows"
        focused={false}
        content={content(40, true)}
        cursor={0}
      />,
      40,
      10,
    );
    expect(lines.length).toBe(10);
    expect(lines.join("\n")).toContain("a footer");
  });
});

describe("where the window is", () => {
  it("keeps the cursor on screen, and stops at the ends", () => {
    expect(slice(0, 100, 10)).toBe(0);
    expect(slice(99, 100, 10)).toBe(90);
    expect(slice(50, 100, 10)).toBe(45);
    expect(slice(3, 5, 10)).toBe(0);
  });

  it("draws a bar only when there is more than fits", () => {
    expect(scrollbar(0, 10, 10, 10).join("")).toBe(" ".repeat(10));
    const bar = scrollbar(0, 10, 100, 10).join("");
    expect(bar).toContain("▓");
    expect(bar).toContain("░");
    expect(bar.length).toBe(10);
  });

  it("puts the thumb at the bottom when the list is at the bottom", () => {
    const bar = scrollbar(90, 10, 100, 10);
    expect(bar[bar.length - 1]).toBe("▓");
    expect(bar[0]).toBe("░");
  });
});

describe("a zero state names its next action (TV-06)", () => {
  it("draws the headline, the sentence and the keys", () => {
    const lines = draw(
      <Empty
        box={{ x: 0, y: 0, width: 60, height: 12 }}
        headline="There is no Yam project here."
        sentences={["You do not need one."]}
        actions={[
          { key: "c", label: "Connect to a target", hint: "a browser, an endpoint" },
          { key: "i", label: "Start a project here" },
        ]}
      />,
      60,
      12,
    ).join("\n");
    expect(lines).toContain("There is no Yam project here.");
    expect(lines).toContain("You do not need one.");
    expect(lines).toContain("Connect to a target");
    expect(lines).toContain("Start a project here");
  });
});

describe("the status bar is one line, whatever is in it", () => {
  it("puts the right-hand side on the right, and stays inside the terminal", () => {
    for (const width of [40, 80, 120]) {
      const lines = draw(
        <StatusBar width={width} left={["yam", "yam-fixtures", "Session"]} right={["live", `${width}x40`]} />,
        width,
        1,
      );
      expect(lines.length).toBe(1);
      expect(lines[0]!.length).toBeLessThanOrEqual(width);
    }
  });
});
