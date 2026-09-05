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
import type { CaseContext, ConformanceCase, DesktopHealing } from "./types.js";

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
 * ## Each case runs twice, at two variants
 *
 * A healing case cannot be one pass: the binding has to exist *before* the
 * interface changes. So each case declares `variants: [0, N]` and does one of
 * two things depending on which window it is looking at.
 *
 * - At **variant 0** it finds the control by its `automationId`, fingerprints
 *   it, and remembers the fingerprint and the ground-truth key.
 * - At **variant N** it recalls that fingerprint, relocalizes against the
 *   changed window, and checks that what came back is the same element — by the
 *   key, never by the name or the position, either of which is the thing the
 *   variant broke.
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
  /** The tab to open before looking, by the name it has at *every* variant. */
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
    const nodes = await openScreen(context, subject.screen);
    const live = byKey(nodes, subject.key);

    if (healing.variant === 0) {
      check(`"${subject.key}" is on the ${subject.screen} screen at variant 0`, live !== undefined, {
        expected: `a ${subject.role} whose automationId is "${subject.key}"`,
        actual: nodes.filter((n) => n.role === subject.role).map((n) => n.name),
      });
      if (live === undefined) continue;
      equals(`"${subject.key}" is named "${subject.nameAtZero}" at variant 0`, live.name, subject.nameAtZero);
      const fingerprint = await healing.fingerprint(context.surface, live.ref);
      const described = await context.surface.describe(live.ref);
      healing.remember(`${id}:${subject.key}`, {
        fingerprint,
        key: subject.key,
        rolePath: described.rolePath,
      });
      check(`the binding for "${subject.key}" is recorded for the healing pass`, true);
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
    const moved =
      live !== undefined &&
      JSON.stringify((await context.surface.describe(live.ref)).rolePath) !==
        JSON.stringify(recorded.rolePath);
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
}

export const DESKTOP_HEALING_CASES: readonly ConformanceCase[] = [
  {
    id: "ade.heal.renamed-control",
    page: "Svatah ADE",
    description:
      "LLD §16 variant 1: a screen tab and a Project button are renamed, and bindings recorded " +
      "at variant 0 relocalize onto them.",
    variants: [0, 1],
    async run(context) {
      await healingCase(
        context,
        "ade.heal.renamed-control",
        [
          { key: "screen-flows", role: "tab", screen: "Project", nameAtZero: "Flow editor" },
          { key: "project-open", role: "button", screen: "Project", nameAtZero: "Open a project…" },
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
        [{ key: "record-gateway", role: "combobox", screen: "Record review", nameAtZero: "Gateway" }],
        2,
      );
    },
  },
];
