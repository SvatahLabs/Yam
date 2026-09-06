/**
 * One window, two platform vocabularies, one snapshot (T6.1, T6.2, REQ-SURF-4).
 *
 * > `snapshot()` output is normalised across adapters: roles, names, states, and
 * > a reference scheme with the same shape whether the source is ARIA, UIA, AX,
 * > AT-SPI, or Appium page source.
 *
 * That is a claim about two pieces of code agreeing, and nothing checked it:
 * each adapter's tests asserted against its own fixtures, so both could drift in
 * the same direction and stay green.
 *
 * This is the check. `scripts/record-desktop-tree.mjs` reads the ADE's window
 * **once** and writes it twice — as the AX attributes Chromium publishes on
 * macOS and as the UIA properties it publishes on Windows — so the two fixtures
 * are the same window rather than two launches of the same application. (They
 * were two launches at first, and the ADE's ephemeral service port and its
 * growing list of runs both showed up as parity failures that were really
 * recording noise.)
 *
 * ## What it establishes
 *
 * The tree has the same shape, the same references, and the same controls under
 * the same names. That is what makes one flow drive the ADE on both platforms.
 *
 * ## What it does not
 *
 * One role still differs, and it is *listed* below rather than skipped, so a
 * second fails this test.
 *
 * | element | macOS | Windows | outcome |
 * |---|---|---|---|
 * | a `<select>`'s `<option>` | `AXMenuItem` | `ControlType.ListItem` | **fixed** — the AX adapter reads the pop-up ancestor (`insidePopUp`) |
 * | a `<td>` | `AXCell` | `ControlType.DataItem` | **fixed** — the UIA adapter reads the row ancestor (`insideRow`) |
 * | a `<th>` | `AXCell` → `cell` | `ControlType.HeaderItem` → `columnheader` | **open**: macOS has no header role, and no ancestor distinguishes it |
 *
 * The first two were found by this test and closed by it: both needed an
 * adapter to read an element's *parent*, which the flat role maps in
 * `@svatah/surface` cannot express, and neither would have been noticed by
 * either adapter's own tests. The third is not an interactive control, so it
 * changes nothing a flow can name; it is a known gap in
 * `docs/spec/progress/phase-6.md`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convertTree as convertAx, type AxNode } from "@svatah/adapter-ax";
import { convertTree as convertUia } from "../src/index.js";
import { ADE_SCREENS, recordedWindow, type AdeScreen } from "./recorded.js";

const AX_FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "adapter-ax",
  "test",
  "fixtures",
);

function axWindow(screen: AdeScreen): { title: string; nodes: AxNode[] } {
  return JSON.parse(readFileSync(join(AX_FIXTURES, `ade-${screen}.json`), "utf8")) as {
    title: string;
    nodes: AxNode[];
  };
}

interface Node {
  readonly ref: string;
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly states: readonly string[];
  readonly depth: number;
  readonly parent?: string;
  readonly native?: Readonly<Record<string, string>>;
  readonly controlPath: string;
}

const fromAx = (screen: AdeScreen, interactiveOnly = false): Node[] => {
  const window = axWindow(screen);
  return convertAx(window.nodes, {
    maxNodes: 2_000,
    interactiveOnly,
    windowTitle: window.title,
  }) as unknown as Node[];
};

const fromUia = (screen: AdeScreen, interactiveOnly = false): Node[] => {
  const window = recordedWindow(screen);
  return convertUia(window.nodes, {
    maxNodes: 2_000,
    interactiveOnly,
    windowTitle: window.title,
  }) as unknown as Node[];
};

/** The three documented role disagreements, as `macOS → Windows`. */
const KNOWN_ROLE_DIFFERENCES = new Set(["cell → columnheader"]);

describe("the two desktop adapters normalise one window the same way (REQ-SURF-4)", () => {
  for (const screen of ADE_SCREENS) {
    it(`gives the ADE's ${screen} screen the same tree shape and the same references`, () => {
      const ax = fromAx(screen);
      const uia = fromUia(screen);

      expect(uia).toHaveLength(ax.length);
      expect(uia.map((node) => node.ref)).toEqual(ax.map((node) => node.ref));
      expect(uia.map((node) => node.depth)).toEqual(ax.map((node) => node.depth));
      expect(uia.map((node) => node.parent)).toEqual(ax.map((node) => node.parent));
    });

    it(`names the ADE's ${screen} controls identically, so one flow drives both`, () => {
      /*
       * The assertion that matters to a flow author: "click the Stop recording
       * button" has to find the same thing on both platforms, which means the
       * pair (role, name) has to be identical for every control.
       */
      const control = (node: Node): string => `${node.role} "${node.name ?? ""}"`;
      expect(fromUia(screen, true).map(control)).toEqual(fromAx(screen, true).map(control));
    });

    it(`agrees about names, values and states on the ${screen} screen`, () => {
      const ax = fromAx(screen);
      const uia = fromUia(screen);
      for (let at = 0; at < ax.length; at += 1) {
        expect(uia[at]!.name, `${screen} ${ax[at]!.ref} name`).toEqual(ax[at]!.name);
        expect(uia[at]!.value, `${screen} ${ax[at]!.ref} value`).toEqual(ax[at]!.value);
        expect(uia[at]!.states, `${screen} ${ax[at]!.ref} states`).toEqual(ax[at]!.states);
      }
    });
  }

  it("differs on exactly the three roles that are documented, and no others", () => {
    const seen = new Map<string, number>();
    for (const screen of ADE_SCREENS) {
      const ax = fromAx(screen);
      const uia = fromUia(screen);
      for (let at = 0; at < ax.length; at += 1) {
        if (ax[at]!.role === uia[at]!.role) continue;
        const pair = `${ax[at]!.role} → ${uia[at]!.role}`;
        seen.set(pair, (seen.get(pair) ?? 0) + 1);
      }
    }
    // A fourth disagreement fails here rather than being absorbed into a number.
    expect([...seen.keys()].sort()).toEqual([...KNOWN_ROLE_DIFFERENCES].sort());
    // And none of the three is a control a flow can name.
    for (const screen of ADE_SCREENS) {
      const control = (node: Node): string => node.role;
      expect(fromUia(screen, true).map(control)).toEqual(fromAx(screen, true).map(control));
    }
  });

  it("agrees about automationId wherever Windows has one, which is the spec's asymmetry", () => {
    /*
     * Not equality, and deliberately so. LLD §7.5: "`automationId` is populated
     * from `id` attributes on Windows and from `aria-label` or `AXIdentifier` on
     * macOS." So macOS has one for `<nav aria-label="Screens">` and Windows does
     * not, and that is the spec working rather than a drift.
     *
     * What must hold — and is the thing a shared bindings store depends on — is
     * that where *both* have one, it is the same string. An element with an
     * `id` resolves by `automationId` on either platform.
     */
    for (const screen of ADE_SCREENS) {
      const ax = fromAx(screen);
      const uia = fromUia(screen);
      let shared = 0;
      for (let at = 0; at < ax.length; at += 1) {
        const windows = uia[at]!.native?.["automationId"];
        if (windows === undefined) continue;
        shared += 1;
        expect(ax[at]!.native?.["automationId"], `${screen} ${ax[at]!.ref}`).toBe(windows);
      }
      expect(shared, `${screen} has no shared automationId at all`).toBeGreaterThan(0);
    }
  });

  it("gives macOS the extra ids LLD §7.5 asks for, and they are all aria-labels", () => {
    const ax = fromAx("record");
    const uia = fromUia("record");
    const extra = ax.filter(
      (node, at) =>
        node.native?.["automationId"] !== undefined &&
        uia[at]!.native?.["automationId"] === undefined,
    );
    expect(extra.length).toBeGreaterThan(0);
    // Each one is the element's own accessible name, because that is what an
    // `aria-label` is — which is why it ranks below the DOM id.
    for (const node of extra) expect(node.native!["automationId"]).toBe(node.name);
  });

  it("keeps the platform's own vocabulary in `native`, where LLD §2.2 puts it", () => {
    const ax = fromAx("record");
    const uia = fromUia("record");
    expect(ax[0]!.native).toHaveProperty("axRole");
    expect(uia[0]!.native).toHaveProperty("controlType");
    expect(ax[0]!.native).not.toHaveProperty("controlType");
    expect(uia[0]!.native).not.toHaveProperty("axRole");
  });

  it("addresses one element by two paths, each reading for its own platform", () => {
    /*
     * `controlPath` is the one candidate that is not the same, and should not
     * be: it is the address a person checks by hand, in the tool their platform
     * has — Accessibility Inspector shows `AXButton`, Accessibility Insights
     * shows `Button`. What has to hold is that both identify the same element.
     */
    const axButton = fromAx("record").find((node) => node.name === "Stop recording")!;
    const uiaButton = fromUia("record").find((node) => node.name === "Stop recording")!;
    expect(axButton.ref).toBe(uiaButton.ref);
    expect(axButton.controlPath).toContain("AXButton[Stop recording]");
    expect(uiaButton.controlPath).toContain("Button[Stop recording]");
  });
});
