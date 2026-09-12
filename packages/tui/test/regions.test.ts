/**
 * The region tree's arithmetic (TV-T03, TV-04).
 *
 * `layout.test.ts` states the same kind of contract for the cells of a line and
 * has held since Phase 10; this is the half that was missing, and it is stated
 * the same way — as properties, over thousands of generated trees, rather than
 * as three examples somebody thought of.
 *
 *   1. no box crosses the terminal's edge;
 *   2. the boxes of a split cover it exactly;
 *   3. a region too narrow to read leaves the split and says so.
 */
import { describe, expect, it } from "vitest";
import { panesOf, solve, type Region } from "../src/regions.js";

/** A deterministic generator, so a failure is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** A tree of up to `depth` levels, with weights, minima and collapse rules. */
function tree(next: () => number, depth = 3, id = { n: 0 }): Region {
  if (depth === 0 || next() < 0.3) {
    const pane: Record<string, unknown> = { id: `p${(id.n += 1)}` };
    if (next() < 0.5) pane["weight"] = Math.floor(next() * 4) + 1;
    if (next() < 0.4) pane["min"] = Math.floor(next() * 12) + 1;
    if (next() < 0.2) pane["max"] = Math.floor(next() * 40) + 4;
    if (next() < 0.15) pane["fixed"] = Math.floor(next() * 8) + 1;
    if (next() < 0.25) pane["collapseBelow"] = Math.floor(next() * 100) + 20;
    return pane as unknown as Region;
  }
  const children = Array.from({ length: Math.floor(next() * 3) + 2 }, () => tree(next, depth - 1, id));
  return { split: next() < 0.5 ? "rows" : "columns", children };
}

describe("no box crosses the terminal's edge (TV-04)", () => {
  it("holds for ten thousand generated trees at generated sizes", () => {
    for (let seed = 1; seed <= 10_000; seed += 1) {
      const next = random(seed);
      const shape = tree(next);
      const columns = Math.floor(next() * 260) + 20;
      const rows = Math.floor(next() * 90) + 5;
      const { boxes } = solve(shape, columns, rows);
      for (const [id, box] of boxes) {
        expect(box.x, `${seed}/${id} starts left of the terminal`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${seed}/${id} starts above the terminal`).toBeGreaterThanOrEqual(0);
        expect(box.width, `${seed}/${id} is not positive`).toBeGreaterThan(0);
        expect(box.height, `${seed}/${id} is not positive`).toBeGreaterThan(0);
        expect(box.x + box.width, `${seed}/${id} crosses the right edge`).toBeLessThanOrEqual(columns);
        expect(box.y + box.height, `${seed}/${id} crosses the bottom`).toBeLessThanOrEqual(rows);
      }
    }
  });
});

describe("a split is covered exactly (TV-04)", () => {
  const cover = (shape: Region, columns: number, rows: number): void => {
    const { boxes, collapsed } = solve(shape, columns, rows);
    const drawn = [...boxes.values()];
    /* Every cell of the terminal belongs to exactly one box, or to none if
       everything collapsed. */
    const area = drawn.reduce((sum, one) => sum + one.width * one.height, 0);
    /*
     * Exactly, even when something collapsed: what leaves a split gives its room
     * to the panes that stayed. A collapse that left a gap would be the black
     * rectangle this whole task exists to remove.
     */
    if (drawn.length > 0) {
      expect(area, `${columns}x${rows} left ${columns * rows - area} cells unclaimed`).toBe(
        columns * rows,
      );
    }
    void collapsed;
    /* And no two boxes overlap. */
    for (let a = 0; a < drawn.length; a += 1) {
      for (let b = a + 1; b < drawn.length; b += 1) {
        const one = drawn[a]!;
        const two = drawn[b]!;
        const apart =
          one.x + one.width <= two.x ||
          two.x + two.width <= one.x ||
          one.y + one.height <= two.y ||
          two.y + two.height <= one.y;
        expect(apart, `two boxes overlap at ${columns}x${rows}`).toBe(true);
      }
    }
  };

  it("fills the terminal for the trees the views actually use", () => {
    const cockpit: Region = {
      split: "rows",
      children: [
        { id: "bar", fixed: 1 },
        {
          split: "columns",
          children: [
            { id: "tree", weight: 1, min: 20, max: 34 },
            { id: "main", weight: 2, min: 24 },
            { id: "inspector", weight: 1, min: 32, collapseBelow: 120 },
          ],
        },
        { id: "audit", weight: 0, min: 8 },
        { id: "footer", fixed: 1 },
      ],
    };
    for (const [columns, rows] of [
      [80, 24],
      [120, 40],
      [200, 50],
      [60, 16],
      [400, 120],
    ] as const) {
      cover(cockpit, columns, rows);
    }
  });

  it("holds for generated trees, at generated sizes", () => {
    for (let seed = 1; seed <= 3_000; seed += 1) {
      const next = random(seed + 50_000);
      cover(tree(next), Math.floor(next() * 200) + 20, Math.floor(next() * 60) + 6);
    }
  });
});

describe("collapse, never clip (TV-04)", () => {
  const three: Region = {
    split: "columns",
    children: [
      { id: "tree", min: 20 },
      { id: "main", weight: 2, min: 24 },
      { id: "inspector", min: 32, collapseBelow: 120 },
    ],
  };

  it("drops the inspector below its width, and says which", () => {
    const narrow = solve(three, 100, 30);
    expect(narrow.collapsed).toEqual(["inspector"]);
    expect(narrow.boxes.has("inspector")).toBe(false);
    /* And the two that stayed cover the whole terminal between them. */
    const area = [...narrow.boxes.values()].reduce((sum, one) => sum + one.width * one.height, 0);
    expect(area).toBe(100 * 30);
  });

  it("keeps it when there is room, at its own minimum or better", () => {
    const wide = solve(three, 160, 40);
    expect(wide.collapsed).toEqual([]);
    expect(wide.boxes.get("inspector")!.width).toBeGreaterThanOrEqual(32);
  });

  it("collapses before sizing, so the survivors are not sized round a ghost", () => {
    /*
     * The order matters: a pane that will not fit must leave the split before
     * its neighbours are measured, or they are given room that was allocated to
     * something nobody drew.
     */
    const narrow = solve(three, 100, 30);
    const main = narrow.boxes.get("main")!;
    const treeBox = narrow.boxes.get("tree")!;
    expect(treeBox.width + main.width).toBe(100);
  });
});

describe("something is always drawn (TV-04)", () => {
  it("keeps one child when every one of them would collapse", () => {
    /*
     * `collapseBelow` prefers to leave; it does not leave an empty box. A split
     * whose children all collapsed would be room with nothing in it, which is
     * the black rectangle the region tree exists to remove.
     */
    const all: Region = {
      split: "columns",
      children: [
        { id: "a", collapseBelow: 200 },
        { id: "b", collapseBelow: 200 },
      ],
    };
    const { boxes, collapsed } = solve(all, 80, 24);
    expect(boxes.size).toBe(1);
    expect(collapsed).toEqual(["b"]);
    expect(boxes.get("a")).toEqual({ x: 0, y: 0, width: 80, height: 24 });
  });
});

describe("what a tree says about itself", () => {
  it("lists its panes in layout order", () => {
    expect(
      panesOf({
        split: "rows",
        children: [{ id: "a" }, { split: "columns", children: [{ id: "b" }, { id: "c" }] }],
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("gives a lone pane the whole terminal", () => {
    const { boxes } = solve({ id: "only" }, 80, 24);
    expect(boxes.get("only")).toEqual({ x: 0, y: 0, width: 80, height: 24 });
  });

  it("never gives a box no rows, however many panes want the same twelve", () => {
    const many: Region = {
      split: "rows",
      children: Array.from({ length: 12 }, (_, at) => ({ id: `p${at}`, min: 3 })),
    };
    const { boxes } = solve(many, 80, 12);
    for (const [id, box] of boxes) expect(box.height, id).toBeGreaterThanOrEqual(1);
  });
});
