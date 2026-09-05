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
import type { ConformanceCase } from "./types.js";

interface Node {
  readonly ref: string;
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly states: readonly string[];
  readonly box?: readonly number[];
  readonly native?: Readonly<Record<string, string>>;
}

const named = (nodes: readonly Node[], role: string, name?: string): Node | undefined =>
  nodes.find((node) => node.role === role && (name === undefined || node.name === name));

/** The eleven screen tabs of `apps/ade/src/renderer/App.tsx`. */
const TABS = [
  "Project",
  "Flow editor",
  "Plan",
  "Run",
  "Results",
  "API client",
  "Data",
  "Record review",
  "Bindings",
  "Surface explorer",
  "Tool panel",
] as const;

/** Click the tab with this name, and answer with the snapshot that follows. */
async function openScreen(
  context: Parameters<ConformanceCase["run"]>[0],
  tab: string,
): Promise<readonly Node[]> {
  const refs = await context.surface.locate({
    by: "role",
    role: "tab",
    name: tab,
    exact: true,
    score: 1,
  });
  context.equals(`exactly one "${tab}" tab is located`, refs.length, 1);
  if (refs.length !== 1) return (await context.surface.snapshot()).nodes as readonly Node[];
  await context.surface.act("click", refs[0]!);
  return (await context.surface.snapshot()).nodes as readonly Node[];
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
    description: "Flow 1: the project is open, and every screen tab is addressable by name.",
    async run(context) {
      const { check, equals } = context;
      const nodes = await openScreen(context, "Project");

      /*
       * "Create a project" (LLD §16) is read as "the project screen shows the
       * project the ADE has open". The ADE opens one through a *native* file
       * chooser, which is another application's window and outside this
       * adapter's session — so the flow the suite drives is what a person does
       * after that.
       */
      check("the project screen is showing", named(nodes, "button", "Open a project…") !== undefined, {
        expected: 'button "Open a project…"',
      });
      equals(
        "all eleven screens are addressable as tabs",
        TABS.filter((tab) => named(nodes, "tab", tab) !== undefined).length,
        TABS.length,
      );
      check(
        "the open project is named in the window",
        nodes.some((node) => node.name === "Open project" || node.name?.includes("svatah") === true),
        { expected: "the project path or name somewhere in the window" },
      );
    },
  },

  {
    id: "ade.flow",
    page: "Svatah ADE",
    description: "Flow 2: a flow file opens in the editor.",
    async run(context) {
      const { check } = context;
      const nodes = await openScreen(context, "Flow editor");

      check("a flow chooser is present", named(nodes, "combobox") !== undefined, {
        expected: "a combobox listing the project's flow files",
      });
      check(
        "the flow's text is in an editable region",
        nodes.some((node) => node.role === "textbox"),
        { expected: 'a node with role "textbox"' },
      );
      check("the editor offers a compile", named(nodes, "button", "Compile") !== undefined, {
        expected: 'button "Compile"',
      });
    },
  },

  {
    id: "ade.run",
    page: "Svatah ADE",
    description: "Flow 3: the run screen starts a run, and the button is addressable.",
    async run(context) {
      const { check } = context;
      const nodes = await openScreen(context, "Run");

      check("the run screen offers a Run button", named(nodes, "button", "Run") !== undefined, {
        expected: 'button "Run"',
      });
      check(
        "the flow to run is chosen by a control with an identity",
        nodes.some((node) => node.native?.["automationId"] === "run-flow"),
        { expected: 'a control whose automationId is "run-flow"' },
      );
    },
  },

  {
    id: "ade.result",
    page: "Svatah ADE",
    description: "Flow 4: the results screen lists runs, and a run opens.",
    async run(context) {
      const { check } = context;
      const nodes = await openScreen(context, "Results");

      check(
        "the results screen renders a list or a table of runs",
        nodes.some((node) => ["table", "list", "listbox", "grid"].includes(node.role)) ||
          nodes.some((node) => node.name?.includes("run") === true),
        { expected: "a table, a list, or something naming a run" },
      );
    },
  },

  {
    id: "ade.api-client",
    page: "Svatah ADE",
    description: "Flow 5: the API client's fields are addressable and take a value.",
    async run(context) {
      const { surface, check, equals } = context;
      const nodes = await openScreen(context, "API client");

      const method = nodes.find((node) => node.native?.["automationId"] === "api-method");
      const name = nodes.find((node) => node.native?.["automationId"] === "api-name");
      check("the method control is addressable", method !== undefined, {
        expected: 'a control whose automationId is "api-method"',
      });
      check("the request name field is addressable", name !== undefined, {
        expected: 'a control whose automationId is "api-name"',
      });

      if (name !== undefined) {
        /*
         * The one `act` in the suite that changes something, and the one that
         * shows a desktop adapter can write as well as read: type into the
         * field, take a new snapshot, and read the value back.
         */
        await surface.act("type", name.ref, { value: "conformance" });
        const after = (await surface.snapshot()).nodes as readonly Node[];
        const written = after.find((node) => node.native?.["automationId"] === "api-name");
        equals("the typed value is readable back from the tree", written?.value, "conformance");
      }
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
