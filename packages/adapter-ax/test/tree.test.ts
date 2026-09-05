/**
 * The tree mapping, against the ADE's recorded accessibility trees (T6.2).
 *
 * Everything here is a pure function of an `AxNode[]` (`src/tree.ts`), so the
 * missing Accessibility permission costs nothing: the input is a real tree from
 * a real application, read as `test/recorded.ts` describes.
 */
import { describe, expect, it } from "vitest";
import { AX_ROLE_MAP, isInteractiveRole } from "@svatah/surface";
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
  it("maps every AXRole the ADE produces", () => {
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
    // `AXTabButton`. The role alone would call the ADE's screen tabs radios.
    expect(roleOf({ role: "AXRadioButton", subrole: "AXTabButton" })).toBe("tab");
    expect(roleOf({ role: "AXRadioButton" })).toBe("radio");
    expect(roleOf({ role: "AXTextField", subrole: "AXSearchField" })).toBe("searchbox");
    expect(roleOf({ role: "AXGroup", subrole: "AXLandmarkMain" })).toBe("main");
  });

  it("falls back rather than dropping an element", () => {
    // "An unmapped control still appears in the snapshot with its name and
    // states, so it can be grounded and acted on, rather than vanishing."
    expect(roleOf({ role: "AXSomethingNew" })).toBe("generic");
  });

  it("gives the ADE's eleven screen tabs the role `tab`", () => {
    const tabs = convert("record").filter((node) => node.role === "tab");
    expect(tabs.map((node) => node.name)).toEqual([
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
    expect(statesOf({ parent: 0, role: "AXGroup", expanded: false })).toEqual(["collapsed"]);
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

  it("gives the ADE's gateway control the id its markup has", () => {
    // `<select id="record-gateway" aria-label="Gateway">` — the id wins, because
    // an id is an identity and a label is wording (P5-F2, REQ-ADE-4).
    const gateway = convert("record").find(
      (node) => node.native?.["automationId"] === "record-gateway",
    );
    expect(gateway?.role).toBe("combobox");
    expect(gateway?.name).toBe("Gateway");
    /*
     * And the `<label>Gateway</label>` beside it has the same *name* and no
     * automationId, which is why a binding for the control has to be able to
     * say more than "the thing called Gateway".
     */
    const label = convert("record").filter((node) => node.name === "Gateway");
    expect(label.length).toBeGreaterThan(1);
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
      windowTitle: "Svatah ADE",
    });
    expect(budgeted).toHaveLength(20);
    expect(budgeted[0]!.role).toBe("window");
  });
});

describe("controlPath (LLD §3.3, §7.5)", () => {
  it("starts at the window title", () => {
    const nodes = convert("record");
    expect(nodes[0]!.controlPath).toBe("Window[Svatah ADE]");
    expect(nodes.every((node) => node.controlPath.startsWith("Window[Svatah ADE]"))).toBe(true);
  });

  it("addresses a named element by its name and an anonymous one by its index", () => {
    const raw: AxNode[] = [
      { parent: -1, role: "AXWindow", title: "Svatah ADE" },
      { parent: 0, role: "AXGroup" },
      { parent: 0, role: "AXGroup" },
      { parent: 2, role: "AXButton", title: "Start recording" },
    ];
    const children = childIndex(raw);
    expect(controlPathOf(raw, 2, children, "Svatah ADE")).toBe("Window[Svatah ADE]/AXGroup[1]");
    expect(controlPathOf(raw, 3, children, "Svatah ADE")).toBe(
      "Window[Svatah ADE]/AXGroup[1]/AXButton[Start recording]",
    );
  });

  it("identifies the ADE's Start recording button", () => {
    const button = convert("record").find((node) => node.name === "Start recording");
    expect(button?.role).toBe("button");
    expect(button?.controlPath).toContain("AXButton[Start recording]");
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
