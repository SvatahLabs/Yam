/**
 * The cockpit's arithmetic (T10.4, P9-F4, P10-F9, Draft 2.12 §13.7).
 *
 * `src/layout.ts` promised this file and Phase 10 never wrote it, which is part
 * of why P10-F9 shipped: the width budget was inside a renderer, so the only
 * way to ask "can this draw past the right edge?" was to run a pseudo-terminal
 * against a live service and measure the picture. That test exists
 * (`tools/repo-checks/test/tui-pty.test.ts`) and it is slow, needs `script(1)`,
 * and — this is the point — it *passed* on the implementer's checkout and
 * failed on the verifier's, because the overflow depended on how long the
 * content happened to be.
 *
 * So the budget is arithmetic now, and this states its contract directly:
 *
 *   **`sum(budget(cells, width)) + gaps <= width`, for every cells and width.**
 *
 * Checked here on the shapes the pane model actually produces and on ten
 * thousand generated lines, including the pathological ones a screen can hand
 * a narrow terminal: one cell holding an absolute path, twelve cells on twenty
 * columns, every cell a grower, no cells at all.
 */
import { describe, expect, it } from "vitest";
import {
  INSPECTOR_MIN_COLUMNS,
  budget,
  drawnWidth,
  footerFor,
  layoutFor,
  sizeOf,
  type Sized,
} from "../src/layout.js";

/** A deterministic generator, so a failure is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const WORDS = [
  "",
  "ok",
  "passed",
  "aborted",
  "Click the Book a slot link",
  "/var/folders/x5/4649y5v52wq3tdvnv_dhn2hw0000gn/T/svatah-tui-pty-Qz51sP",
  "flows/guards-and-compensation.flow",
  "booking.book-now-button",
  "…",
];

describe("the width budget covers every cell (P10-F9)", () => {
  it("never draws wider than the width it was given, for the shapes a pane has", () => {
    const shapes: Array<readonly Sized[]> = [
      [],
      [{ text: WORDS[5]! }],
      [{ text: "ok", width: 8 }, { text: WORDS[5]!, grow: true }],
      [{ text: WORDS[4]! }, { text: WORDS[5]! }, { text: WORDS[6]! }],
      [{ text: "a", grow: true }, { text: "b", grow: true }, { text: "c", grow: true }],
      [{ text: WORDS[5]!, width: 200 }],
    ];
    for (const cells of shapes) {
      for (let width = 0; width <= 200; width += 1) {
        const sizes = budget(cells, width);
        expect(sizes.length).toBe(cells.length);
        expect(
          drawnWidth(sizes),
          `${cells.length} cell(s) drew ${drawnWidth(sizes)} on ${width}`,
        ).toBeLessThanOrEqual(Math.max(0, width));
        for (const one of sizes) expect(one).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("holds for ten thousand generated lines", () => {
    const next = random(20_260_905);
    for (let round = 0; round < 10_000; round += 1) {
      const count = Math.floor(next() * 12);
      const cells: Sized[] = [];
      for (let at = 0; at < count; at += 1) {
        const text = WORDS[Math.floor(next() * WORDS.length)]!;
        const kind = next();
        cells.push(
          kind < 0.25
            ? { text, grow: true }
            : kind < 0.5
              ? { text, width: Math.floor(next() * 40) }
              : { text },
        );
      }
      const width = Math.floor(next() * 200);
      const drawn = drawnWidth(budget(cells, width));
      expect(drawn, `round ${round}: ${drawn} on ${width}`).toBeLessThanOrEqual(
        Math.max(0, width),
      );
    }
  });

  it("gives a fixed cell what it asked for when there is room", () => {
    const sizes = budget([{ text: "ok", width: 8 }, { text: "x", grow: true }], 40);
    expect(sizes[0]).toBe(8);
    // 40 − 8 − one gap.
    expect(sizes[1]).toBe(31);
  });

  it("shares what is left equally between the growers", () => {
    const sizes = budget(
      [{ text: "a", grow: true }, { text: "b", grow: true }, { text: "c", grow: true }],
      32,
    );
    expect(sizes).toEqual([10, 10, 10]);
    expect(drawnWidth(sizes)).toBe(32);
  });

  it("caps the widest column rather than the shortest (the water-fill)", () => {
    // 60 characters of content, ten of budget: the long one pays.
    const sizes = budget([{ text: "ok" }, { text: "x".repeat(58) }], 12);
    expect(sizes[0]).toBe(2);
    expect(drawnWidth(sizes)).toBeLessThanOrEqual(12);
  });

  it("drops a column the budget squeezed below three characters", () => {
    const sizes = budget(
      [{ text: "x".repeat(30) }, { text: "y".repeat(30) }, { text: "z".repeat(30) }],
      8,
    );
    expect(sizes.some((one) => one === 0)).toBe(true);
    expect(drawnWidth(sizes)).toBeLessThanOrEqual(8);
  });

  it("draws nothing at all when there is no room", () => {
    expect(budget([{ text: "a" }, { text: "b" }], 0)).toEqual([0, 0]);
    expect(budget([{ text: "a" }], -5)).toEqual([0]);
  });
});

describe("the panes are sized to the terminal (T10.4)", () => {
  it("never asks for more columns than the terminal has", () => {
    for (let columns = 40; columns <= 400; columns += 1) {
      const layout = layoutFor(columns, 40);
      const used = layout.tree + layout.main + (layout.inspector ?? 0);
      expect(used, `${columns} columns became ${used}`).toBe(layout.columns);
      expect(layout.columns).toBeGreaterThanOrEqual(Math.min(columns, 60));
    }
  });

  it("collapses the inspector below the width it needs", () => {
    expect(layoutFor(INSPECTOR_MIN_COLUMNS - 1, 30).inspectorCollapsed).toBe(true);
    expect(layoutFor(160, 40).inspectorCollapsed).toBe(false);
    expect(layoutFor(100, 30).inspector).toBeUndefined();
  });

  it("says the size it was drawn at", () => {
    expect(sizeOf(layoutFor(100, 30))).toBe("100×30");
  });
});

describe("the footer fits the terminal (P10-F9)", () => {
  const actions = [
    { key: "R", label: "Record" },
    { key: "N", label: "New flow" },
    { key: "L", label: "Lint the project" },
    { key: "V", label: "Verify bindings" },
    { key: "H", label: "Heal from the last run" },
    { key: undefined, label: "no key at all" },
  ];

  it("never asks for more than the terminal has, at any width", () => {
    for (let columns = 40; columns <= 400; columns += 1) {
      const keys = footerFor(columns, actions);
      const drawn = keys.reduce((sum, one) => sum + one.key.length + 1 + one.label.length + 2, -2);
      expect(drawn, `the footer drew ${drawn} on ${columns}`).toBeLessThanOrEqual(
        Math.max(columns, 73),
      );
    }
  });

  it("keeps the six keys and `q` however narrow the terminal is", () => {
    const keys = footerFor(40, actions).map((one) => one.key);
    expect(keys).toEqual(["^K", "1-4", "Tab", "j k", "Enter", "[ ]", "q"]);
  });

  it("takes the screen's accelerators when there is room for them", () => {
    const keys = footerFor(200, actions).map((one) => one.key);
    expect(keys).toContain("r");
    expect(keys).toContain("h");
    expect(keys.at(-1)).toBe("q");
  });

  it("takes some but not all of them on a hundred columns", () => {
    const keys = footerFor(100, actions);
    expect(keys.length).toBeGreaterThan(7);
    expect(keys.length).toBeLessThan(7 + actions.length);
  });
});
