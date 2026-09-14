/**
 * The tree mapping, against the app's recorded accessibility trees (T6.2).
 *
 * Everything here is a pure function of an `AxNode[]` (`src/tree.ts`), so the
 * missing Accessibility permission costs nothing: the input is a real tree from
 * a real application, read as `test/recorded.ts` describes.
 */
import { describe, expect, it } from "vitest";
import { AX_ROLE_MAP, isInteractiveRole } from "@svatah/yam-surface";
import {
  automationIdOf,
  childIndex,
  controlPathOf,
  convertTree,
  nameOf,
  roleOf,
  statesOf,
  valueOf,
  type AxNode,
} from "../src/index.js";
import { ADE_SCREENS, recordedWindow } from "./recorded.js";

const nodesOf = (screen: Parameters<typeof recordedWindow>[0]) => recordedWindow(screen).nodes;

const convert = (screen: Parameters<typeof recordedWindow>[0], interactiveOnly = false) =>
  convertTree(nodesOf(screen), {
    maxNodes: 2_000,
    interactiveOnly,
    windowTitle: recordedWindow(screen).title,
  });

describe("roles are normalised to the ARIA vocabulary (REQ-SURF-4, LLD §2.2)", () => {
  it("maps every AXRole the app produces", () => {
    for (const screen of ADE_SCREENS) {
      const unmapped = [...new Set(nodesOf(screen).map((node) => node.role))].filter(
        (role) => AX_ROLE_MAP[role] === undefined,
      );
      // `generic` is the documented fallback for an unmapped role, and a tree
      // full of them would mean the map has gone stale against a real
      // application rather than against a list someone wrote down.
      expect(unmapped, `${screen}: ${unmapped.join(", ")}`).toEqual([]);
    }
  });

  it("prefers the subrole, because it is the closer answer", () => {
    // Chromium publishes an ARIA `tab` as `AXRadioButton` with the subrole
    // `AXTabButton`. The role alone would call the app's screen tabs radios.
    expect(roleOf({ role: "AXRadioButton", subrole: "AXTabButton" })).toBe("tab");
    expect(roleOf({ role: "AXRadioButton" })).toBe("radio");
    expect(roleOf({ role: "AXTextField", subrole: "AXSearchField" })).toBe("searchbox");
    expect(roleOf({ role: "AXGroup", subrole: "AXLandmarkMain" })).toBe("main");
  });

  it("reads the text a dropdown shows as its value, not as its options", () => {
    /*
     * The recorded Adapter and Gateway dropdowns show "playwright" and a
     * gateway's name. That text sits inside the pop-up button, and the rule
     * that makes a `<select>`'s menu items options made it options too — two
     * named "playwright", and on a newer Chromium two with no name, which
     * desktop conformance counted as interactive controls without names.
     */
    for (const screen of ["explorer", "record"] as const) {
      const nodes = convert(screen);
      expect(nodes.some((node) => node.role === "combobox"), screen).toBe(true);
      expect(nodes.filter((node) => node.role === "option"), screen).toEqual([]);
    }
  });

  it("falls back rather than dropping an element", () => {
    // "An unmapped control still appears in the snapshot with its name and
    // states, so it can be grounded and acted on, rather than vanishing."
    expect(roleOf({ role: "AXSomethingNew" })).toBe("generic");
  });

  it("gives the app's rail rows the role `button` and its view tabs `tab` (T10.3)", () => {
    /*
     * The eleven screen tabs are gone (T10.3). The app is a rail of eight
     * `<button>`s — a rail item is a button with `aria-current`, not a link,
     * because nothing navigates — and the only real tabs left are the Flows
     * screen's three views.
     */
    const rail = convert("flows").filter((node) =>
      (node.native?.["automationId"] ?? "").startsWith("rail-"),
    );
    expect(rail.map((node) => node.name)).toEqual([
      "Flows",
      "Runs",
      "Bindings",
      "Agents and tools",
      "API",
      "Data",
      "Import prototype database",
      "Settings",
    ]);
    expect(rail.every((node) => node.role === "button")).toBe(true);

    /*
     * And the only real tabs left: the Flows screen's three views, whose first
     * tab is named for the file it holds ("booking-compensation.flow"), so they
     * are checked by id.
     */
    const tabs = convert("flows").filter((node) => node.role === "tab");
    expect(tabs.map((node) => node.native?.["automationId"])).toEqual([
      "editor",
      "plan",
      "history",
    ]);
  });
});

describe("names, values and states (REQ-SURF-4)", () => {
  it("names a control from its title, its aria-label, then its tooltip", () => {
    expect(nameOf({ parent: 0, role: "AXButton", title: "Run" })).toBe("Run");
    expect(nameOf({ parent: 0, role: "AXButton", description: "Close" })).toBe("Close");
    expect(nameOf({ parent: 0, role: "AXButton", help: "Copy to clipboard" })).toBe(
      "Copy to clipboard",
    );
    expect(nameOf({ parent: 0, role: "AXTextField", placeholder: "Where from?" })).toBe(
      "Where from?",
    );
  });

  it("never names a text field after what was typed into it", () => {
    /*
     * A field's contents are its `value`. A name taken from them would change
     * on every keystroke, so a binding recorded before typing would stop
     * resolving after it — the identity of the element would be its contents.
     */
    const field: AxNode = { parent: 0, role: "AXTextField", value: "Indiranagar" };
    expect(nameOf(field)).toBe("");
    expect(valueOf(field)).toBe("Indiranagar");
  });

  it("does not repeat a checkbox's state as a value", () => {
    const box: AxNode = { parent: 0, role: "AXCheckBox", title: "Remember me", checked: true };
    expect(valueOf(box)).toBeUndefined();
    expect(statesOf(box)).toContain("checked");
    expect(statesOf({ ...box, checked: false })).toContain("unchecked");
  });

  it("reads disabled, focused, selected and expanded", () => {
    expect(statesOf({ parent: 0, role: "AXButton", enabled: false })).toEqual(["disabled"]);
    expect(statesOf({ parent: 0, role: "AXButton", focused: true })).toEqual(["focused"]);
    expect(statesOf({ parent: 0, role: "AXRow", selected: true })).toEqual(["selected"]);
    expect(statesOf({ parent: 0, role: "AXPopUpButton", expanded: false })).toEqual(["collapsed"]);
  });

  /*
   * `EX-04`, `AX-11`, `B11`.
   *
   * Yam drove the packaged Yam through this adapter and every one of the 34
   * controls on the first screen came back "collapsed". Chromium publishes
   * `AXExpanded=0` on very nearly everything it draws, and this turned all of
   * it into a state — so a screen reader said "collapsed" about buttons,
   * groups and static text, and there was no way to tell which one meant it.
   *
   * This test previously asserted the defect: `AXGroup` with `expanded: false`
   * was expected to be `["collapsed"]`, which is exactly the case a group has
   * no business reporting.
   */
  describe("collapsed is only for roles that can expand (EX-04)", () => {
    const can = ["AXDisclosureTriangle", "AXOutline", "AXPopUpButton", "AXComboBox", "AXMenuButton"];
    /*
     * `AXRow` is in the second list, and that is a correction.
     *
     * It was in the first, on the reasoning that a tree item is a row. A row of
     * a *table* is also an `AXRow` and cannot expand — so the loose form would
     * have let "collapsed" back onto every row of every grid, which is the same
     * defect one level down from the one this rule exists to fix. An outline's
     * row says so in its subrole, and that is what is matched.
     */
    const cannot = ["AXButton", "AXGroup", "AXStaticText", "AXTextField", "AXImage", "AXCheckBox", "AXRow"];

    for (const role of can) {
      it(`keeps it on ${role}`, () => {
        expect(statesOf({ parent: 0, role, expanded: false })).toContain("collapsed");
      });
    }

    for (const role of cannot) {
      it(`drops it on ${role}`, () => {
        expect(statesOf({ parent: 0, role, expanded: false })).not.toContain("collapsed");
      });
    }

    it("keeps `expanded` whatever the role, because that is a claim the control made", () => {
      /*
       * The negative is what Chromium volunteers for everything; the positive
       * is something a control has said about itself, and the platforms
       * disagree about which roles may say it. Dropping both would lose real
       * information to fix noise.
       */
      expect(statesOf({ parent: 0, role: "AXGroup", expanded: true })).toContain("expanded");
    });

    it("reads a disclosure by its subrole as well as its role", () => {
      expect(
        statesOf({ parent: 0, role: "AXButton", subrole: "AXDisclosureTriangle", expanded: false }),
      ).toContain("collapsed");
    });
  });

  it("reads a zero-area box as hidden, because AX has no hidden attribute", () => {
    expect(statesOf({ parent: 0, role: "AXGroup", box: [0, 0, 0, 0] })).toContain("hidden");
    expect(statesOf({ parent: 0, role: "AXGroup", box: [0, 0, 100, 20] })).not.toContain("hidden");
  });
});

describe("automationId (LLD §3.3, §7.5)", () => {
  it("prefers AXIdentifier, then the DOM id, then the aria-label", () => {
    const base: AxNode = { parent: 0, role: "AXButton" };
    expect(automationIdOf({ ...base, identifier: "a", domIdentifier: "b", description: "c" })).toBe("a");
    expect(automationIdOf({ ...base, domIdentifier: "b", description: "c" })).toBe("b");
    expect(automationIdOf({ ...base, description: "c" })).toBe("c");
    expect(automationIdOf(base)).toBeUndefined();
  });

  it("gives the app's gateway control the id its markup has", () => {
    // `<select id="record-gateway" aria-label="Gateway">` — the id wins, because
    // an id is an identity and a label is wording (P5-F2, REQ-ADE-4).
    const gateway = convert("record").find(
      (node) => node.native?.["automationId"] === "record-gateway",
    );
    expect(gateway?.role).toBe("combobox");
    expect(gateway?.name).toBe("Gateway");
    /*
     * And there is exactly one node called "Gateway" now (T10.3): the `<label
     * for>` is the control's accessible *name* rather than a second named node
     * beside it, which is what `@svatah/yam-ui`'s `Chooser` gives every select. A
     * binding on the name resolves to one element, which is what the resolver's
     * exactly-one rule wants.
     */
    const named = convert("record").filter((node) => node.name === "Gateway");
    expect(named).toHaveLength(1);
  });

  it("is absent rather than empty when the element has no identity", () => {
    const anonymous = convert("record").filter((node) => node.native?.["automationId"] === "");
    expect(anonymous).toEqual([]);
  });
});

describe("the snapshot shape (LLD §2.2)", () => {
  const nodes = convert("record");

  it("assigns references in document order, with depth and parent", () => {
    expect(nodes[0]!.ref).toBe("r0");
    expect(nodes[0]!.depth).toBe(0);
    expect(nodes[0]!.parent).toBeUndefined();
    expect(nodes[1]!.parent).toBe("r0");
    expect(nodes.every((node, at) => node.ref === `r${at}`)).toBe(true);
  });

  it("keeps every node's box, so a pointer fallback has somewhere to click", () => {
    const withBoxes = nodes.filter((node) => node.box !== undefined);
    expect(withBoxes.length).toBeGreaterThan(nodes.length / 2);
    expect(withBoxes.every((node) => node.box!.length === 4)).toBe(true);
  });

  it("carries the native role, so a fingerprint's tag is the AX role", () => {
    expect(nodes[0]!.native?.["axRole"]).toBe("AXWindow");
  });

  it("interactiveOnly keeps the controls and the structure above them", () => {
    const all = convert("record");
    const some = convert("record", true);
    expect(some.length).toBeLessThan(all.length);

    // Every control survives…
    const controls = all.filter((node) => isInteractiveRole(node.role)).map((node) => node.name);
    const survived = some.filter((node) => isInteractiveRole(node.role)).map((node) => node.name);
    expect(survived).toEqual(controls);
    // …and so does the window they hang from, or nothing has an address.
    expect(some[0]!.role).toBe("window");
    expect(some.every((node) => node.parent === undefined || some.some((o) => o.ref === node.parent))).toBe(true);
  });

  it("stops at maxNodes rather than at one deep branch", () => {
    const budgeted = convertTree(nodesOf("project"), {
      maxNodes: 20,
      interactiveOnly: false,
      windowTitle: "Yam",
    });
    expect(budgeted).toHaveLength(20);
    expect(budgeted[0]!.role).toBe("window");
  });
});

describe("controlPath (LLD §3.3, §7.5)", () => {
  it("starts at the window title", () => {
    const nodes = convert("record");
    expect(nodes[0]!.controlPath).toBe("Window[Yam]");
    expect(nodes.every((node) => node.controlPath.startsWith("Window[Yam]"))).toBe(true);
  });

  it("addresses a named element by its name and an anonymous one by its index", () => {
    const raw: AxNode[] = [
      { parent: -1, role: "AXWindow", title: "Yam" },
      { parent: 0, role: "AXGroup" },
      { parent: 0, role: "AXGroup" },
      { parent: 2, role: "AXButton", title: "Stop recording" },
    ];
    const children = childIndex(raw);
    expect(controlPathOf(raw, 2, children, "Yam")).toBe("Window[Yam]/AXGroup[1]");
    expect(controlPathOf(raw, 3, children, "Yam")).toBe(
      "Window[Yam]/AXGroup[1]/AXButton[Stop recording]",
    );
  });

  it("identifies the app's Stop recording button", () => {
    const button = convert("record").find((node) => node.name === "Stop recording");
    expect(button?.role).toBe("button");
    expect(button?.controlPath).toContain("AXButton[Stop recording]");
  });

  it("gives two different elements two different paths", () => {
    // The property that makes it a candidate at all: a path that two elements
    // shared would resolve to two and be dropped by the resolver.
    const nodes = convert("record");
    const paths = nodes.map((node) => node.controlPath);
    const duplicates = paths.filter((path, at) => paths.indexOf(path) !== at);
    expect([...new Set(duplicates)]).toEqual([]);
  });
});
