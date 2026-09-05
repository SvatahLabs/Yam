/**
 * The UIA adapter as an `AgentSurface`, against the ADE's recorded trees (T6.1,
 * REQ-ADP-6, REQ-SURF-1, 4, 5).
 *
 * The bridge is injected, so this drives the whole adapter without Windows.
 * What it cannot prove is that `powershellBridge` reads a real UIA tree
 * correctly; that is the live gate `docs/spec/progress/phase-6.md` records.
 */
import { describe, expect, it } from "vitest";
import { ActionabilityError, LocateError, NavigationError, SessionError } from "@svatah/surface";
import { escapeSendKeys, sendKeysFor, UiaSurface, UIA_CAPABILITIES } from "../src/index.js";
import { recordedBridge, type RecordedBridge } from "./recorded.js";

async function open(
  options: Parameters<typeof recordedBridge>[0] = {},
): Promise<{ surface: UiaSurface; bridge: RecordedBridge }> {
  const bridge = recordedBridge({ screen: "record", ...options });
  const surface = new UiaSurface({ processName: "Svatah ADE", bridge });
  await surface.open({ kind: "desktop", processName: "Svatah ADE" } as never);
  return { surface, bridge };
}

describe("opening a session (REQ-ADP-6, LLD §7.5)", () => {
  it("needs the name of the process to drive", async () => {
    const surface = new UiaSurface({ bridge: recordedBridge() });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(/app.processName/);
  });

  it("refuses to start when UI Automation is not reachable", async () => {
    /*
     * There is no permission to grant on Windows — which is the difference from
     * the AX adapter, and the reason the message says what it does. What can go
     * wrong is a constrained PowerShell, or a target at a higher integrity
     * level than Svatah.
     */
    const bridge = recordedBridge({
      availability: {
        state: "unavailable",
        advice: "`UIAutomationClient` would not load; check Constrained Language Mode.",
      },
    });
    const surface = new UiaSurface({ processName: "Svatah ADE", bridge });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(SessionError);
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /not reachable \(unavailable\).*svatah surface doctor/s,
    );
  });

  it("declares what a Windows desktop window can and cannot do (LLD §2.4)", async () => {
    const { surface } = await open();
    expect(surface.capabilities()).toEqual(UIA_CAPABILITIES);
    // A Windows dialog is a top-level window of its own, not a separate surface.
    expect(surface.capabilities().dialogs).toBe(false);
    expect(surface.capabilities().windows).toBe(true);
    expect(surface.kind).toBe("desktop");
  });
});

describe("snapshot, locate and describe", () => {
  it("produces the normalised shape and hides the adapter's own fields", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    expect(snapshot.nodes.length).toBeGreaterThan(20);
    expect(snapshot.text).toContain("[ref=");
    for (const node of snapshot.nodes) {
      expect(node).not.toHaveProperty("path");
      expect(node).not.toHaveProperty("source");
      expect(node).not.toHaveProperty("controlPath");
    }
  });

  it("describes an element with everything a fingerprint needs, and its patterns", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    const described = await surface.describe(ref!);
    expect(described.role).toBe("combobox");
    expect(described.tag).toBe("ComboBox");
    expect(described.attrs["automationId"]).toBe("record-gateway");
    // The patterns are what `act` chooses from, so a report of a failed action
    // can say which one was available.
    expect(described.attrs["patterns"]).toContain("Value");
    expect(described.native?.["controlPath"]).toContain("Window[Svatah ADE]");
    expect(described.rolePath[0]).toBe("window");
  });

  it("applies `nth`, which is the binding's decision and not the adapter's", async () => {
    const { surface } = await open();
    const all = await surface.locate({ by: "name", value: "Gateway", score: 1 });
    expect(all.length).toBeGreaterThan(1);
    expect(await surface.locate({ by: "name", value: "Gateway", nth: 1, score: 1 })).toEqual([all[1]]);
  });

  it("refuses a reference the current snapshot does not have", async () => {
    const { surface } = await open();
    await expect(surface.describe("r99999")).rejects.toThrow(LocateError);
  });
});

describe("act through UIA patterns (LLD §7.5)", () => {
  it("invokes a button through InvokePattern", async () => {
    const { surface, bridge } = await open();
    const [ref] = await surface.locate({
      by: "role",
      role: "button",
      name: "Start recording",
      exact: true,
      score: 1,
    });
    await surface.act("click", ref!);
    expect(bridge.commands.filter((one) => one.kind === "pattern")).toEqual([
      { kind: "pattern", path: expect.any(Array), pattern: "Invoke", method: "Invoke" },
    ]);
  });

  it("selects a tab through SelectionItemPattern, because a tab has no Invoke", async () => {
    /*
     * The reason `invoke()` tries three patterns and not one. Pressing a tab
     * *selects* it; without `SelectionItem` a click on the ADE's screen tabs
     * would fall through to the mouse for no reason at all.
     */
    const { surface, bridge } = await open();
    const [ref] = await surface.locate({ by: "role", role: "tab", name: "Run", exact: true, score: 1 });
    await surface.act("click", ref!);
    expect(bridge.commands.filter((one) => one.kind === "pattern")).toEqual([
      { kind: "pattern", path: expect.any(Array), pattern: "SelectionItem", method: "Select" },
    ]);
  });

  it("clicks the box centre when the element supports no invocable pattern", async () => {
    const { surface, bridge } = await open();
    const snapshot = await surface.snapshot();
    const inert = snapshot.nodes.find((node) => node.role === "heading" && node.box !== undefined)!;
    await surface.act("click", inert.ref);
    const [x, y, width, height] = inert.box!;
    expect(bridge.commands.filter((one) => one.kind === "click")).toEqual([
      { kind: "click", at: [Math.round(x + width / 2), Math.round(y + height / 2)] },
    ]);
  });

  it("types through ValuePattern, and reads the value back", async () => {
    const { surface, bridge } = await open({ screen: "api" });
    const [ref] = await surface.locate({ by: "automationId", value: "api-name", score: 1 });
    await surface.act("type", ref!, { value: "active count" });
    expect(bridge.commands).toContainEqual(
      expect.objectContaining({ pattern: "Value", method: "SetValue", argument: "active count" }),
    );
    const [again] = await surface.locate({ by: "automationId", value: "api-name", score: 1 });
    expect(await surface.read("value", again!)).toBe("active count");
  });

  it("refuses to act on a disabled element", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    const disabled = snapshot.nodes.find((node) => node.states.includes("disabled"))!;
    expect(disabled).toBeDefined();
    await expect(surface.act("click", disabled.ref)).rejects.toThrow(ActionabilityError);
  });

  it("says plainly that a desktop application has no navigation", async () => {
    const { surface } = await open();
    for (const action of ["navigate", "back", "forward", "refresh"] as const) {
      await expect(surface.act(action, undefined, { url: "/x" })).rejects.toThrow(NavigationError);
    }
    await expect(surface.read("url")).rejects.toThrow(NavigationError);
  });
});

describe("the keyboard", () => {
  it("translates a key name into SendKeys notation", () => {
    expect(sendKeysFor("Enter")).toBe("{ENTER}");
    expect(sendKeysFor("ctrl+a")).toBe("^a");
    expect(sendKeysFor("shift+Tab")).toBe("+{TAB}");
    expect(sendKeysFor("a")).toBe("a");
  });

  it("treats a Mac flow's `cmd` as Control, which is what it means here", () => {
    expect(sendKeysFor("cmd+Enter")).toBe("^{ENTER}");
  });

  it("escapes SendKeys's own syntax, so a password does not send a chord", () => {
    /*
     * `+^%~(){}[]` are `SendKeys` notation. A value containing `%` would send an
     * Alt chord instead of typing a per-cent sign — and a password is exactly
     * the kind of value that contains one.
     */
    expect(escapeSendKeys("100%")).toBe("100{%}");
    expect(escapeSendKeys("a+b^c")).toBe("a{+}b{^}c");
    expect(escapeSendKeys("plain")).toBe("plain");
  });
});

describe("state and restore", () => {
  it("reports the window it is on, and restores by activating it", async () => {
    const { surface, bridge } = await open();
    const state = await surface.state();
    expect(state).toEqual({ kind: "desktop", windowTitle: "Svatah ADE", windowIndex: 0 });
    await surface.restore(state);
    expect(bridge.commands.filter((one) => one.kind === "activate").length).toBeGreaterThan(1);
  });

  it("refuses to resume onto a different window", async () => {
    const { surface } = await open();
    await expect(surface.restore({ kind: "desktop", windowTitle: "Other" })).rejects.toThrow(
      /put it back where the checkpoint was/,
    );
  });
});
