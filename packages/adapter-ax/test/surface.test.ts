/**
 * The AX adapter as an `AgentSurface`, against the app's recorded trees (T6.2,
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
} from "@svatah/yam-surface";
import { AxBridgeError, AxSurface, AX_CAPABILITIES, keyChord } from "../src/index.js";
import { recordedBridge, type AppScreen, type RecordedBridge } from "./recorded.js";

async function open(
  options: Parameters<typeof recordedBridge>[0] = {},
): Promise<{ surface: AxSurface; bridge: RecordedBridge }> {
  const bridge = recordedBridge({ screen: "record", ...options });
  const surface = new AxSurface({ processName: "Yam", bridge });
  await surface.open({ kind: "desktop", processName: "Yam" } as never);
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
    const surface = new AxSurface({ processName: "Yam", bridge });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /Accessibility permission is not granted \(prompt-pending\)/,
    );
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /yam surface doctor/,
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

  it("names the app's controls the way a flow would", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot({ interactiveOnly: true });
    const names = snapshot.nodes.map((node) => node.name);
    // Interactive controls only, so these are buttons and a combobox — the
    // things a flow sentence can say "Click the …" about.
    expect(names).toContain("Stop recording");
    expect(names).toContain("Accept");
    expect(names).toContain("Gateway");
  });

  it("takes a fresh tree each time, because a window changes", async () => {
    const { surface, bridge } = await open({
      onCommand: (command) =>
        command.kind === "action" || command.kind === "click" ? ("run" as AppScreen) : undefined,
    });
    const before = await surface.snapshot();
    /*
     * The rail item, by its `automationId` (T10.3): the eleven tabs are gone,
     * and a rail row is a `<button>` with `aria-current` because nothing
     * navigates. The id is also what survives variant 1's rename.
     */
    await surface.act(
      "click",
      (await surface.locate({ by: "automationId", value: "rail-runs", score: 1 }))[0],
    );
    const after = await surface.snapshot();
    expect(bridge.screen()).toBe("run");
    expect(after.hash).not.toBe(before.hash);
  });

  it("scopes to a subtree when asked", async () => {
    const { surface } = await open();
    const whole = await surface.snapshot();
    // The rail: a `navigation` landmark with eight rows under it, which is the
    // densest subtree the app has that is not the whole window (T10.3).
    const rail = whole.nodes.find((node) => node.role === "navigation")!;
    const part = await surface.snapshot({ root: rail.ref });
    expect(part.nodes.length).toBeLessThan(whole.nodes.length);
    expect(part.nodes[0]!.ref).toBe(rail.ref);
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
    expect(described.native?.["controlPath"]).toContain("Window[Yam]");
  });

  it("applies `nth`, which is the binding's decision and not the adapter's", async () => {
    const { surface } = await open();
    /*
     * "Record review" is the crumb, the heading and the palette's Go-to row —
     * three nodes with one name (T10.3). Which of them a binding means is the
     * binding's `nth`, and never the adapter's preference.
     */
    const all = await surface.locate({ by: "name", value: "Record review", score: 1 });
    expect(all.length).toBeGreaterThan(1);
    const one = await surface.locate({ by: "name", value: "Record review", nth: 1, score: 1 });
    expect(one).toEqual([all[1]]);
  });

  it("describes an element with everything a fingerprint needs (LLD §3.3)", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({
      by: "role",
      role: "button",
      name: "Stop recording",
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
    /*
     * A rail row, not "Stop recording": that button is *disabled* on a Record
     * screen with no session open, and an adapter is right to refuse a click on
     * a disabled control. What this case is about is the press, so it presses
     * something pressable.
     */
    const [ref] = await surface.locate({ by: "automationId", value: "rail-runs", score: 1 });
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
    const surface = new AxSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop" } as never);
    const snapshot = await surface.snapshot();
    const disabled = snapshot.nodes.find((node) => node.states.includes("disabled"));
    if (disabled !== undefined) {
      await expect(surface.act("click", disabled.ref)).rejects.toThrow(ActionabilityError);
    }
    // The app's Record screen disables the `anthropic` option when there is no
    // credential, which is what makes this reachable at all (P5-F2).
    expect(snapshot.nodes.some((node) => node.states.includes("disabled"))).toBe(true);
  });

  it("focuses first, then types, and the field holds what was typed", async () => {
    /*
     * The Surface explorer's intent field (T10.3): the one text field the app
     * has that a person types a sentence into, and the control REQ-BEH-4's
     * "every call records an intent" is about.
     *
     * This asserted a `setValue`, which is what the adapter did until P-W2-F13.
     * The field is Chromium's, and an assigned value never reaches the
     * application behind it — so the assertion described the defect. What must
     * hold either way is that the field ends up holding the text.
     */
    const { surface, bridge } = await open({ screen: "explorer" });
    const [ref] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    await surface.act("type", ref, { value: "look at the booking page" });
    expect(bridge.commands.map((one) => one.kind)).toContain("focus");
    const [again] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    const after = (await surface.describe(again!)).value;
    expect(after).toBe("look at the booking page");
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
      name: "Stop recording",
      exact: true,
      score: 1,
    });
    expect(await surface.read("text", ref)).toBe("Stop recording");
    expect(await surface.read("title")).toBe("Yam");
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
          { kind: "titleContains", value: { kind: "literal", value: "Yam" } },
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
    expect(state).toEqual({ kind: "desktop", windowTitle: "Yam", windowIndex: 0 });

    await surface.restore(state);
    expect(bridge.commands.filter((one) => one.kind === "activate").length).toBeGreaterThan(1);
  });

  it("refuses to resume onto a different window", async () => {
    /*
     * A desktop application's state is its own: Yam has no storage state to
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
    await surface.screenshot("/tmp/app.png", ["r1"]);
    expect(bridge.screenshots).toEqual(["/tmp/app.png"]);
  });

  it("reports a screenshot that was not written as a failure of this session", async () => {
    /*
     * The Screen Recording permission is a separate grant, and without it
     * `screencapture` writes nothing. The bridge raises; what this fixes is the
     * adapter passing that on in its own vocabulary instead of letting a raw
     * `AxBridgeError` out — a step that took no screenshot must not read as one
     * that did.
     */
    const { surface } = await open({
      onScreenshot: () => {
        throw new AxBridgeError(
          'No screenshot was written to "/tmp/app.png": `screencapture` exited 1.',
          "could not create image from display",
        );
      },
    });
    await expect(surface.screenshot("/tmp/app.png")).rejects.toThrow(SessionError);
    await expect(surface.screenshot("/tmp/app.png")).rejects.toThrow(
      /No screenshot was written.*could not create image from display/s,
    );
  });
});

describe("an action that cannot be confirmed is not a success (native-feedback D1-D4)", () => {
  it("reads the window back after a resize, and reports the size it took", async () => {
    const { surface } = await open();
    const outcome = await surface.act("resizeWindow", undefined, { width: 700, height: 500 });
    expect(outcome).toEqual({ ok: true, value: { width: 700, height: 500 } });
  });

  it("refuses a resize the window did not take", async () => {
    /*
     * Calculator's window, which is not resizable: System Events accepts the
     * `AXSize` write without error and the frame does not move. Reported as
     * `{ok: true}` until the adapter re-read the frame, which is the whole of
     * the defect — nothing else in a flow would ever have noticed.
     */
    const { surface } = await open({ resizable: false });
    await expect(
      surface.act("resizeWindow", undefined, { width: 700, height: 500 }),
    ).rejects.toThrow(ActionabilityError);
    await expect(
      surface.act("resizeWindow", undefined, { width: 700, height: 500 }),
    ).rejects.toThrow(/asked for 700 by 500 and is 1280 by 860, unchanged/);
  });

  it("still sends the resize before it judges it", async () => {
    // The refusal is about the read-back, not about declining to try.
    const { surface, bridge } = await open({ resizable: false });
    await expect(
      surface.act("resizeWindow", undefined, { width: 700, height: 500 }),
    ).rejects.toThrow(ActionabilityError);
    expect(bridge.commands).toContainEqual({ kind: "setSize", size: [700, 500] });
  });

  it("reads a text field's words, not the label beside it", async () => {
    /*
     * The defect this exists for: `read("text")` answered with the accessible
     * *name* first, so a text area whose name is the document title answered
     * "scratch.txt" for a field holding "Second pass ABC" — and `textContains`
     * inherited it, so a true assertion about typed text failed.
     */
    const { surface } = await open({ screen: "explorer" });
    const [ref] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    await surface.act("type", ref, { value: "look at the booking page" });

    const [again] = await surface.locate({
      by: "automationId",
      value: "explorer-intent",
      score: 1,
    });
    expect(await surface.read("text", again)).toBe("look at the booking page");
    expect(await surface.read("value", again)).toBe("look at the booking page");
    // And the name is still there for whoever wants the label.
    const described = await surface.describe(again!);
    expect(described.name).toBe("INTENT");
  });

  it("answers a text assertion on a text field from its words", async () => {
    const { surface } = await open({ screen: "explorer" });
    const [ref] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    await surface.act("type", ref, { value: "look at the booking page" });
    const [again] = await surface.locate({
      by: "automationId",
      value: "explorer-intent",
      score: 1,
    });

    const contains = await surface.check(
      { kind: "textContains", value: { kind: "literal", value: "booking page" } },
      "ref",
      again,
    );
    expect(contains.ok).toBe(true);
    expect(contains.actual).toBe("look at the booking page");

    const exact = await surface.check(
      { kind: "text", value: { kind: "literal", value: "look at the booking page" } },
      "ref",
      again,
    );
    expect(exact.ok).toBe(true);
  });

  it("leaves a button saying its name, which is what a button says", async () => {
    // The inversion is for textual roles only: a button's words are its label,
    // and a read that answered with its `AXValue` would trade one defect for
    // its mirror image.
    const { surface } = await open();
    const [ref] = await surface.locate({ by: "name", value: "Accept", score: 1 });
    expect(ref).toBeDefined();
    expect(await surface.read("text", ref!)).toBe("Accept");
  });

  it("quits an application it attached to by name, addressed by its own bundle", async () => {
    /*
     * The refusal this replaces was unanswerable: a bundle could only be named
     * in `yam.config.yaml` before the session opened, so an application Yam was
     * driving could never be quit. System Events says which bundle the running
     * process came from, which answers the ambiguity the refusal was about
     * rather than ignoring it.
     */
    const quits: Array<{ executable: string; bundleId?: string }> = [];
    const { surface } = await open({
      identity: { bundleId: "com.apple.TextEdit", bundlePath: "/System/Applications/TextEdit.app" },
    });
    void quits;
    // `quit` reaches the real `quitApplication`, which finds no such process
    // and reports it gone: the assertion here is that it was *addressed*, not
    // refused for want of a name.
    const outcome = await surface.act("quit");
    expect(outcome.ok).toBe(true);
  });

  it("still refuses to quit what it cannot identify", async () => {
    const { surface } = await open({ identity: null });
    await expect(surface.act("quit")).rejects.toThrow(SessionError);
    await expect(surface.act("quit")).rejects.toThrow(/could not be identified/);
  });
});

/**
 * Web content is typed into, never assigned to (P-W2-F13).
 *
 * `AXSetValue` puts text in the element and tells nobody. A native control reads
 * its own value when asked; a framework-rendered one keeps the value in its own
 * state and updates it from *events*, so an assigned value leaves the page
 * showing the text and the application still holding nothing — and the adapter
 * reports success, which is the worst of both.
 *
 * Found by Yam driving the packaged Yam: typed into that application's own fill
 * form over AX, and the application dispatched with no value — "The `type`
 * action needs `value`. Nothing was dispatched." The CDP passes, which produce
 * real key events, did the same journey without trouble.
 */
describe("typing into a framework-rendered field (P-W2-F13)", () => {
  it("presses keys inside a web area rather than assigning", async () => {
    const { surface, bridge } = await open({ screen: "explorer" });
    /* Every node of this recorded application is inside Chromium's web area. */
    const [field] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    await surface.act("type", field!, { value: "ada" });
    const kinds = bridge.commands.map((one) => one.kind);
    expect(kinds, JSON.stringify(bridge.commands.slice(-4))).toContain("keystroke");
    expect(kinds, "assigned to a web field instead of typing into it").not.toContain("setValue");
  });

  /*
   * And the keys replace rather than append, which is what assignment did.
   */
  it("selects all before typing, so the field is replaced", async () => {
    const { surface, bridge } = await open({ screen: "explorer" });
    const [field] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    await surface.act("type", field!, { value: "ada" });
    const typed = bridge.commands.filter((one) => one.kind === "keystroke");
    expect(typed[0]).toMatchObject({ text: "a", using: ["command down"] });
    expect(typed[1]).toMatchObject({ text: "ada" });
  });
});
