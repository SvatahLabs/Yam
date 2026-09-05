/**
 * The AX adapter as an `AgentSurface`, against the ADE's recorded trees (T6.2,
 * REQ-ADP-7, REQ-SURF-1, 4, 5).
 *
 * The bridge is injected (`test/recorded.ts`), so this drives the whole adapter
 * — snapshot, locate, describe, act, read, check, state, restore — without the
 * macOS Accessibility permission. What it cannot prove is that
 * `osascriptBridge` reads a real `AXUIElement` correctly; that is the live gate
 * `docs/spec/progress/phase-6.md` records.
 */
import { describe, expect, it } from "vitest";
import {
  ActionabilityError,
  LocateError,
  NavigationError,
  SessionError,
} from "@svatah/surface";
import { AxSurface, AX_CAPABILITIES, keyChord } from "../src/index.js";
import { recordedBridge, type AdeScreen, type RecordedBridge } from "./recorded.js";

async function open(
  options: Parameters<typeof recordedBridge>[0] = {},
): Promise<{ surface: AxSurface; bridge: RecordedBridge }> {
  const bridge = recordedBridge({ screen: "record", ...options });
  const surface = new AxSurface({ processName: "Svatah ADE", bridge });
  await surface.open({ kind: "desktop", processName: "Svatah ADE" } as never);
  return { surface, bridge };
}

describe("opening a session (REQ-ADP-7, LLD §7.5)", () => {
  it("needs the name of the process to drive", async () => {
    const surface = new AxSurface({ bridge: recordedBridge() });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(SessionError);
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(/app.processName/);
  });

  it("refuses to start when the accessibility permission is not granted", async () => {
    /*
     * Before the first snapshot, not on it. A session that opened and then
     * failed on its first `locate` would report a `locator` failure for an
     * element that was there all along, and send whoever read the run looking
     * at the application.
     */
    const bridge = recordedBridge({
      permission: {
        state: "prompt-pending",
        advice: "Open System Settings → Privacy & Security → Accessibility.",
      },
    });
    const surface = new AxSurface({ processName: "Svatah ADE", bridge });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /Accessibility permission is not granted \(prompt-pending\)/,
    );
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /svatah surface doctor/,
    );
  });

  it("brings the window forward, so the tree is the one a person would see", async () => {
    const { bridge } = await open();
    expect(bridge.commands[0]).toEqual({ kind: "activate" });
  });

  it("declares what a desktop window can and cannot do (LLD §2.4)", async () => {
    const { surface } = await open();
    expect(surface.capabilities()).toEqual(AX_CAPABILITIES);
    // A macOS sheet is an element of the window's own tree, not a separate
    // surface; a Chromium `<iframe>` is more of the same web area.
    expect(surface.capabilities().dialogs).toBe(false);
    expect(surface.capabilities().frames).toBe(false);
    expect(surface.capabilities().windows).toBe(true);
    expect(surface.kind).toBe("desktop");
  });
});

describe("snapshot (REQ-SURF-1, 4, LLD §2.2)", () => {
  it("produces the normalised shape, with a hash and a rendering", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    expect(snapshot.nodes.length).toBeGreaterThan(20);
    expect(snapshot.hash).toMatch(/^[0-9a-f]{16,}$/);
    expect(snapshot.text).toContain("[ref=");
    expect(snapshot.tokensEstimate).toBeGreaterThan(0);
    // No adapter internals above the surface (REQ-SURF-5): `path`, `source` and
    // `controlPath` are the adapter's, and none of them is in the snapshot.
    for (const node of snapshot.nodes) {
      expect(node).not.toHaveProperty("path");
      expect(node).not.toHaveProperty("source");
      expect(node).not.toHaveProperty("controlPath");
    }
  });

  it("names the ADE's controls the way a flow would", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot({ interactiveOnly: true });
    const names = snapshot.nodes.map((node) => node.name);
    expect(names).toContain("Start recording");
    expect(names).toContain("Record review");
    expect(names).toContain("Gateway");
  });

  it("takes a fresh tree each time, because a window changes", async () => {
    const { surface, bridge } = await open({
      onCommand: (command) =>
        command.kind === "action" || command.kind === "click" ? ("run" as AdeScreen) : undefined,
    });
    const before = await surface.snapshot();
    await surface.act("click", (await surface.locate({ by: "role", role: "tab", name: "Run", score: 1 }))[0]);
    const after = await surface.snapshot();
    expect(bridge.screen()).toBe("run");
    expect(after.hash).not.toBe(before.hash);
  });

  it("scopes to a subtree when asked", async () => {
    const { surface } = await open();
    const whole = await surface.snapshot();
    const tablist = whole.nodes.find((node) => node.role === "tablist")!;
    const part = await surface.snapshot({ root: tablist.ref });
    expect(part.nodes.length).toBeLessThan(whole.nodes.length);
    expect(part.nodes[0]!.ref).toBe(tablist.ref);
  });
});

describe("locate and describe (LLD §6.3, §3.3)", () => {
  it("resolves a candidate to a reference", async () => {
    const { surface } = await open();
    const refs = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    expect(refs).toHaveLength(1);
    const described = await surface.describe(refs[0]!);
    expect(described.role).toBe("combobox");
    expect(described.tag).toBe("AXPopUpButton");
    expect(described.attrs["automationId"]).toBe("record-gateway");
    expect(described.native?.["controlPath"]).toContain("Window[Svatah ADE]");
  });

  it("applies `nth`, which is the binding's decision and not the adapter's", async () => {
    const { surface } = await open();
    const all = await surface.locate({ by: "name", value: "Gateway", score: 1 });
    expect(all.length).toBeGreaterThan(1);
    const one = await surface.locate({ by: "name", value: "Gateway", nth: 1, score: 1 });
    expect(one).toEqual([all[1]]);
  });

  it("describes an element with everything a fingerprint needs (LLD §3.3)", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({
      by: "role",
      role: "button",
      name: "Start recording",
      exact: true,
      score: 1,
    });
    const described = await surface.describe(ref!);
    expect(described.rolePath[0]).toBe("window");
    expect(described.rolePath.at(-1)).toBe("button");
    expect(described.box).toHaveLength(4);
    expect(described.index).toBeGreaterThanOrEqual(0);
    expect(described.states).toBeInstanceOf(Array);
  });

  it("refuses a reference the current snapshot does not have", async () => {
    const { surface } = await open();
    await surface.snapshot();
    await expect(surface.describe("r99999")).rejects.toThrow(LocateError);
    await expect(surface.describe("r99999")).rejects.toThrow(/take a new snapshot/);
  });
});

describe("act (LLD §7.5)", () => {
  it("presses through AXPress when the element declares it", async () => {
    const { surface, bridge } = await open();
    const [ref] = await surface.locate({
      by: "role",
      role: "button",
      name: "Start recording",
      exact: true,
      score: 1,
    });
    await surface.act("click", ref);
    const pressed = bridge.commands.filter((one) => one.kind === "action");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ action: "AXPress" });
  });

  it("clicks the box centre when the element declares no action", async () => {
    /*
     * LLD §7.5's "with a mouse/keyboard fallback at the element's box centre".
     * A Chromium canvas, a custom control, anything the application did not
     * make accessible: there is still somewhere to click, and the box is in the
     * snapshot for exactly this.
     */
    const { surface, bridge } = await open();
    const snapshot = await surface.snapshot();
    const inert = snapshot.nodes.find(
      (node) => node.role === "heading" && node.box !== undefined,
    )!;
    await surface.act("click", inert.ref);
    const clicks = bridge.commands.filter((one) => one.kind === "click");
    expect(clicks).toHaveLength(1);
    const [x, y, width, height] = inert.box!;
    expect(clicks[0]).toEqual({
      kind: "click",
      at: [Math.round(x + width / 2), Math.round(y + height / 2)],
    });
  });

  it("refuses to act on a disabled element", async () => {
    const bridge = recordedBridge({ screen: "record" });
    const surface = new AxSurface({ processName: "Svatah ADE", bridge });
    await surface.open({ kind: "desktop" } as never);
    const snapshot = await surface.snapshot();
    const disabled = snapshot.nodes.find((node) => node.states.includes("disabled"));
    if (disabled !== undefined) {
      await expect(surface.act("click", disabled.ref)).rejects.toThrow(ActionabilityError);
    }
    // The ADE's Record screen disables the `anthropic` option when there is no
    // credential, which is what makes this reachable at all (P5-F2).
    expect(snapshot.nodes.some((node) => node.states.includes("disabled"))).toBe(true);
  });

  it("types by setting the value, and falls back to keystrokes", async () => {
    const { surface, bridge } = await open({ screen: "api" });
    const [ref] = await surface.locate({ by: "automationId", value: "api-name", score: 1 });
    await surface.act("type", ref, { value: "active count" });
    expect(bridge.commands.map((one) => one.kind)).toContain("focus");
    expect(bridge.commands).toContainEqual(
      expect.objectContaining({ kind: "setValue", value: "active count" }),
    );
  });

  it("sends named keys as key codes and characters as keystrokes", () => {
    // `keystroke "Enter"` types the word, which is why a named key is a code.
    expect(keyChord("Enter")).toEqual({ text: "Enter", code: 36, using: [] });
    expect(keyChord("cmd+Enter")).toEqual({ text: "Enter", code: 36, using: ["command down"] });
    expect(keyChord("a")).toEqual({ text: "a", using: [] });
    expect(keyChord("shift+Tab")).toEqual({ text: "Tab", code: 48, using: ["shift down"] });
  });

  it("says plainly that a desktop application has no navigation", async () => {
    const { surface } = await open();
    for (const action of ["navigate", "back", "forward", "refresh"] as const) {
      await expect(surface.act(action, undefined, { url: "/x" })).rejects.toThrow(NavigationError);
    }
  });

  it("says plainly that it cannot drag, rather than half-doing it", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    await expect(
      surface.act("dragTo", snapshot.nodes[1]!.ref, {}, snapshot.nodes[2]!.ref),
    ).rejects.toThrow(/cannot drag/);
    expect(AX_CAPABILITIES.drag).toBe(false);
  });
});

describe("read, check, state (LLD §2.3, §7.5)", () => {
  it("reads a name, a value and the window title", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({
      by: "role",
      role: "button",
      name: "Start recording",
      exact: true,
      score: 1,
    });
    expect(await surface.read("text", ref)).toBe("Start recording");
    expect(await surface.read("title")).toBe("Svatah ADE");
    await expect(surface.read("url")).rejects.toThrow(NavigationError);
  });

  it("answers a state predicate from the tree", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    expect((await surface.check({ kind: "visible" }, "ref", ref)).ok).toBe(true);
    expect((await surface.check({ kind: "hidden" }, "ref", ref)).ok).toBe(false);
    expect((await surface.check({ kind: "enabled" }, "ref", ref)).ok).toBe(true);
  });

  it("answers a window-title predicate, and refuses a URL one", async () => {
    const { surface } = await open();
    expect(
      (
        await surface.check(
          { kind: "titleContains", value: { kind: "literal", value: "Svatah" } },
          "page",
        )
      ).ok,
    ).toBe(true);
    await expect(
      surface.check({ kind: "urlContains", value: { kind: "literal", value: "/x" } }, "page"),
    ).rejects.toThrow(/no URL/);
  });

  it("reports the window it is on, and restores by activating it", async () => {
    const { surface, bridge } = await open();
    const state = await surface.state();
    expect(state).toEqual({ kind: "desktop", windowTitle: "Svatah ADE", windowIndex: 0 });

    await surface.restore(state);
    expect(bridge.commands.filter((one) => one.kind === "activate").length).toBeGreaterThan(1);
  });

  it("refuses to resume onto a different window", async () => {
    /*
     * A desktop application's state is its own: Svatah has no storage state to
     * re-apply, so the window title is the only check there is that the resume
     * is starting where the checkpoint stopped.
     */
    const { surface } = await open();
    await expect(
      surface.restore({ kind: "desktop", windowTitle: "Something else" }),
    ).rejects.toThrow(/put it back where the checkpoint was/);
  });

  it("takes a screenshot through the OS, and does not pretend to mask it", async () => {
    const { surface, bridge } = await open();
    await surface.screenshot("/tmp/ade.png", ["r1"]);
    expect(bridge.screenshots).toEqual(["/tmp/ade.png"]);
  });
});
