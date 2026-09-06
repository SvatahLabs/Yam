/**
 * The tree mapping and candidates, against the ADE's recorded UIA trees (T6.1).
 *
 * Everything here is a pure function of a `UiaNode[]`, so being on macOS costs
 * nothing: the input is a real tree from a real application, read as
 * `test/recorded.ts` describes.
 */
import { describe, expect, it } from "vitest";
import { isInteractiveRole, UIA_ROLE_MAP } from "@svatah/surface";
import { LocateError } from "@svatah/surface";
import {
  automationIdOf,
  childIndex,
  controlPathOf,
  convertTree,
  matchNodes,
  nameOf,
  roleOf,
  statesOf,
  synthesise,
  valueOf,
  type UiaNode,
} from "../src/index.js";
import { ADE_SCREENS, recordedWindow } from "./recorded.js";

const nodesOf = (screen: Parameters<typeof recordedWindow>[0]) => recordedWindow(screen).nodes;
const convert = (screen: Parameters<typeof recordedWindow>[0], interactiveOnly = false) =>
  convertTree(nodesOf(screen), {
    maxNodes: 2_000,
    interactiveOnly,
    windowTitle: recordedWindow(screen).title,
  });

const record = convert("record");
const api = convert("api");

describe("control types are normalised to the ARIA vocabulary (REQ-SURF-4)", () => {
  it("maps every ControlType the ADE produces", () => {
    for (const screen of ADE_SCREENS) {
      const unmapped = [...new Set(nodesOf(screen).map((node) => node.controlType))].filter(
        (type) => UIA_ROLE_MAP[type] === undefined,
      );
      expect(unmapped, `${screen}: ${unmapped.join(", ")}`).toEqual([]);
    }
  });

  it("reads LocalizedControlType first, because UIA has no subrole", () => {
    /*
     * Chromium publishes an ARIA `heading` as `ControlType.Text` and says
     * "heading" in `LocalizedControlType`. Without this every heading in the
     * ADE would be reported as text.
     */
    expect(roleOf({ controlType: "Text", localizedControlType: "heading" })).toBe("heading");
    expect(roleOf({ controlType: "Text" })).toBe("text");
    expect(roleOf({ controlType: "TabItem" })).toBe("tab");
  });

  it("ignores a localised control type that is not an ARIA role", () => {
    /*
     * `LocalizedControlType` is *localised*: on a German Windows a button says
     * "Schaltfläche". A lookup that accepted anything would put that in `role`
     * and break every binding recorded on an English machine.
     */
    expect(roleOf({ controlType: "Button", localizedControlType: "Schaltfläche" })).toBe("button");
    expect(roleOf({ controlType: "Button", localizedControlType: "bouton" })).toBe("button");
  });

  it("falls back rather than dropping an element", () => {
    expect(roleOf({ controlType: "SomethingNew" })).toBe("generic");
  });

  it("gives the ADE's rail rows the role `button` and its view tabs `tab` (T10.3)", () => {
    /*
     * The eleven screen tabs are gone (T10.3). The ADE is a rail of eight
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

    const tabs = convert("flows").filter((node) => node.role === "tab");
    expect(tabs.map((node) => node.native?.["automationId"])).toEqual([
      "editor",
      "plan",
      "history",
    ]);
  });
});

describe("names, values and states", () => {
  it("takes the one Name UIA has, then HelpText", () => {
    expect(nameOf({ parent: 0, controlType: "Button", name: "Run" })).toBe("Run");
    expect(nameOf({ parent: 0, controlType: "Button", helpText: "Copy" })).toBe("Copy");
    expect(nameOf({ parent: 0, controlType: "Edit", value: "typed" })).toBe("");
  });

  it("does not repeat a toggle's state as a value", () => {
    const box: UiaNode = { parent: 0, controlType: "CheckBox", name: "Remember me", toggleState: "On" };
    expect(valueOf(box)).toBeUndefined();
    expect(statesOf(box)).toContain("checked");
    expect(statesOf({ ...box, toggleState: "Off" })).toContain("unchecked");
  });

  it("prefers IsOffscreen to the rectangle for hidden", () => {
    /*
     * `IsOffscreen` is UIA's own answer, and it is better than the box: it is
     * true for an element scrolled out of a container as well as for one with
     * no area. The box is the fallback for a provider that does not set it.
     */
    expect(statesOf({ parent: 0, controlType: "Button", isOffscreen: true, box: [0, 0, 80, 24] })).toContain("hidden");
    expect(statesOf({ parent: 0, controlType: "Button", box: [0, 0, 0, 0] })).toContain("hidden");
    expect(statesOf({ parent: 0, controlType: "Button", box: [0, 0, 80, 24] })).not.toContain("hidden");
  });

  it("reads disabled, focused, selected and expanded", () => {
    expect(statesOf({ parent: 0, controlType: "Button", isEnabled: false })).toEqual(["disabled"]);
    expect(statesOf({ parent: 0, controlType: "Button", hasKeyboardFocus: true })).toEqual(["focused"]);
    expect(statesOf({ parent: 0, controlType: "TabItem", isSelected: true })).toEqual(["selected"]);
    expect(statesOf({ parent: 0, controlType: "ComboBox", expandCollapseState: "Collapsed" })).toEqual(["collapsed"]);
    expect(statesOf({ parent: 0, controlType: "ComboBox", expandCollapseState: "PartiallyExpanded" })).toEqual(["expanded"]);
  });
});

describe("automationId (LLD §3.3, §7.5)", () => {
  it("is the AutomationId, which on Windows is the DOM id", () => {
    expect(automationIdOf({ parent: 0, controlType: "Edit", automationId: "api-name" })).toBe("api-name");
    // No fallback to the name: on Windows the name has its own candidate, and a
    // second one carrying the same string is a duplicate the resolver drops.
    expect(automationIdOf({ parent: 0, controlType: "Edit", name: "Request name" })).toBeUndefined();
  });

  it("gives the ADE's gateway control the id its markup has", () => {
    const gateway = record.find((node) => node.native?.["automationId"] === "record-gateway");
    expect(gateway?.role).toBe("combobox");
    expect(gateway?.name).toBe("Gateway");
  });
});

describe("the snapshot shape (LLD §2.2)", () => {
  it("assigns references in document order, with depth and parent", () => {
    expect(record[0]!.ref).toBe("r0");
    expect(record[0]!.role).toBe("window");
    expect(record[1]!.parent).toBe("r0");
    expect(record.every((node, at) => node.ref === `r${at}`)).toBe(true);
  });

  it("interactiveOnly keeps the controls and the structure above them", () => {
    const some = convert("record", true);
    expect(some.length).toBeLessThan(record.length);
    expect(some.filter((node) => isInteractiveRole(node.role)).map((node) => node.name)).toEqual(
      record.filter((node) => isInteractiveRole(node.role)).map((node) => node.name),
    );
    expect(some[0]!.role).toBe("window");
  });

  it("carries the native control type, so a fingerprint's tag is the ControlType", () => {
    expect(record[0]!.native?.["controlType"]).toBe("Window");
  });
});

describe("controlPath (LLD §3.3, §7.5)", () => {
  it("starts at the window title and uses UIA control types", () => {
    /*
     * The control type, not the ARIA role: a `controlPath` is the address a
     * person checks by hand in Inspect or Accessibility Insights, and those
     * show `Button`, not `button`.
     */
    expect(record[0]!.controlPath).toBe("Window[Svatah ADE]");
    const button = record.find((node) => node.name === "Stop recording");
    expect(button?.controlPath).toContain("Button[Stop recording]");
  });

  it("addresses a named element by name and an anonymous one by index", () => {
    const raw: UiaNode[] = [
      { parent: -1, controlType: "Window", name: "Svatah ADE" },
      { parent: 0, controlType: "Group" },
      { parent: 0, controlType: "Group" },
      { parent: 2, controlType: "Button", name: "Stop recording" },
    ];
    const children = childIndex(raw);
    expect(controlPathOf(raw, 2, children, "Svatah ADE")).toBe("Window[Svatah ADE]/Group[1]");
    expect(controlPathOf(raw, 3, children, "Svatah ADE")).toBe(
      "Window[Svatah ADE]/Group[1]/Button[Stop recording]",
    );
  });

  it("gives two different elements two different paths", () => {
    const paths = record.map((node) => node.controlPath);
    expect([...new Set(paths.filter((path, at) => paths.indexOf(path) !== at))]).toEqual([]);
  });
});

describe("matching and synthesis (LLD §6.3, REQ-REC-3)", () => {
  it("finds an element by its automationId, and by role and name", () => {
    expect(matchNodes({ by: "automationId", value: "record-gateway", score: 1 }, record)).toHaveLength(1);
    expect(
      matchNodes({ by: "role", role: "button", name: "Stop recording", exact: true, score: 1 }, record),
    ).toHaveLength(1);
  });

  it("resolves a web binding's `id`, because on Windows the id is the AutomationId", () => {
    expect(matchNodes({ by: "id", value: "record-gateway", score: 1 }, record)).toHaveLength(1);
  });

  it("refuses a candidate kind a desktop tree has no addressing for", () => {
    for (const by of ["css", "xpath", "testid", "webmcp"] as const) {
      expect(() => matchNodes({ by, value: "x", score: 1 }, record)).toThrow(LocateError);
    }
  });

  it("puts the automationId first and the coordinates last, and drops what is not unique", () => {
    const gateway = record.find((node) => node.native?.["automationId"] === "record-gateway")!;
    const bundle = synthesise(gateway, record);
    expect(bundle[0]!.by).toBe("automationId");
    expect(bundle.at(-1)!.by).toBe("coords");
    for (const candidate of bundle) {
      if (candidate.by === "coords") continue;
      expect(matchNodes(candidate, record), JSON.stringify(candidate)).toHaveLength(1);
    }
  });

  it("synthesises a resolvable bundle for every identified control on the API screen", () => {
    const controls = api.filter(
      (node) => node.native?.["automationId"] !== undefined && node.name !== undefined,
    );
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      const bundle = synthesise(control, api);
      expect(bundle.length, control.name).toBeGreaterThan(0);
      expect(matchNodes(bundle[0]!, api).map((one) => one.ref)).toEqual([control.ref]);
    }
  });
});
