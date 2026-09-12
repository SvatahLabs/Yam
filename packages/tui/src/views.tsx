/**
 * What each screen's regions are, and how a tree of them is drawn (TV-T07).
 *
 * A screen is a *tree* now, not four fixed panes. Session wants a target list
 * beside a snapshot and a form; a run wants a wide step list over a live tail;
 * the nine screens nobody has migrated yet want the four numbered panes they
 * have always had, and get them from the same solver.
 *
 * Two things live here and nothing else: which tree a screen is, and how a tree
 * becomes Ink. What each region *contains* is `rows.ts`'s, unchanged.
 */
import { Box as InkBox, Text } from "ink";
import { isSplit, place, solve, type Placed, type Region } from "./regions.js";
import { paneModel, type PaneContent, type PaneModel } from "./rows.js";
import { Frame } from "./widgets.js";
import { actionById, type ScreenId, type ScreenStateBase } from "@svatah/yam-screens";
import { keysFor } from "./keys.js";

/** A screen's regions: the tree, what is in each, and the order `Tab` walks. */
export interface View {
  readonly tree: Region;
  readonly panes: Readonly<Record<string, PaneContent>>;
  /** The regions a person can focus, in `Tab` order. Numbered `1`… in the frame. */
  readonly focusOrder: readonly string[];
}

/**
 * The four numbered panes, as a tree (T9.4's artboard).
 *
 * The layout the cockpit has always drawn, expressed in the thing that can now
 * fill a terminal. The inspector still collapses at 120 columns — that rule was
 * right — but it is a property of the region now rather than a branch in the
 * renderer.
 */
export function classicTree(): Region {
  return {
    split: "rows",
    children: [
      {
        split: "columns",
        children: [
          { id: "tree", weight: 1, min: 20, max: 34 },
          { id: "main", weight: 2, min: 24 },
          { id: "inspector", weight: 1, min: 32, max: 46, collapseBelow: 120 },
        ],
      },
      { id: "audit", weight: 0, min: 6, max: 12 },
    ],
  };
}

/**
 * Session: the target list, the subject, and what will be written (REQ-ADE-14).
 *
 * The subject is the mode's — a snapshot in `do`, the sentences in `say`, the
 * capture in `record` — and it takes the room, because it is what a person is
 * looking at. The session log is the tail underneath, which every mode writes to.
 */
export function sessionTree(): Region {
  return {
    split: "rows",
    children: [
      {
        split: "columns",
        children: [
          { id: "tree", weight: 1, min: 24, max: 34 },
          { id: "main", weight: 3, min: 30 },
          { id: "inspector", weight: 1, min: 30, max: 40, collapseBelow: 110 },
        ],
      },
      { id: "audit", weight: 0, min: 6, max: 14 },
    ],
  };
}

/** A run: a wide step list over the events arriving under it. */
export function runTree(): Region {
  return {
    split: "rows",
    children: [
      {
        split: "columns",
        children: [
          { id: "tree", weight: 1, min: 22, max: 32, collapseBelow: 100 },
          { id: "main", weight: 3, min: 34 },
          { id: "inspector", weight: 1, min: 28, max: 38, collapseBelow: 130 },
        ],
      },
      { id: "audit", weight: 1, min: 8 },
    ],
  };
}

/** Flows: the files, the text, what the cursor is on, and the lint. */
export function flowsTree(): Region {
  return {
    split: "rows",
    children: [
      {
        split: "columns",
        children: [
          { id: "tree", weight: 1, min: 22, max: 32 },
          { id: "main", weight: 3, min: 36 },
          { id: "inspector", weight: 1, min: 30, max: 42, collapseBelow: 120 },
        ],
      },
      { id: "audit", weight: 0, min: 5, max: 10 },
    ],
  };
}

const TREES: Partial<Record<ScreenId, () => Region>> = {
  session: sessionTree,
  run: runTree,
  flows: flowsTree,
};

/** The regions this screen is, and what is in them. */
export function viewFor(state: ScreenStateBase, now?: number): View {
  const model: PaneModel = paneModel(state, now);
  const tree = (TREES[state.screen] ?? classicTree)();
  return {
    tree,
    panes: model as unknown as Readonly<Record<string, PaneContent>>,
    focusOrder: ["tree", "main", "inspector", "audit"],
  };
}

export interface RegionsProps {
  readonly view: View;
  readonly columns: number;
  readonly rows: number;
  readonly focus: string;
  readonly cursor: Readonly<Record<string, number>>;
  /** Which screen this is, so a zero state can name the key that changes it. */
  readonly screen: ScreenId;
  /** Told what left the row, so the footer can say so. */
  readonly onCollapsed?: (ids: readonly string[]) => void;
}

/**
 * Draw a solved tree.
 *
 * The boxes are solved first — that is the arithmetic, and it is tested without
 * a terminal — and then the same tree is walked to place them. Ink is told a
 * width and a height for every box and asked to grow nothing, which is what the
 * TV-T00 spike established it will do exactly.
 */
export function Regions(props: RegionsProps): React.JSX.Element {
  /* What left the row, at this width, before anything is drawn. */
  const { collapsed } = solve(props.view.tree, props.columns, props.rows);
  const showsCollapsed = collapsed.includes(props.focus);

  /*
   * A collapsed region is drawn where there is room, and the rows it takes come
   * out of the row it left — so the frame is still exactly the terminal (TV-04).
   */
  const openHeight = showsCollapsed ? Math.max(4, Math.floor(props.rows / 3)) : 0;
  const noticeRows = collapsed.length > 0 && !showsCollapsed ? 1 : 0;
  const bodyRows = Math.max(3, props.rows - openHeight - noticeRows);
  const placed = place(props.view.tree, props.columns, bodyRows);

  const drawRegion = (node: Placed, key: string): React.JSX.Element | null => {
    const { region, box } = node;
    if (isSplit(region)) {
      const children = node.children
        .map((child, at) => drawRegion(child, `${key}.${at}`))
        .filter((one): one is React.JSX.Element => one !== null);
      if (children.length === 0) return null;
      return (
        <InkBox
          key={key}
          flexDirection={region.split === "columns" ? "row" : "column"}
          width={box.width}
          height={box.height}
          flexGrow={0}
          flexShrink={0}
          overflow="hidden"
        >
          {children}
        </InkBox>
      );
    }
    const content = props.view.panes[region.id];
    if (content === undefined) return null;
    const number = props.view.focusOrder.indexOf(region.id);
    /*
     * The key is the cockpit's and the word is the registry's (TV-01). `rows.ts`
     * names an action id and nothing else, so a zero state cannot spell either.
     */
    const next = (content.nextActions ?? [])
      .map((id) => {
        const bound = keysFor(props.screen).find((one) => one.action === id);
        const action = actionById(id);
        return bound === undefined || action === undefined
          ? undefined
          : { key: bound.key, label: action.label };
      })
      .filter((one): one is { key: string; label: string } => one !== undefined);
    return (
      <Frame
        key={region.id}
        box={box}
        {...(next.length === 0 ? {} : { next })}
        {...(number >= 0 ? { number: number + 1 } : {})}
        title={content.title}
        focused={props.focus === region.id}
        content={content}
        cursor={props.cursor[region.id] ?? 0}
      />
    );
  };

  return (
    <InkBox flexDirection="column" width={props.columns} flexShrink={0}>
      {drawRegion(placed, "r")}
      {/*
        Why there are three regions and not four, in words (T10.4, P9-F4). Not in
        the status bar: at a hundred columns the sentence would push the project
        and the screen off the end, which is the defect this is about one row up.
      */}
      {noticeRows === 1 ? (
        <Text color="gray" wrap="truncate-end">
          {` ${collapsed.join(", ")} collapsed at ${props.columns} cols · press its number to open it below`}
        </Text>
      ) : null}
      {showsCollapsed ? (
        <Frame
          box={{ x: 0, y: 0, width: props.columns, height: openHeight }}
          number={props.view.focusOrder.indexOf(props.focus) + 1}
          title={props.view.panes[props.focus]?.title ?? props.focus}
          focused
          content={props.view.panes[props.focus] ?? { title: "", lines: [], empty: "" }}
          cursor={props.cursor[props.focus] ?? 0}
        />
      ) : null}
    </InkBox>
  );
}
