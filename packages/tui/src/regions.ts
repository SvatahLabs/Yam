/**
 * The region tree, and the arithmetic that fits it to a terminal (TV-T03, TV-04).
 *
 * The cockpit used to allocate three widths and two row counts, and every screen
 * was those four panes whether it wanted them or not. A run wants a wide step
 * list over a live tail; Session wants a target list beside a snapshot tree and
 * a form. So a view describes a *tree* — rows and columns, with weights and
 * minima — and this fits it to the terminal it is in.
 *
 * `budget()` in `layout.ts` is the same contract one level down, for the cells
 * of a line, and it is unchanged: it was the best thing in the old cockpit.
 * What was missing was the other half — **vertical fill** — which is why an
 * empty project drew ten rows and left thirty of black.
 *
 * Three properties, and `test/regions.test.ts` holds every generated tree to
 * them:
 *
 *   1. **No overflow.** No box crosses the terminal's right or bottom edge.
 *   2. **Exact fill.** The boxes of a split cover their parent with nothing
 *      left over — not "about right", exactly.
 *   3. **Collapse, never clip.** A region too narrow to read leaves the row
 *      rather than being drawn half off the screen, and says so, so the view
 *      can put it somewhere whole.
 *
 * No Ink and no `process`: this is arithmetic, so it is checked without a
 * terminal.
 */

/** A leaf: something a view will draw, and how much room it wants. */
export interface Pane {
  readonly id: string;
  /** Share of what is left over, after the fixed and the minima. Default 1. */
  readonly weight?: number;
  /** Never smaller than this along the split's axis. */
  readonly min?: number;
  /** Never larger. */
  readonly max?: number;
  /** Exactly this, whatever else wants room. Beats weight, min and max. */
  readonly fixed?: number;
  /**
   * Leave the split when the parent has fewer than this along the axis.
   *
   * The inspector at 120 columns: at 100 it is not squeezed to 30 and clipped,
   * it is *collapsed*, and the view draws it full width somewhere else. A pane
   * on screen but unreadable is worse than a pane that says it is not there.
   */
  readonly collapseBelow?: number;
}

/** A split: children along one axis. */
export interface Split {
  /** `rows` stacks them; `columns` puts them side by side. */
  readonly split: "rows" | "columns";
  readonly children: readonly Region[];
}

export type Region = Pane | Split;

export const isSplit = (one: Region): one is Split => "split" in one;

/** Where a pane ended up. Zero-based, in character cells. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Solved {
  /** Every pane that is drawn, by id. */
  readonly boxes: ReadonlyMap<string, Box>;
  /** Every pane that left its split, by id, in the order they were dropped. */
  readonly collapsed: readonly string[];
}

const clamp = (one: number, low: number, high: number): number => Math.max(low, Math.min(high, one));

/** What a region asks for along an axis, before anything is shared out. */
interface Ask {
  readonly region: Region;
  readonly weight: number;
  readonly min: number;
  readonly max: number;
  readonly fixed?: number;
  readonly collapseBelow?: number;
}

const askOf = (region: Region): Ask => {
  if (isSplit(region)) return { region, weight: 1, min: 1, max: Number.MAX_SAFE_INTEGER };
  return {
    region,
    weight: Math.max(0, region.weight ?? 1),
    min: Math.max(1, region.min ?? 1),
    max: Math.max(1, region.max ?? Number.MAX_SAFE_INTEGER),
    ...(region.fixed === undefined ? {} : { fixed: Math.max(1, region.fixed) }),
    ...(region.collapseBelow === undefined ? {} : { collapseBelow: region.collapseBelow }),
  };
};

/**
 * Share `available` among these asks, exactly.
 *
 * Fixed first, then every remaining ask gets its minimum, then what is still
 * left is shared by weight — and the last cell of the remainder goes to the
 * earliest asks, so the sum is `available` and not `available - 2`. A layout
 * that was one row short every third terminal size is a layout that draws a
 * blank line somebody will try to click on.
 */
function share(asks: readonly Ask[], available: number): number[] {
  if (asks.length === 0) return [];
  const sizes = asks.map((one) => one.fixed ?? one.min);
  const spent = sizes.reduce((sum, one) => sum + one, 0);

  if (spent > available) {
    /*
     * More minima than terminal. Take from the largest first — a water-fill, so
     * the panes that are already small are not the ones that pay.
     */
    let over = spent - available;
    while (over > 0 && sizes.some((one) => one > 1)) {
      let widest = 0;
      for (let at = 1; at < sizes.length; at += 1) if (sizes[at]! > sizes[widest]!) widest = at;
      sizes[widest] = sizes[widest]! - 1;
      over -= 1;
    }
    /*
     * And when even one row each is more than there is, the last panes get
     * none — which the caller reads as collapsed.
     *
     * Twelve panes cannot be drawn in five rows, and the honest answer is to
     * draw seven of them and say the rest are not there. Squeezing them to zero
     * *and drawing them anyway* is how a box ends up past the bottom edge, which
     * is what `test/regions.test.ts` caught the first time this was written.
     */
    for (let at = sizes.length - 1; at >= 0 && over > 0; at -= 1) {
      over -= sizes[at]!;
      sizes[at] = 0;
    }
    /* Trimming the last one may have overshot; give the slack back to the first. */
    const short = available - sizes.reduce((sum, one) => sum + one, 0);
    if (short > 0) {
      const first = sizes.findIndex((one) => one > 0);
      if (first >= 0) sizes[first] = sizes[first]! + short;
    }
    return sizes;
  }

  const growers = asks
    .map((one, at) => ({ at, weight: one.fixed === undefined ? one.weight : 0 }))
    .filter((one) => one.weight > 0);
  const total = growers.reduce((sum, one) => sum + one.weight, 0);
  let left = available - spent;
  if (total === 0 || left === 0) {
    /* Nothing wants to grow: the last ask takes the slack rather than a gap. */
    if (left > 0 && sizes.length > 0) sizes[sizes.length - 1] = sizes[sizes.length - 1]! + left;
    return sizes;
  }

  for (const grower of growers) {
    const want = Math.floor((left * grower.weight) / total);
    const ask = asks[grower.at]!;
    const give = clamp(sizes[grower.at]! + want, ask.min, ask.max) - sizes[grower.at]!;
    sizes[grower.at] = sizes[grower.at]! + give;
  }

  /* Whatever integer division left over, to the earliest ask that will take it. */
  let slack = available - sizes.reduce((sum, one) => sum + one, 0);
  while (slack > 0) {
    let gave = false;
    for (const grower of growers) {
      if (slack === 0) break;
      const ask = asks[grower.at]!;
      if (sizes[grower.at]! >= ask.max) continue;
      sizes[grower.at] = sizes[grower.at]! + 1;
      slack -= 1;
      gave = true;
    }
    if (!gave) break;
  }
  /* Still slack because everything hit its maximum: the last one takes it. */
  if (slack > 0) sizes[sizes.length - 1] = sizes[sizes.length - 1]! + slack;
  return sizes;
}

/**
 * Fit a tree to a terminal.
 *
 * Depth first, exact at every level: a split covers its own box, and its
 * children cover the split. Nothing is rounded twice, which is how a layout ends
 * up a row short at the bottom of a deep tree.
 */
export function solve(tree: Region, columns: number, rows: number): Solved {
  const boxes = new Map<string, Box>();
  const collapsed: string[] = [];
  const width = Math.max(1, Math.floor(columns));
  const height = Math.max(1, Math.floor(rows));

  const place = (region: Region, box: Box): void => {
    if (!isSplit(region)) {
      boxes.set(region.id, box);
      return;
    }
    const along = region.split === "columns" ? box.width : box.height;

    /*
     * Collapse before sharing, not after: a pane that will not fit must leave
     * the split *before* its neighbours are sized, or they are sized around a
     * pane that is not there.
     */
    const kept: Region[] = [];
    const dropped: Region[] = [];
    for (const child of region.children) {
      const ask = askOf(child);
      if (ask.collapseBelow !== undefined && along < ask.collapseBelow) {
        dropped.push(child);
        continue;
      }
      kept.push(child);
    }
    /*
     * Something is drawn, always. `collapseBelow` says "prefer to leave", not
     * "leave even when nothing would remain": a split whose children all
     * collapsed would be a box with room in it and nothing drawn, which is the
     * black rectangle this task exists to remove. The first child stays.
     */
    if (kept.length === 0 && dropped.length > 0) kept.push(dropped.shift()!);
    for (const child of dropped) collapse(child);
    if (kept.length === 0) return;

    const asks = kept.map(askOf);
    const sizes = share(asks, along);
    let at = region.split === "columns" ? box.x : box.y;
    kept.forEach((child, index) => {
      const size = sizes[index]!;
      /* No room at all: collapsed, and named, rather than drawn at nothing. */
      if (size <= 0) {
        collapse(child);
        return;
      }
      place(
        child,
        region.split === "columns"
          ? { x: at, y: box.y, width: size, height: box.height }
          : { x: box.x, y: at, width: box.width, height: size },
      );
      at += size;
    });
  };

  const collapse = (region: Region): void => {
    if (isSplit(region)) {
      for (const child of region.children) collapse(child);
      return;
    }
    collapsed.push(region.id);
  };

  place(tree, { x: 0, y: 0, width, height });
  return { boxes, collapsed };
}

/** A region and the box it was given, with its children beside it. */
export interface Placed {
  readonly region: Region;
  readonly box: Box;
  readonly children: readonly Placed[];
}

/**
 * The same solve, as a tree rather than a lookup (TV-T07).
 *
 * A renderer needs the box of every *split* as well as every pane: a split
 * drawn without a width is a split whose children lay themselves out at their
 * natural size, and on a real terminal that is a 189-character line on a
 * hundred columns — which is what the pseudo-terminal check caught the first
 * time this was drawn from `boxes` alone.
 */
export function place(tree: Region, columns: number, rows: number): Placed {
  const { boxes } = solve(tree, columns, rows);
  const walk = (region: Region, box: Box): Placed => {
    if (!isSplit(region)) return { region, box: boxes.get(region.id) ?? box, children: [] };
    const children: Placed[] = [];
    let at = region.split === "columns" ? box.x : box.y;
    let along = 0;
    for (const child of region.children) {
      const first = firstPane(child);
      const found = first === undefined ? undefined : boxes.get(first);
      if (found === undefined) continue;
      const size = region.split === "columns" ? found.width : found.height;
      const childBox: Box =
        region.split === "columns"
          ? { x: at, y: box.y, width: sizeOfSplit(child, boxes, "columns", size), height: box.height }
          : { x: box.x, y: at, width: box.width, height: sizeOfSplit(child, boxes, "rows", size) };
      children.push(walk(child, childBox));
      const taken = region.split === "columns" ? childBox.width : childBox.height;
      at += taken;
      along += taken;
    }
    return { region, box: { ...box, ...(region.split === "columns" ? { width: along } : { height: along }) }, children };
  };
  return walk(tree, { x: 0, y: 0, width: Math.max(1, Math.floor(columns)), height: Math.max(1, Math.floor(rows)) });
}

/** The first pane a region draws, which is where its box starts. */
function firstPane(region: Region): string | undefined {
  if (!isSplit(region)) return region.id;
  for (const child of region.children) {
    const found = firstPane(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** How much of an axis a region takes: its own, or the sum of what it holds. */
function sizeOfSplit(
  region: Region,
  boxes: ReadonlyMap<string, Box>,
  axis: "rows" | "columns",
  fallback: number,
): number {
  if (!isSplit(region)) {
    const box = boxes.get(region.id);
    return box === undefined ? fallback : axis === "columns" ? box.width : box.height;
  }
  const along = region.children
    .map((child) => (boxes.has(firstPane(child) ?? "") ? sizeOfSplit(child, boxes, axis, 0) : 0))
    .filter((one) => one > 0);
  if (along.length === 0) return fallback;
  return region.split === axis ? along.reduce((sum, one) => sum + one, 0) : Math.max(...along);
}

/** Every pane id in a tree, in the order it is laid out. */
export function panesOf(region: Region): string[] {
  return isSplit(region) ? region.children.flatMap(panesOf) : [region.id];
}
