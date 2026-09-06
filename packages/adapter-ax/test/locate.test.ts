/**
 * Candidate matching and synthesis, against the ADE's recorded trees (T6.2,
 * LLD §3.3, §6.3, REQ-REC-3).
 */
import { describe, expect, it } from "vitest";
import { LocateError } from "@svatah/yam-surface";
import { convertTree, matchNodes, synthesise, type AxSnapshotNode } from "../src/index.js";
import { recordedWindow } from "./recorded.js";

const nodesFor = (screen: Parameters<typeof recordedWindow>[0]): AxSnapshotNode[] => {
  const window = recordedWindow(screen);
  return convertTree(window.nodes, {
    maxNodes: 2_000,
    interactiveOnly: false,
    windowTitle: window.title,
  });
};

const record = nodesFor("record");
const api = nodesFor("api");

describe("matching a candidate against the tree (LLD §6.3)", () => {
  it("finds an element by its automationId", () => {
    const found = matchNodes({ by: "automationId", value: "record-gateway", score: 1 }, record);
    expect(found).toHaveLength(1);
    expect(found[0]!.role).toBe("combobox");
  });

  it("finds an element by role and name", () => {
    const found = matchNodes(
      { by: "role", role: "button", name: "Stop recording", exact: true, score: 1 },
      record,
    );
    expect(found).toHaveLength(1);
  });

  it("matches loosely when the candidate says so", () => {
    const exact = matchNodes(
      { by: "role", role: "button", name: "Stop", exact: true, score: 1 },
      record,
    );
    expect(exact).toEqual([]);
    const loose = matchNodes(
      { by: "role", role: "button", name: "Stop", exact: false, score: 1 },
      record,
    );
    expect(loose.map((node) => node.name)).toEqual(["Stop recording"]);
  });

  it("finds an element by its controlPath", () => {
    const button = record.find((node) => node.name === "Stop recording")!;
    const found = matchNodes({ by: "controlPath", value: button.controlPath, score: 1 }, record);
    expect(found.map((node) => node.ref)).toEqual([button.ref]);
  });

  it("reports every match, so the resolver's exactly-one rule is the resolver's", () => {
    /*
     * "Record review" is the screen's heading *and* the palette row that goes
     * to it *and* the crumb — three nodes with one name. An adapter that quietly
     * returned the best of them would be taking a decision the binding should
     * have recorded (LLD §6.3), and the resolver's exactly-one rule would never
     * fire.
     */
    const found = matchNodes({ by: "name", value: "Record review", score: 1 }, record);
    expect(found.length).toBeGreaterThan(1);
  });

  it("leaves `nth` to the caller, and returns matches in snapshot order", () => {
    /*
     * `nth` is applied by `AxSurface.locate` (see `surface.test.ts`), not here.
     * Matching stays a pure function of the tree so that a `describe()` and a
     * `locate()` can never disagree about what is on the screen; picking one of
     * several is a separate decision, and it belongs where the reference is
     * minted.
     */
    const found = matchNodes({ by: "name", value: "Gateway", nth: 1, score: 1 }, record);
    const plain = matchNodes({ by: "name", value: "Gateway", score: 1 }, record);
    expect(found).toEqual(plain);
    // Snapshot order, so `nth: 1` means the same element every time.
    expect(found.map((node) => node.ref)).toEqual(
      [...found].sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1))).map((n) => n.ref),
    );
  });

  it("takes the deepest element under a point, not the window", () => {
    const button = record.find((node) => node.name === "Stop recording")!;
    const [x, y, width, height] = button.box!;
    const found = matchNodes(
      { by: "coords", value: `${Math.round(x + width / 2)},${Math.round(y + height / 2)}`, score: 1 },
      record,
    );
    expect(found).toHaveLength(1);
    // Every ancestor's box contains the point too; a click on the window is not
    // a click on the button inside it.
    expect(found[0]!.depth).toBeGreaterThan(1);
  });

  it("refuses a candidate kind a desktop tree has no addressing for", () => {
    for (const by of ["css", "xpath", "testid", "webmcp"] as const) {
      expect(() => matchNodes({ by, value: "x", score: 1 }, record)).toThrow(LocateError);
    }
    // And says where it belongs, rather than reporting "not found".
    expect(() => matchNodes({ by: "css", value: "#a", score: 1 }, record)).toThrow(
      /belongs to the web adapters/,
    );
  });

  it("refuses a candidate with nothing to match on", () => {
    expect(() => matchNodes({ by: "automationId", score: 1 }, record)).toThrow(/must carry a value/);
    expect(() => matchNodes({ by: "role", score: 1 }, record)).toThrow(/must carry a role/);
  });
});

describe("synthesising a candidate bundle (REQ-REC-3, LLD §3.3)", () => {
  it("puts the automationId first and the coordinates last", () => {
    const gateway = record.find((node) => node.native?.["automationId"] === "record-gateway")!;
    const bundle = synthesise(gateway, record);
    expect(bundle[0]!.by).toBe("automationId");
    expect(bundle[0]!.value).toBe("record-gateway");
    expect(bundle.at(-1)!.by).toBe("coords");
    // Descending score, which is what the resolver tries in order.
    expect(bundle.map((one) => one.score)).toEqual([...bundle.map((one) => one.score)].sort().reverse());
  });

  it("drops a candidate that matches more than one element", () => {
    /*
     * REQ-REC-3: "candidates matching more than one element are dropped." The
     * ADE's `<label>Gateway</label>` and the control it labels share a name, so
     * a role+name candidate for the *label* would be fine and one asking only
     * for the name would not.
     */
    const gateway = record.find((node) => node.native?.["automationId"] === "record-gateway")!;
    for (const candidate of synthesise(gateway, record)) {
      if (candidate.by === "coords") continue;
      expect(matchNodes(candidate, record), JSON.stringify(candidate)).toHaveLength(1);
    }
  });

  it("always leaves something to click, even for an element with no identity", () => {
    // A `coords` candidate is emitted whether or not it is unique, because it is
    // the pointer fallback LLD §7.5 requires and there is nothing below it.
    const anonymous = record.find(
      (node) => node.native?.["automationId"] === undefined && node.name === undefined && node.box !== undefined,
    );
    expect(anonymous).toBeDefined();
    expect(synthesise(anonymous!, record).some((one) => one.by === "coords")).toBe(true);
  });

  it("synthesises a resolvable bundle for every named control on the API screen", () => {
    const controls = api.filter(
      (node) => node.native?.["automationId"] !== undefined && node.name !== undefined,
    );
    expect(controls.length).toBeGreaterThan(3);
    for (const control of controls) {
      const bundle = synthesise(control, api);
      expect(bundle.length, control.name).toBeGreaterThan(0);
      // The top candidate resolves to exactly this element.
      expect(matchNodes(bundle[0]!, api).map((one) => one.ref)).toEqual([control.ref]);
    }
  });
});
