/**
 * The snapshot text renderer and the role normalisation tables (LLD §2.2, REQ-SURF-4).
 */
import { describe, expect, it } from "vitest";
import type { SnapshotNode } from "@svatah/yam-schema";
import {
  APPIUM_ANDROID_ROLE_MAP,
  AX_ROLE_MAP,
  buildSnapshot,
  estimateTokens,
  FALLBACK_ROLE,
  normaliseRole,
  normalisedRoles,
  renderNode,
  renderSnapshot,
  ROLE_MAPS,
  UIA_ROLE_MAP,
} from "../src/index.js";

const nodes: SnapshotNode[] = [
  { ref: "r1", role: "form", name: "Sign in", states: [], depth: 0 },
  { ref: "r2", role: "textbox", name: "Username", value: "atul", states: ["required"], depth: 1, parent: "r1" },
  { ref: "r3", role: "button", name: "Sign in", states: ["disabled", "focused"], depth: 1, parent: "r1" },
  { ref: "r4", role: "alert", name: "Hidden banner", states: ["hidden"], depth: 1, parent: "r1" },
];

describe("snapshot rendering (LLD §2.2)", () => {
  it("renders one line per node, indented by depth, with the ref last", () => {
    expect(renderSnapshot(nodes)).toBe(
      [
        '- form "Sign in" [ref=r1]',
        '  - textbox "Username": atul [required] [ref=r2]',
        '  - button "Sign in" [disabled, focused] [ref=r3]',
      ].join("\n"),
    );
  });

  it("sorts states so the rendering is stable whatever order the adapter produced", () => {
    const a = renderNode({ ref: "r9", role: "button", states: ["focused", "disabled"], depth: 0 });
    const b = renderNode({ ref: "r9", role: "button", states: ["disabled", "focused"], depth: 0 });
    expect(a).toBe(b);
  });

  it("omits hidden nodes by default and keeps them when asked", () => {
    expect(renderSnapshot(nodes)).not.toContain("Hidden banner");
    expect(renderSnapshot(nodes, { omitHidden: false })).toContain("Hidden banner");
  });

  it("escapes quotes and newlines in names", () => {
    const line = renderNode({ ref: "r1", role: "text", name: 'a "b"\nc', states: [], depth: 0 });
    expect(line).toBe('- text "a \\"b\\"\\nc" [ref=r1]');
  });

  it("truncates long names", () => {
    const line = renderNode(
      { ref: "r1", role: "text", name: "x".repeat(200), states: [], depth: 0 },
      { maxTextLength: 10 },
    );
    expect(line).toBe('- text "xxxxxxxxx…" [ref=r1]');
  });

  it("omits an empty name and an empty value", () => {
    expect(renderNode({ ref: "r1", role: "generic", name: "", value: "", states: [], depth: 0 })).toBe(
      "- generic [ref=r1]",
    );
  });

  it("buildSnapshot fills in the text and the token estimate", () => {
    const snapshot = buildSnapshot("r1", nodes, "hash-1");
    expect(snapshot.ref).toBe("r1");
    expect(snapshot.hash).toBe("hash-1");
    expect(snapshot.text).toBe(renderSnapshot(nodes));
    expect(snapshot.tokensEstimate).toBe(estimateTokens(snapshot.text));
    expect(snapshot.nodes).toHaveLength(4);
  });

  it("estimates tokens at four characters each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("role normalisation (REQ-SURF-4)", () => {
  it("maps UIA control types onto ARIA roles", () => {
    expect(normaliseRole("uia", "Edit")).toBe("textbox");
    expect(normaliseRole("uia", "Hyperlink")).toBe("link");
    expect(normaliseRole("uia", "ListItem")).toBe("option");
  });

  it("maps macOS AX roles onto ARIA roles", () => {
    expect(normaliseRole("ax", "AXTextField")).toBe("textbox");
    expect(normaliseRole("ax", "AXSecureTextField")).toBe("textbox");
    expect(normaliseRole("ax", "AXOutlineRow")).toBe("treeitem");
  });

  it("maps Android classes onto ARIA roles", () => {
    expect(normaliseRole("appium", "android.widget.EditText")).toBe("textbox");
    expect(normaliseRole("appium", "android.widget.Switch")).toBe("switch");
    expect(normaliseRole("appium", "androidx.recyclerview.widget.RecyclerView")).toBe("list");
  });

  it("falls back to generic rather than dropping an unmapped control", () => {
    for (const map of Object.keys(ROLE_MAPS) as Array<keyof typeof ROLE_MAPS>) {
      expect(normaliseRole(map, "SomethingNobodyMapped")).toBe(FALLBACK_ROLE);
    }
  });

  it("each table maps the controls a real desktop or mobile app is built from", () => {
    // A thin table would silently degrade grounding, so assert a floor per platform.
    expect(Object.keys(UIA_ROLE_MAP).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(AX_ROLE_MAP).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(APPIUM_ANDROID_ROLE_MAP).length).toBeGreaterThanOrEqual(25);
  });

  it("every mapped role is a lower-case ARIA-style token", () => {
    for (const map of Object.values(ROLE_MAPS)) {
      for (const role of Object.values(map)) {
        expect(role).toMatch(/^[a-z]+$/);
      }
    }
  });

  it("the three platforms agree on the roles they share", () => {
    // The point of REQ-SURF-4 is that the same control reads the same everywhere.
    expect(normaliseRole("uia", "Button")).toBe(normaliseRole("ax", "AXButton"));
    expect(normaliseRole("ax", "AXButton")).toBe(normaliseRole("appium", "android.widget.Button"));
    expect(normaliseRole("uia", "CheckBox")).toBe(normaliseRole("ax", "AXCheckBox"));
    expect(normaliseRole("uia", "Slider")).toBe(normaliseRole("appium", "android.widget.SeekBar"));
  });

  it("lists every normalised role, including the fallback", () => {
    const roles = normalisedRoles();
    expect(roles).toContain(FALLBACK_ROLE);
    expect(roles).toContain("button");
    expect(roles).toEqual([...roles].sort());
  });
});
