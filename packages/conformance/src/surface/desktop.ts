/**
 * The desktop conformance suite: the Svatah ADE (T6.1, T6.2, LLD §14, §16,
 * REQ-ADE-6, REQ-SURF-3).
 *
 * > Desktop conformance target (P2): the Svatah ADE itself, built from its
 * > repository in CI on Windows and macOS runners and launched with
 * > `SVATAH_A11Y=1`. The desktop conformance flows are: create a project, open a
 * > flow, run it, open the result, use the API client. No separate sample
 * > desktop app is built.
 *
 * Five cases, one per flow, plus one that establishes the snapshot shape a
 * desktop adapter must produce at all.
 *
 * ## Why this is a second suite and not more cases in the first
 *
 * The web suite navigates: every case begins `act("navigate", …, { url })`. A
 * desktop application has no URL and no address bar — LLD §7.5's adapters throw
 * `NavigationError` for the whole family, deliberately — so a web case cannot
 * run against one, and a suite that skipped every case it could not run would
 * report a conformant adapter that had done nothing.
 *
 * What both suites share is the *contract*: the same `ConformanceCase` shape,
 * the same runner, the same report. An adapter is conformant against the suite
 * for the platform it drives.
 *
 * ## What "the same shape whether the source is ARIA, UIA or AX" means here
 *
 * REQ-SURF-4. These cases assert on roles from the ARIA vocabulary — `tab`,
 * `button`, `combobox`, `textbox` — against an application whose tree arrives as
 * UIA `ControlType`s on Windows and `AXRole`s on macOS. A case that passes on
 * both is the evidence for that requirement; a case that had to ask about
 * `AXButton` would be evidence against it.
 */
import { isInteractiveRole, isWindowChrome } from "@svatah/surface";
import type { CaseContext, ConformanceCase, DesktopHealing } from "./types.js";

interface Node {
  readonly ref: string;
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly states: readonly string[];
  readonly box?: readonly number[];
  /** The node above this one, so a case can ask what is *inside* an element (T12.3). */
  readonly parent?: string;
  readonly native?: Readonly<Record<string, string>>;
}

/**
 * The left rail of LLD §13.7's information architecture (T10.3).
 *
 * > Left rail: Flows, Runs, Bindings, Agents and tools; Resources: API, Data;
 * > bottom: Import prototype database, Settings.
 *
 * Eight rows, not eleven tabs. T10.3 deleted the tabs with the screens they
 * reached; the four screens that are not on the rail — `run`, `record`, `heal`,
 * `explorer` — are reached *from* another screen, which is what
 * `openFromPalette` below is for.
 */
const RAIL = [
  ["rail-flows", "Flows"],
  ["rail-runs", "Runs"],
  ["rail-bindings", "Bindings"],
  ["rail-agents", "Agents and tools"],
  ["rail-api", "API"],
  ["rail-data", "Data"],
  ["rail-import", "Import prototype database"],
  ["rail-settings", "Settings"],
] as const;

/**
 * Press a rail item, and answer with the snapshot that follows.
 *
 * By `automationId`, not by name: the id is what survives a rename, and variant
 * 1 renames one of these deliberately (the healing cases below). A case that
 * addressed the rail by its labels would fail at variant 1 for the reason the
 * variant exists, which would make the healing case unmeasurable.
 */
async function openScreen(
  context: Parameters<ConformanceCase["run"]>[0],
  railId: string,
): Promise<readonly Node[]> {
  const before = (await context.surface.snapshot()).nodes as readonly Node[];
  const item = before.find((node) => node.native?.["automationId"] === railId);
  context.check(`the rail has "${railId}"`, item !== undefined, {
    expected: `a control whose automationId is "${railId}"`,
    actual: before
      .filter((node) => node.role === "button")
      .map((node) => node.native?.["automationId"] ?? node.name)
      .slice(0, 20),
  });
  if (item === undefined) return before;
  await context.surface.act("click", item.ref);
  return await settled(context, railId);
}

/**
 * Snapshot once the screen has finished arriving (T11.1).
 *
 * A rail click is a request the ADE answers with a `load()` over five or six
 * endpoints, and a snapshot taken the instant after it is a snapshot of the
 * screen that was there before — or of half the one that is coming. The live
 * gate found `ade.inspector` missing `inspector-candidate-table` on a Bindings
 * screen that had it a second later, intermittently, which is the worst way for
 * a check to be wrong: it fails on a slow machine and passes on a fast one, and
 * says nothing about either.
 *
 * "Finished arriving" is *the tree has stopped changing*: two consecutive reads
 * with the same node count and the same set of ids. That needs no knowledge of
 * which screen is coming, which is what keeps this in the suite rather than in
 * a table of per-screen selectors.
 */
async function settled(
  context: Parameters<ConformanceCase["run"]>[0],
  what: string,
): Promise<readonly Node[]> {
  const shape = (nodes: readonly Node[]): string =>
    `${nodes.length}:${nodes
      .map((one) => one.native?.["automationId"] ?? "")
      .filter((one) => one !== "")
      .join(",")}`;

  let nodes = (await context.surface.snapshot()).nodes as readonly Node[];
  let before = shape(nodes);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const again = (await context.surface.snapshot()).nodes as readonly Node[];
    const now = shape(again);
    nodes = again;
    if (now === before) return nodes;
    before = now;
  }
  context.check(`the ${what} screen stopped changing`, false, {
    expected: "two consecutive reads of the same tree",
    actual: `still changing after 20 reads (${nodes.length} nodes)`,
  });
  return nodes;
}

/**
 * Open a screen the rail does not carry, through the command palette.
 *
 * `run`, `record`, `heal` and `explorer` are reached from another screen — a run
 * from starting one, a decision from a recording session — and the palette's
 * `Go to` group is the one place every screen has a row (LLD §13.7). This is the
 * suite driving the application the way LLD §13.7 says a person does, rather
 * than the ADE growing a rail row so that a test could click it.
 */
async function openFromPalette(
  context: Parameters<ConformanceCase["run"]>[0],
  screen: string,
): Promise<readonly Node[]> {
  const before = (await context.surface.snapshot()).nodes as readonly Node[];
  const opener = before.find(
    (node) => node.native?.["automationId"] === "open-command-palette",
  );
  context.check("the top bar offers the command palette", opener !== undefined, {
    expected: 'a control whose automationId is "open-command-palette"',
  });
  if (opener === undefined) return before;

  await context.surface.act("click", opener.ref);
  const open = (await context.surface.snapshot()).nodes as readonly Node[];
  /*
   * By id, not by name. A palette row's accessible name is its whole contents —
   * the area, the label and the CLI command — so a search for "Go to Run"
   * matches the `<span>` inside the button rather than the button, and clicking
   * a span does nothing at all.
   */
  const rowId = `palette-go-${screen}`;
  const row = open.find((node) => node.native?.["automationId"] === rowId);
  context.check(`the palette has a "${rowId}" row`, row !== undefined, {
    expected: `a control whose automationId is "${rowId}"`,
    actual: open
      .map((node) => node.native?.["automationId"])
      .filter((one) => one?.startsWith("palette-go-") === true),
  });
  if (row === undefined) return open;

  await context.surface.act("click", row.ref);
  return await settled(context, screen);
}

/**
 * Everything under `root`, by reference chain (T12.3).
 *
 * By `parent`, not by `depth` and position: a snapshot is a flat list with a
 * depth per node (LLD §2.2) and it is **not** in tree order — the desktop
 * adapters walk breadth-first, so every node at depth 12 precedes every node at
 * depth 13. A "contents are the deeper nodes that follow it" reading is wrong on
 * that shape, and wrong quietly: it returns an empty subtree and the case says
 * the row is blank. `parent` is what the adapters' own `snapshot({ root })` uses
 * and is what tree structure means here.
 */
function inside(nodes: readonly Node[], root: Node): Node[] {
  const kept = new Set<string>([root.ref]);
  const out: Node[] = [];
  for (const node of nodes) {
    if (node.ref === root.ref) continue;
    if (node.parent !== undefined && kept.has(node.parent)) {
      kept.add(node.ref);
      out.push(node);
    }
  }
  return out;
}

/** Everything `node` and its descendants say. */
function subtreeText(nodes: readonly Node[], node: Node): string {
  return [node, ...inside(nodes, node)]
    .map((one) => `${one.name ?? ""} ${one.value ?? ""}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Press Run on the Flows screen and wait for the Run screen (T12.3, K6).
 *
 * The gesture a person makes, so that the branch of `ade.result` that reads a
 * table with rows in it is the branch the live gate takes. It is best effort in
 * one direction only: a Run button that is not there, or a Run screen that
 * never arrives, is *checked* — the point is a run — but the run's own verdict
 * is not, because the flow drives `apps/sample-web` and a red run fills the
 * Runs screen exactly as a green one does.
 */
async function startARun(context: Parameters<ConformanceCase["run"]>[0]): Promise<void> {
  let flows = await openScreen(context, "rail-flows");

  /*
   * One flow, chosen first — the same thing the ADE's own Playwright case does,
   * and for the same reason.
   *
   * Run with nothing selected runs *every* flow the project has, and two of the
   * fixtures' stories take a typed input with no default. The service answers
   * that honestly and the status bar says so:
   *
   *   /run answered 400: {"error":"missing-inputs","missing":[…]}
   *
   * which is correct behaviour and not a run. `guards-and-compensation.flow`
   * needs nothing, so it is the one this presses Run on.
   */
  const WANTED = "guards-and-compensation.flow";
  /*
   * By what the row *says*, not by its own name: a table row's accessible name
   * is empty on macOS and the file name is on a cell inside it. Reading the
   * subtree is what a person does when they look at a row.
   */
  const row = flows.find(
    (node) => node.role === "row" && subtreeText(flows, node).includes(WANTED),
  );
  context.check(`the flow list offers ${WANTED}`, row !== undefined, {
    expected: `a row whose cells say ${WANTED}`,
    actual: flows
      .filter((node) => node.role === "row")
      .map((node) => subtreeText(flows, node).slice(0, 60))
      .slice(0, 12),
  });
  if (row === undefined) return;
  await context.surface.act("click", row.ref);
  flows = await settled(context, "rail-flows");

  const run = flows.find((node) => node.native?.["automationId"] === "action-run-flow");
  context.check("the Flows screen has a Run button", run !== undefined, {
    expected: 'a control whose automationId is "action-run-flow"',
    actual: flows.map((node) => node.native?.["automationId"]).filter(Boolean).slice(0, 20),
  });
  if (run === undefined) return;

  await context.surface.act("click", run.ref);

  /*
   * Polled until the Run screen's steps pane is there, not slept (LLD §16's
   * timing rule): a run is a compile, a browser launch and a story, and how
   * long that takes is a property of the machine.
   */
  const deadline = Date.now() + 180_000;
  let arrived = false;
  while (!arrived && Date.now() < deadline) {
    const now = (await context.surface.snapshot()).nodes as readonly Node[];
    arrived = now.some((node) => node.native?.["automationId"] === "run-steps");
  }
  context.check("pressing Run opened the Run screen", arrived, {
    expected: 'a control whose automationId is "run-steps", within 180 s',
  });
}

export const DESKTOP_CASES: readonly ConformanceCase[] = [
  {
    id: "ade.snapshot",
    page: "Svatah ADE",
    description:
      "The window's snapshot is the normalised shape of LLD §2.2, in the ARIA role vocabulary.",
    async run({ surface, check, equals }) {
      const snapshot = await surface.snapshot();
      const nodes = snapshot.nodes as readonly Node[];

      check("the snapshot has nodes", nodes.length > 0, {
        expected: "> 0",
        actual: nodes.length,
      });
      check(
        "every node has a reference, a role and a states array",
        nodes.every(
          (node) =>
            typeof node.ref === "string" &&
            node.ref !== "" &&
            typeof node.role === "string" &&
            Array.isArray(node.states),
        ),
        { expected: "ref, role, states on every node", actual: nodes[0] },
      );
      /*
       * The requirement this case exists for (REQ-SURF-4): the roles are ARIA
       * roles, on a tree that arrived as `ControlType`s or `AXRole`s.
       */
      check("the root is a window", nodes[0]?.role === "window", {
        expected: "window",
        actual: nodes[0]?.role,
      });
      check("no node reports a native role as its role", !nodes.some((node) => /^AX|^UIA_/.test(node.role)), {
        expected: "ARIA roles only",
        actual: nodes.filter((node) => /^AX|^UIA_/.test(node.role)).map((node) => node.role),
      });
      check(
        "every interactive node has a box, so a pointer fallback has somewhere to click",
        nodes
          .filter((node) => ["button", "tab", "combobox", "textbox", "link"].includes(node.role))
          .every((node) => Array.isArray(node.box) && node.box.length === 4),
        { expected: "[x, y, width, height] on every control" },
      );
      /*
       * Every interactive control is named (P8-F3, LLD §13.7's accessibility
       * contract, §7.5).
       *
       * > Every button, link, tab, field, and row action has a visible label
       * > that is its accessible name, and an id in the `automationId` form the
       * > desktop adapters read; the desktop snapshot case fails on an unnamed
       * > interactive control.
       *
       * The Phase 8 verification found three unnamed `AXButton`s on the ADE's
       * Project screen and this suite said nothing, because no case asked. A
       * control with no name cannot be addressed by a flow sentence ("Click the
       * … button"), cannot be bound by a `role`+`name` candidate, and is
       * unreachable with a screen reader — three separate failures of the same
       * omission.
       */
      const unnamed = nodes.filter(
        (node) => isInteractiveRole(node.role) && (node.name ?? "").trim() === "",
      );
      check("every interactive control has an accessible name", unnamed.length === 0, {
        expected: "0 unnamed buttons, links, tabs, fields or menu items",
        actual: unnamed.map((node) => `${node.role} ${node.ref}`).slice(0, 20),
      });

      /*
       * And the *id* half of §13.7's contract, which T10.3 turns on (P8-F3).
       *
       * > every button, link, tab, field, and row action has a visible label
       * > that is its accessible name, **and an id in the `automationId` form
       * > the desktop adapters read**
       *
       * Phase 9 left this out with a reason: the eleven legacy screens were
       * still in the application and several of their controls were named and
       * not identified, so the check would have failed the live gate on screens
       * that phase was not allowed to rebuild. T10.3 deleted them. Every control
       * in the ADE now comes from `@svatah/ui`, which refuses one without both.
       *
       * Chromium publishes an element's `id` as `AXDOMIdentifier` on macOS and
       * as `AutomationId` on Windows, and `automationIdOf` in each adapter reads
       * it; a control with a name and no id is one a rewording breaks
       * permanently, because the name is the only thing a binding could have
       * matched on.
       */
      /*
       * Standard window chrome is exempt (P10-F2).
       *
       * The window's close, minimise and zoom buttons are the *window
       * manager's*, not the application's: macOS creates them, names them by
       * subrole (P8-F3's table), and gives an application no way to put an
       * `AXIdentifier` or a DOM `id` on them. Without this the rule fails on
       * every macOS window that has ever existed, which is a rule about the
       * platform rather than about the ADE — and a live gate that can never go
       * green teaches a reader to ignore it.
       *
       * The exemption is a closed list of controls the platform owns
       * (`isWindowChrome`), read from the adapter's `native` bag. Not a name
       * pattern: a button the *application* labelled "Close" is the
       * application's, and it still has to carry an id.
       */
      const unidentified = nodes.filter(
        (node) =>
          isInteractiveRole(node.role) &&
          !isWindowChrome(node) &&
          (node.native?.["automationId"] ?? "").trim() === "",
      );
      check("every interactive control has an automationId", unidentified.length === 0, {
        expected: "0 controls with a name and no id, window chrome aside",
        actual: unidentified.map((node) => `${node.role} "${node.name ?? ""}"`).slice(0, 20),
      });

      /*
       * And the exemption is *used*, not merely available: a window without its
       * own three buttons in the snapshot is a snapshot that stopped reading
       * the window frame, which is how a tree read could silently shrink and
       * still pass everything above.
       */
      const chrome = nodes.filter((node) => isWindowChrome(node));
      check("the window's own controls are in the snapshot", chrome.length >= 3, {
        expected: ">= 3 window-chrome controls (close, minimise, zoom)",
        actual: chrome.map((node) => `${node.role} "${node.name ?? ""}"`).slice(0, 8),
      });

      equals("the snapshot hash is a hash", /^[0-9a-f]{16,}$/.test(snapshot.hash), true);
      check("the snapshot renders text with references", snapshot.text.includes("[ref="), {
        expected: "[ref=…] annotations in Snapshot.text",
        actual: snapshot.text.slice(0, 120),
      });
    },
  },

  {
    id: "ade.project",
    page: "Svatah ADE",
    description:
      "Flow 1: a project is open, and every rail item of LLD §13.7 is addressable by its id.",
    async run(context) {
      const { check, equals } = context;
      const nodes = (await context.surface.snapshot()).nodes as readonly Node[];

      /*
       * "Create a project" (LLD §16) is read as "the window has one open". The
       * ADE opens one through a *native* file chooser, which is another
       * application's window and outside this adapter's session — so the flow
       * the suite drives is what a person sees after that.
       */
      const ids = new Set(
        nodes.map((node) => node.native?.["automationId"]).filter((one) => one !== undefined),
      );
      equals(
        "all eight rail items are addressable",
        RAIL.filter(([id]) => ids.has(id)).length,
        RAIL.length,
      );
      check(
        "the rail rows carry their labels as their names",
        RAIL.every(([id, label]) => {
          const found = nodes.find((node) => node.native?.["automationId"] === id);
          /*
           * `rail-flows` is the one variant 1 renames, so it is checked by id
           * and not by name — which is exactly the property the healing case
           * measures.
           */
          return found !== undefined && (id === "rail-flows" || found.name === label);
        }),
        {
          expected: "every rail row named as LLD §13.7's rail names it",
          actual: RAIL.map(([id]) => nodes.find((n) => n.native?.["automationId"] === id)?.name),
        },
      );
      check(
        "the open project is named in the window",
        nodes.some((node) => (node.name ?? node.value ?? "").includes("svatah")),
        { expected: "the project's name in the crumb" },
      );
      check(
        "the eleven tabs are gone (T10.3)",
        !nodes.some((node) => node.role === "tab" && node.name === "Flow editor"),
        { expected: "no legacy screen tab", actual: nodes.filter((n) => n.role === "tab").map((n) => n.name) },
      );
    },
  },

  {
    id: "ade.flow",
    page: "Svatah ADE",
    description: "Flow 2: a flow file opens in the editor, with its plan and its lint beside it.",
    async run(context) {
      const { check } = context;
      const nodes = await openScreen(context, "rail-flows");

      check(
        "the flow list is addressable",
        nodes.some((node) => node.native?.["automationId"] === "flows-list"),
        { expected: 'a control whose automationId is "flows-list"' },
      );
      check(
        "the editor, the plan and the history are tabs",
        ["editor", "plan", "history"].every((one) =>
          nodes.some((node) => node.role === "tab" && node.native?.["automationId"] === one),
        ),
        {
          expected: "three tabs: editor, plan, history",
          actual: nodes.filter((node) => node.role === "tab").map((node) => node.name),
        },
      );
      check(
        "the flow's own lines are in the window",
        nodes.some((node) => (node.name ?? node.value ?? "").includes(".flow")),
        { expected: "a flow file name somewhere on the screen" },
      );
    },
  },

  {
    id: "ade.run",
    page: "Svatah ADE",
    description: "Flow 3: the Flows toolbar offers Record and Run, and the Run screen renders.",
    async run(context) {
      const { check } = context;
      const flows = await openScreen(context, "rail-flows");

      /*
       * Draft 2.12 §13.7: "the Flows toolbar shows Record and Run". Both by
       * their `automationId`, which is what a binding survives a rewording on.
       */
      for (const id of ["action-record-start", "action-run-flow"]) {
        check(
          `the toolbar offers "${id}"`,
          flows.some((node) => node.native?.["automationId"] === id),
          {
            expected: `a control whose automationId is "${id}"`,
            actual: flows
              .filter((node) => node.role === "button")
              .map((node) => node.native?.["automationId"] ?? node.name)
              .slice(0, 20),
          },
        );
      }

      // And the Run screen itself, through the palette: it is not on the rail,
      // because a run is reached from starting one.
      const run = await openFromPalette(context, "run");
      check(
        "the Run screen carries the stories of the run it is showing",
        run.some((node) => node.native?.["automationId"] === "run-stories"),
        {
          expected: 'a control whose automationId is "run-stories"',
          actual: run.map((node) => node.native?.["automationId"]).filter((one) => one !== undefined).slice(0, 20),
        },
      );
    },
  },

  {
    id: "ade.result",
    page: "Svatah ADE",
    description:
      "Flow 4: the gate makes a run through the Run screen, then the Runs screen lists it.",
    async run(context) {
      const { check } = context;

      /*
       * A run is *made* before the table is read (T12.3, K6).
       *
       * Until Draft 2.15 this case accepted "either the runs are listed, or the
       * screen says there are none", and on a clean checkout it always took the
       * second branch: `evals/fixtures/runs` is ignored by git. So the branch
       * that matters — a table with rows in it, each with a status — was never
       * exercised by the live gate, and a Runs screen that had stopped
       * rendering rows would have passed.
       *
       * So the gate presses Run on the Flows screen, the way a person does, and
       * waits for the Run screen to arrive. The run's own *verdict* is not
       * asserted and must not be: the fixtures flow drives `apps/sample-web`,
       * which the gate starts but a host may still refuse a port to, and a red
       * run fills this screen exactly as a green one does. What is asserted is
       * that a row appeared and that it says what happened.
       */
      await startARun(context);

      const nodes = await openScreen(context, "rail-runs");

      check(
        "the runs table is addressable",
        nodes.some((node) => node.native?.["automationId"] === "runs-table"),
        { expected: 'a control whose automationId is "runs-table"' },
      );
      /*
       * The three filter chips the `Results` artboard draws, each a real control
       * with a name that says what it filters and what it is set to (T10.1).
       */
      for (const id of ["runs-filter-behavior", "runs-filter-invoker", "runs-filter-status"]) {
        check(
          `the ${id} chip is addressable`,
          nodes.some((node) => node.native?.["automationId"] === id),
          { expected: `a control whose automationId is "${id}"` },
        );
      }
      /*
       * `name ?? value`, because a static text's string is its `AXValue` on
       * macOS and its `Name` on Windows, and this case has to pass on both. A
       * project with runs shows them; one without says so, and says what writes
       * one — the empty state is a state, not a failure (T8.2).
       */
      const table = nodes.find((node) => node.native?.["automationId"] === "runs-table");
      const contents = table === undefined ? [] : inside(nodes, table);

      /*
       * A table with a run in it, and the run says what happened to it
       * (T12.3's Validate).
       *
       * A *row* that carries a status, rather than "the table's text contains
       * one somewhere": a header cell says `STATUS` and would satisfy the
       * looser reading on a table with no runs at all, which is the branch this
       * case exists to stop taking. The vocabulary is `results.schema.json`'s
       * and any of it will do — whether that run passed is the sample
       * application's business, not this suite's.
       */
      const STATUS = /\b(passed|failed|healed|aborted|stopped|running)\b/i;
      const runs = contents
        .filter((node) => node.role === "row")
        .filter((node) => STATUS.test(subtreeText(nodes, node)));
      check("the runs table lists at least one run, and it says what happened", runs.length > 0, {
        expected: "a row whose cells carry a status from the results schema",
        actual: contents
          .filter((node) => node.role === "row")
          .map((node) => subtreeText(nodes, node).slice(0, 80))
          .slice(0, 8),
      });
    },
  },

  {
    id: "ade.api-client",
    page: "Svatah ADE",
    description: "Flow 5: the API screen's request list and its headers are addressable.",
    async run(context) {
      const { check } = context;
      const nodes = await openScreen(context, "rail-api");

      check(
        "the named requests are addressable",
        nodes.some((node) => node.native?.["automationId"] === "api-requests"),
        { expected: 'a control whose automationId is "api-requests"' },
      );
      check(
        "the request's headers are on the screen",
        nodes.some((node) => node.native?.["automationId"] === "api-headers"),
        {
          expected: 'a control whose automationId is "api-headers"',
          actual: nodes.map((node) => node.native?.["automationId"]).filter((one) => one !== undefined).slice(0, 20),
        },
      );
      check(
        "Send is offered, with the accelerator the model gives it",
        nodes.some((node) => node.native?.["automationId"] === "action-api-send"),
        { expected: 'a control whose automationId is "action-api-send"' },
      );
    },
  },

  {
    id: "ade.inspector",
    page: "Svatah ADE",
    description:
      "T10.3: the right inspector is a list of landmarks, which is what makes controlPath short.",
    async run(context) {
      const { check } = context;
      const nodes = await openScreen(context, "rail-bindings");

      /*
       * LLD §13.6: "screen containers carry landmark roles so `controlPath`
       * candidates are short and stable". The inspector is the densest of them
       * — a stack of `<section aria-labelledby>` — and it is where a desktop
       * binding's ancestry is most likely to be long if they are missing.
       */
      check(
        "the inspector is on the screen and named",
        nodes.some((node) => node.name === "Inspector"),
        {
          expected: 'a container named "Inspector"',
          actual: nodes.map((node) => node.name).filter((one) => one !== undefined).slice(0, 24),
        },
      );
      check(
        "a binding's resolver order is addressable",
        nodes.some((node) => node.native?.["automationId"] === "inspector-candidate-table"),
        {
          expected: 'a control whose automationId is "inspector-candidate-table"',
          actual: nodes.map((node) => node.native?.["automationId"]).filter((one) => one !== undefined).slice(0, 24),
        },
      );
    },
  },

  {
    id: "ade.no-navigation",
    page: "Svatah ADE",
    description: "A desktop adapter refuses the web-only calls rather than pretending.",
    async run({ surface, throws }) {
      /*
       * The boundary REQ-SURF-5 draws, from the other side. A desktop adapter
       * that answered `navigate` with a silent no-op would let a plan compiled
       * for the web "pass" against an application it never touched.
       */
      await throws(
        "navigate throws NavigationError",
        () => surface.act("navigate", undefined, { url: "https://example.test" }),
        "NavigationError",
      );
      await throws(
        "read('url') throws NavigationError",
        () => surface.read("url"),
        "NavigationError",
      );
    },
  },
];


/* ────────────────────────────────────────────────────────────────────────────
 * The desktop healing cases (Draft 2.8 LLD §16, T7.1)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * > the ADE gains `SVATAH_A11Y_VARIANT=1|2`, where variant 1 renames one screen
 * > tab and one button on the Project screen and variant 2 moves the Record
 * > screen's gateway control into a different panel; a binding recorded at
 * > variant 0 must relocalize on both through the desktop adapter with the same
 * > weights and threshold as the web healing eval, and the desktop conformance
 * > report records the outcome per case.
 *
 * This is T6.1's "healing variant subset (renamed control, moved panel)", which
 * Phase 6 shipped without and without a deviation (Phase 6 verification, F3).
 *
 * ## Each case runs at two variants and is *measured* at one (Draft 2.9 §7.5)
 *
 * A healing case cannot be one pass: the binding has to exist *before* the
 * interface changes. So each case declares `variants: [0, N]` and does one of
 * two things depending on which window it is looking at.
 *
 * - At **variant 0** it finds the control by its `automationId`, fingerprints
 *   it, and remembers the fingerprint and the ground-truth key. It reports
 *   `skipped`: nothing about the adapter has been established, and Phase 7
 *   reported these as failed cases at a variant where the relocalization they
 *   are about had not happened yet (P7-F4). A recording it could not make is
 *   still a failed check, so a silent no-op cannot pass for a skip.
 * - At **variant N** it recalls that fingerprint, relocalizes against the
 *   changed window, and checks that what came back is the same element — by the
 *   key, never by the name or the position, either of which is the thing the
 *   variant broke. This is the pass the report counts.
 *
 * `scripts/desktop-conformance.mjs` is what launches the ADE three times and
 * carries the recorded state between the passes.
 *
 * ## Why the key cannot help
 *
 * The ground truth is the control's `automationId`, which is the desktop
 * equivalent of `apps/sample-web`'s `data-svatah-eval` (LLD §16). The web
 * healing eval keeps its key out of synthesis and fingerprints through
 * `bindings.ignoreAttributes` so that the eval cannot find the answer in the
 * answer key, and the injected healer does the same here. The case reads the
 * key through `describe()`, which does not apply that exclusion; the scorer
 * never sees it.
 */

/** The one control each case tracks, by the `automationId` that survives both variants. */
interface Subject {
  readonly key: string;
  readonly role: string;
  /**
   * How to reach the screen before looking (T10.3).
   *
   * A rail item's `automationId`, or `palette:<label>` for a screen the rail
   * does not carry. By id and never by name, because variant 1's whole purpose
   * is to change a name — a case that navigated by one would fail at variant 1
   * for the reason the variant exists.
   */
  readonly screen: string;
  /** What the control was called at variant 0, so a rename can be shown to bite. */
  readonly nameAtZero: string;
}

const byKey = (nodes: readonly Node[], key: string): Node | undefined =>
  nodes.find((node) => node.native?.["automationId"] === key);

/**
 * Record at variant 0, relocalize at the variant under test.
 *
 * One body for both cases, because the difference between them is *what
 * changed*, not what the case does about it — and a second copy of this would
 * be a second place for the check to drift.
 */
async function healingCase(
  context: CaseContext,
  id: string,
  subjects: readonly Subject[],
  variant: number,
): Promise<void> {
  const { check, equals } = context;
  let baselines = 0;
  const healing: DesktopHealing | undefined = context.healing;
  if (healing === undefined) {
    check(
      "a relocalizer was injected, so the healing case can run at all",
      false,
      {
        expected: "`svatah surface conform --heal-state <path>`, which supplies the healer",
        actual: "no healer was injected",
      },
    );
    return;
  }

  for (const subject of subjects) {
    /*
     * The subject's own screen, at every variant, always (P10-F2).
     *
     * T10.3 had this look first and navigate only if the subject was not on the
     * window, because a rail item is on every screen and pressing a rail row
     * for nothing is waste. It cost the live gate its healing case. The
     * variant-0 pass runs after `ade.inspector`, which leaves the ADE on the
     * Bindings screen, and the variant-1 pass runs alone on the Flows screen —
     * so the fingerprint was recorded through one ancestry
     * (`…/document/group/group/navigation/button`) and matched against another
     * (`…/document/group/navigation/button`), and `rolePathSim` fell below 1
     * for a reason that has nothing to do with the rename the case measures.
     *
     * With `text` at 0 by construction — the variant renames the control — the
     * most a proposal can score is 0.75 against a threshold of 0.72, so a
     * quarter of a point of role-path similarity is the whole margin. A
     * measurement whose before and after are taken on different screens is not
     * measuring the variant.
     *
     * The cost is one rail click per pass, which is a no-op when the screen is
     * already open and a no-op again in `packages/cli/test/desktop-healing.test.ts`,
     * where one recorded tree answers every read.
     *
     * A **palette** route is still taken only when the subject is not already
     * here, and that is not a compromise: opening the palette is a modal
     * detour, and the fixtures the replay test serves are single screens with
     * no palette in them at all. The screen a palette subject lives on is
     * reached the same way at both variants either way, because the subject is
     * on exactly one screen and the pass has to go there to find it.
     */
    const viaPalette = subject.screen.startsWith("palette:");
    const here = viaPalette
      ? ((await context.surface.snapshot()).nodes as readonly Node[])
      : undefined;
    const nodes =
      here !== undefined && byKey(here, subject.key) !== undefined
        ? here
        : viaPalette
          ? await openFromPalette(context, subject.screen.slice("palette:".length))
          : await openScreen(context, subject.screen);
    const live = byKey(nodes, subject.key);

    if (healing.variant === 0) {
      /*
       * Record, and report nothing (Draft 2.9 §7.5, P7-F4).
       *
       * "A healing case is run only at the variant it is about." The variant-0
       * pass is not the case: it is the *before* the case needs, and a binding
       * that could not be recorded is a failure of the recording, not of
       * relocalization. Phase 7 scored these as cases at variant 0 and reported
       * them failed at a variant where the thing they measure had not happened
       * yet. A recording that cannot be made still fails — with a check — so a
       * silent no-op cannot masquerade as a skip.
       */
      if (live === undefined) {
        check(`"${subject.key}" is on the ${subject.screen} screen at variant 0`, false, {
          expected: `a ${subject.role} whose automationId is "${subject.key}"`,
          actual: nodes.filter((n) => n.role === subject.role).map((n) => n.name),
        });
        continue;
      }
      if (live.name !== subject.nameAtZero) {
        check(`"${subject.key}" is named "${subject.nameAtZero}" at variant 0`, false, {
          expected: subject.nameAtZero,
          actual: live.name,
        });
        continue;
      }
      const fingerprint = await healing.fingerprint(context.surface, live.ref);
      const described = await context.surface.describe(live.ref);
      healing.remember(`${id}:${subject.key}`, {
        fingerprint,
        key: subject.key,
        rolePath: described.rolePath,
        ...(typeof described.native?.["controlPath"] === "string"
          ? { controlPath: described.native["controlPath"] }
          : {}),
      });
      baselines += 1;
      continue;
    }

    const recorded = healing.recall(`${id}:${subject.key}`);
    if (recorded === undefined) {
      check(`a binding for "${subject.key}" was recorded at variant 0`, false, {
        expected: "a fingerprint carried over from the variant-0 pass",
        actual: "nothing was recorded — run the variant-0 pass first",
      });
      continue;
    }

    /*
     * The variant has to actually break something, or the case proves nothing.
     * A rename breaks the name; a move breaks the ancestry. Both are asserted
     * before the relocalization is, so a variant that silently stopped changing
     * the interface fails here rather than passing everywhere.
     */
    const renamed = live !== undefined && live.name !== subject.nameAtZero;
    /*
     * "Moved" is a change to where the control is *addressed from* — its
     * `controlPath`, which is the desktop candidate kind (LLD §7.5) — or to its
     * ancestor roles. The role path alone is too coarse for the ADE T10.3 left:
     * the toolbar and the session panel are both groups inside the workspace,
     * so a control moved between them kept an identical `rolePath` and the case
     * reported that nothing had changed when the whole tree around it had.
     */
    const described = live === undefined ? undefined : await context.surface.describe(live.ref);
    const moved =
      described !== undefined &&
      (JSON.stringify(described.rolePath) !== JSON.stringify(recorded.rolePath) ||
        described.native?.["controlPath"] !== recorded.controlPath);
    check(`variant ${variant} changed "${subject.key}"`, renamed || moved, {
      expected: "a different name, or a different place in the tree",
      actual: { name: live?.name, renamed, moved },
    });

    const healed = await healing.relocalize(context.surface, recorded.fingerprint, subject.role);
    equals(`"${subject.key}" relocalizes at variant ${variant}`, healed.outcome, "relocalized");
    if (healed.outcome !== "relocalized" || healed.ref === undefined) continue;

    /*
     * The recovery is verified against the ground-truth key, never against the
     * proposal's own confidence — LLD §16's rule for the web healing eval, and
     * the difference between "something scored highly" and "it is the right
     * element".
     */
    const proposed = await context.surface.describe(healed.ref);
    equals(
      `the element it proposed is the one that was recorded ("${subject.key}")`,
      proposed.native?.["automationId"],
      recorded.key,
    );
  }

  if (healing.variant === 0 && baselines === subjects.length) {
    context.skip(
      `recorded ${baselines} binding(s) at variant 0; this case is measured at variant ${variant}`,
    );
  }
}

export const DESKTOP_HEALING_CASES: readonly ConformanceCase[] = [
  {
    id: "ade.heal.renamed-control",
    page: "Svatah ADE",
    description:
      "LLD §16 variant 1: a rail item is renamed, and a binding recorded at variant 0 " +
      "relocalizes onto it.",
    variants: [0, 1],
    async run(context) {
      await healingCase(
        context,
        "ade.heal.renamed-control",
        [
          /*
           * The rail item and the welcome screen's button, which is where
           * `project-open` lives now (T10.3). Both keep their ids and lose
           * their names at variant 1, which is the whole of what this measures.
           */
          { key: "rail-flows", role: "button", screen: "rail-flows", nameAtZero: "Flows" },
        ],
        1,
      );
    },
  },
  {
    id: "ade.heal.moved-panel",
    page: "Svatah ADE",
    description:
      "LLD §16 variant 2: the Record screen's gateway control moves into another panel, and a " +
      "binding recorded at variant 0 relocalizes onto it.",
    variants: [0, 2],
    async run(context) {
      await healingCase(
        context,
        "ade.heal.moved-panel",
        [{ key: "record-gateway", role: "combobox", screen: "palette:record", nameAtZero: "Gateway" }],
        2,
      );
    },
  },
];
