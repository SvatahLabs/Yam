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
  DataError,
  LocateError,
  PermissionError,
  SessionError,
  TimeoutError,
  UnsupportedError,
} from "@svatah/yam-surface";
import {
  AxBridgeError,
  AxSurface,
  AX_CAPABILITIES,
  keyChord,
  type AxNode,
} from "../src/index.js";
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
    // `PERMISSION_REQUIRED` to a caller, not `CONNECT_FAILED` (SF-14): the fix
    // is in System Settings, not in the application.
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(PermissionError);
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /Accessibility permission is not granted \(prompt-pending\)/,
    );
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /yam surface doctor/,
    );
  });

  it("refuses a host that is not macOS as unsupported, not as a missing permission (SF-14)", async () => {
    const bridge = recordedBridge({
      permission: {
        state: "unsupported",
        advice: "The macOS Accessibility adapter runs on macOS only. Use `--adapter uia` on Windows.",
      },
    });
    const surface = new AxSurface({ processName: "Yam", bridge });
    const failure = await surface.open({ kind: "desktop" } as never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnsupportedError);
    // Not System Settings: there is none to send anyone to.
    expect(failure).not.toBeInstanceOf(PermissionError);
    expect((failure as Error).message).toMatch(/--adapter uia/);
  });

  it("says what failed when the permission check itself did not answer (SF-14)", async () => {
    const bridge = recordedBridge({
      permission: {
        state: "unknown",
        advice: "Run `yam surface doctor --adapter ax` again.",
        detail:
          "the permission check did not answer within 5000 ms; macOS says the Accessibility " +
          "permission is granted",
      },
    });
    const surface = new AxSurface({ processName: "Yam", bridge });
    const failure = await surface.open({ kind: "desktop" } as never).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionError);
    expect(failure).not.toBeInstanceOf(PermissionError);
    expect((failure as Error).message).toMatch(/could not be checked.*did not answer within 5000 ms/s);
  });

  it("still calls a refused permission a permission", async () => {
    const bridge = recordedBridge({
      permission: { state: "denied", advice: "Switch it on and restart the program." },
    });
    const surface = new AxSurface({ processName: "Yam", bridge });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(PermissionError);
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

  it("gives the fingerprint an element's classes, without the generated ones (LLD §6.4)", async () => {
    /*
     * The recorded trees predate the class list, so two of their nodes are
     * given one here, the way Chromium publishes it.
     */
    const recorded = recordedBridge({ screen: "record" });
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        const window = await recorded.window(request);
        return {
          ...window,
          nodes: window.nodes.map((one) =>
            one.domIdentifier === "rail-runs"
              ? { ...one, domClassList: "sv-rail-item css-1x2y3z" }
              : one.domIdentifier === "rail-bindings"
                ? { ...one, domClassList: ":r3:" }
                : one,
          ),
        };
      },
    };
    const surface = new AxSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);

    const [runs] = await surface.locate({ by: "automationId", value: "rail-runs", score: 1 });
    expect((await surface.describe(runs!)).native?.["stableClasses"]).toBe("sv-rail-item");
    // Nothing left after the generated ones go is no class, not an empty one.
    const [bindings] = await surface.locate({ by: "automationId", value: "rail-bindings", score: 1 });
    expect((await surface.describe(bindings!)).native).not.toHaveProperty("stableClasses");
    // And the snapshot's shape is what it was: the fingerprint is the only reader.
    const snapshot = await surface.snapshot();
    expect(JSON.stringify(snapshot.nodes)).not.toContain("sv-rail-item");
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
    // Unsupported, not a navigation that failed (SF-11): nothing was sent, and
    // `CONNECT_FAILED` would send a caller to an application that is fine.
    const { surface, bridge } = await open();
    const before = bridge.commands.length;
    for (const action of ["navigate", "back", "forward", "refresh"] as const) {
      await expect(surface.act(action, undefined, { url: "/x" })).rejects.toThrow(UnsupportedError);
    }
    expect(bridge.commands.length).toBe(before);
  });

  it("says plainly that it cannot drag, rather than half-doing it", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    await expect(
      surface.act("dragTo", snapshot.nodes[1]!.ref, {}, snapshot.nodes[2]!.ref),
    ).rejects.toThrow(UnsupportedError);
    await expect(
      surface.act("dragTo", snapshot.nodes[1]!.ref, {}, snapshot.nodes[2]!.ref),
    ).rejects.toThrow(/cannot drag/);
    // Whatever the references are: a stale one must not turn "cannot drag"
    // into "the element is gone".
    await expect(surface.act("dragTo", "r99999", {}, "r99998")).rejects.toThrow(UnsupportedError);
    expect(AX_CAPABILITIES.drag).toBe(false);
  });

  it("refuses an action it has no row for as unsupported, not as a timeout", async () => {
    const { surface } = await open();
    await expect(surface.act("upload", undefined, {})).rejects.toThrow(UnsupportedError);
    await expect(surface.act("upload", undefined, {})).rejects.toThrow(/has no "upload"/);
  });

  it("refuses to deselect, rather than selecting what it was asked to deselect", async () => {
    /*
     * `deselectOption` shared `selectOption`'s code, so it pressed the pop-up
     * and then pressed the named item — choosing the very option the caller
     * wanted cleared, and answering `{ok: true}`. A macOS pop-up menu has no
     * deselected state to put it in, so the answer is a refusal, and nothing is
     * pressed on the way to it.
     */
    const { surface, bridge } = await open();
    const [gateway] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    const before = bridge.commands.length;
    await expect(
      surface.act("deselectOption", gateway!, { label: "anthropic" }),
    ).rejects.toThrow(UnsupportedError);
    await expect(
      surface.act("deselectOption", gateway!, { label: "anthropic" }),
    ).rejects.toThrow(/no deselected state/);
    expect(bridge.commands.slice(before)).toEqual([]);
  });
});

/** A session whose `screencapture` failed the way a missing grant makes it fail. */
async function screenshotting(granted: () => boolean | undefined): Promise<AxSurface> {
  const bridge = recordedBridge({
    screen: "record",
    onScreenshot: () => {
      throw new AxBridgeError(
        'No screenshot was written to "/tmp/app.png": `screencapture` exited 1.',
        "could not create image from display",
      );
    },
  });
  const surface = new AxSurface({ processName: "Yam", bridge, screenRecordingGranted: granted });
  await surface.open({ kind: "desktop", processName: "Yam" } as never);
  return surface;
}

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
    await expect(surface.read("url")).rejects.toThrow(UnsupportedError);
    await expect(surface.read("result")).rejects.toThrow(UnsupportedError);
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
    // Refused as unsupported (SF-11): a `CheckError` was told as CHECK_FAILED,
    // which is the failed assertion this refusal exists not to be.
    await expect(
      surface.check({ kind: "urlContains", value: { kind: "literal", value: "/x" } }, "page"),
    ).rejects.toThrow(UnsupportedError);
    await expect(surface.check({ kind: "present" }, "dialog")).rejects.toThrow(UnsupportedError);
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
    const surface = await screenshotting(() => false);
    await expect(surface.screenshot("/tmp/app.png")).rejects.toThrow(SessionError);
    await expect(surface.screenshot("/tmp/app.png")).rejects.toThrow(
      /No screenshot was written.*could not create image from display/s,
    );
    // And, macOS agreeing the grant is missing, it is the Screen Recording grant, said as one (SF-14).
    await expect(surface.screenshot("/tmp/app.png")).rejects.toThrow(PermissionError);
  });

  /*
   * The same words from a host with no display to capture (SF-14): a locked
   * screen, an SSH login. The regex alone sent a person with Screen Recording
   * granted to System Settings to grant it.
   */
  it("does not blame the grant for a display it could not capture when the grant is there", async () => {
    const surface = await screenshotting(() => true);
    const failure = await surface.screenshot("/tmp/app.png").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionError);
    expect(failure).not.toBeInstanceOf(PermissionError);
    expect((failure as Error).message).toMatch(/Screen Recording is granted.*locked screen/s);

    const unaskable = await screenshotting(() => undefined);
    const unknown = await unaskable.screenshot("/tmp/app.png").catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(SessionError);
    expect(unknown).not.toBeInstanceOf(PermissionError);
    expect((unknown as Error).message).toMatch(/could not be asked/);
  });

  it("does not blame a permission for a screenshot that failed for another reason", async () => {
    const { surface } = await open({
      onScreenshot: () => {
        throw new AxBridgeError(
          'No screenshot was written to "/tmp/app.png": `screencapture` did not finish within 20000 ms.',
        );
      },
    });
    const failure = await surface.screenshot("/tmp/app.png").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SessionError);
    expect(failure).not.toBeInstanceOf(PermissionError);
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

/**
 * `waitFor` with no reference waits for the window (SF-16).
 *
 * The loop that served both cases could only succeed when it was given a
 * reference, so a wait for words or a title re-read the window for its whole
 * timeout and then failed — on a window that had shown them from the first read.
 */
describe("waiting for the window rather than an element (SF-16)", () => {
  it("returns as soon as the window says the text", async () => {
    const { surface } = await open();
    await expect(
      surface.act("waitFor", undefined, { text: "Stop recording", timeoutMs: 1_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("waits for text that arrives after the wait began", async () => {
    const { surface, bridge } = await open();
    // "Run again" is on the Run screen and nowhere on Record.
    setTimeout(() => bridge.setScreen("run"), 150);
    await expect(
      surface.act("waitFor", undefined, { text: "Run again", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("times out, as a timeout, on text that never comes", async () => {
    const { surface } = await open();
    await expect(
      surface.act("waitFor", undefined, { text: "No such words", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);
  });

  it("waits for a title the window takes later", async () => {
    /*
     * `read("title")` answered from the last refresh, so a title wait — which
     * asks it until it matches — could never see the window change.
     */
    const recorded = recordedBridge({ screen: "record" });
    let title = "Yam";
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        return { ...(await recorded.window(request)), title };
      },
    };
    const surface = new AxSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    setTimeout(() => {
      title = "Yam — scratch.yam";
    }, 150);
    await expect(
      surface.act("waitFor", undefined, { title: "scratch.yam", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("refuses a URL wait at once, instead of spending the timeout on it", async () => {
    const { surface } = await open();
    const started = Date.now();
    await expect(
      surface.act("waitFor", undefined, { url: "/booking", timeoutMs: 5_000 }),
    ).rejects.toThrow(UnsupportedError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("says what is missing when there is nothing to wait for", async () => {
    const { surface } = await open();
    await expect(surface.act("waitFor", undefined, { timeoutMs: 5_000 })).rejects.toThrow(DataError);
  });

  it("still waits on a reference the way it did", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    await expect(surface.act("waitFor", ref!, { timeoutMs: 1_000 })).resolves.toEqual({ ok: true });
  });
});

/**
 * Gestures this bridge cannot make are refused, not reported as done (SF-11).
 *
 * `hover` and `scrollIntoView` answered `{ok: true}` having done nothing, and
 * `keyDown`/`keyUp` sent a whole key press — so a step passed and the failure
 * turned up later, somewhere that did not explain it.
 */
describe("no-op actions that reported success (SF-11)", () => {
  /** The Record screen, with one element's recorded node changed. */
  async function openWith(change: (node: AxNode) => AxNode): Promise<{
    surface: AxSurface;
    bridge: RecordedBridge;
  }> {
    const recorded = recordedBridge({ screen: "record" });
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        const window = await recorded.window(request);
        return { ...window, nodes: window.nodes.map(change) };
      },
    };
    const surface = new AxSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    return { surface, bridge };
  }
  const gateway = (change: Partial<AxNode>) => (node: AxNode): AxNode =>
    node.domIdentifier === "record-gateway" ? ({ ...node, ...change } as AxNode) : node;
  const sent = (bridge: RecordedBridge) => bridge.commands.filter((one) => one.kind !== "activate");

  it("refuses to hover, and sends nothing", async () => {
    const { surface, bridge } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    await expect(surface.act("hover", ref)).rejects.toThrow(UnsupportedError);
    await expect(surface.act("hover", ref)).rejects.toThrow(/cannot hover/);
    expect(sent(bridge)).toEqual([]);
  });

  it("performs AXScrollToVisible when the element lists it", async () => {
    const { surface, bridge } = await openWith(
      gateway({ actions: ["AXPress", "AXScrollToVisible"], box: [302, 2_000, 200, 28] }),
    );
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    await expect(surface.act("scrollIntoView", ref)).resolves.toEqual({ ok: true });
    expect(sent(bridge)).toEqual([
      { kind: "action", path: expect.any(Array), action: "AXScrollToVisible" },
    ]);
  });

  it("answers ok without an action only for an element already inside the window", async () => {
    const { surface, bridge } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    // [302, 67, 200, 28] inside a 1280 by 860 window.
    await expect(surface.act("scrollIntoView", ref)).resolves.toEqual({ ok: true });
    expect(sent(bridge)).toEqual([]);
  });

  it("refuses an element outside the window it has no way to scroll to", async () => {
    const { surface, bridge } = await openWith(gateway({ box: [302, 2_000, 200, 28] }));
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    const failure = await surface.act("scrollIntoView", ref).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnsupportedError);
    expect((failure as Error).message).toMatch(/outside the window/);
    expect(sent(bridge)).toEqual([]);

    const boxless = await openWith(gateway({ box: undefined }));
    const [again] = await boxless.surface.locate({
      by: "automationId",
      value: "record-gateway",
      score: 1,
    });
    await expect(boxless.surface.act("scrollIntoView", again)).rejects.toThrow(/publishes no box/);
  });

  it("refuses keyDown and keyUp rather than sending a whole press", async () => {
    const { surface, bridge } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    for (const action of ["keyDown", "keyUp"] as const) {
      await expect(surface.act(action, ref, { key: "Shift" })).rejects.toThrow(UnsupportedError);
    }
    // Refused before anything was focused, too.
    expect(sent(bridge)).toEqual([]);
    // `press` is still a press.
    await surface.act("press", undefined, { key: "Enter" });
    expect(sent(bridge)).toEqual([{ kind: "keycode", code: 36 }]);
  });
});

/**
 * The title of an application with no window open (SF-16).
 *
 * `read("title")` reads the window now, and a macOS application whose last
 * window closed — still running, still the session — made it throw where the
 * cached read used to answer.
 */
describe("the title when no window is open", () => {
  async function closing(reason: "no-window" | "no-process"): Promise<AxSurface> {
    const recorded = recordedBridge({ screen: "record" });
    let open = true;
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        if (!open) {
          throw new AxBridgeError(
            reason === "no-window"
              ? 'The process "Yam" has no window. Is it running, and not minimised?'
              : 'No application process is named "Yam". Is it running?',
            undefined,
            reason,
          );
        }
        return await recorded.window(request);
      },
    };
    const surface = new AxSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    open = false;
    return surface;
  }

  it("answers with the last title it saw while the application is running", async () => {
    const surface = await closing("no-window");
    expect(await surface.read("title")).toBe("Yam");
  });

  it("still throws for an application that has quit", async () => {
    const surface = await closing("no-process");
    await expect(surface.read("title")).rejects.toThrow(SessionError);
    await expect(surface.read("title")).rejects.toThrow(/No application process is named "Yam"/);
  });
});

describe("a page wait's default is the configured step timeout", () => {
  it("waits as long as `timeoutMs` says when the step does not", async () => {
    const surface = new AxSurface({
      processName: "Yam",
      bridge: recordedBridge({ screen: "record" }),
      timeoutMs: 250,
    });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    const started = Date.now();
    const failure = await surface
      .act("waitFor", undefined, { text: "No such words" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TimeoutError);
    expect((failure as Error).message).toMatch(/Waited 250 ms/);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

/**
 * A reference wait waits for the state it was asked for (pattern 19).
 *
 * The executor sends the step's predicate as `args.state`, and this adapter
 * ignored it: it re-read the window until some node sat at the reference's
 * index, which is at once — so `to be hidden` returned while the element was
 * showing and `to be enabled` returned on a disabled one.
 */
describe("waiting for an element to be in a state", () => {
  /** Drop nodes, and everything under them, and renumber the parents that remain. */
  function without(nodes: readonly AxNode[], gone: (node: AxNode) => boolean): AxNode[] {
    const dropped = new Set<number>();
    nodes.forEach((node, at) => {
      if (gone(node) || dropped.has(node.parent)) dropped.add(at);
    });
    const renumbered = new Map<number, number>();
    let next = 0;
    nodes.forEach((_, at) => {
      if (!dropped.has(at)) renumbered.set(at, next++);
    });
    return nodes
      .filter((_, at) => !dropped.has(at))
      .map((node) => ({ ...node, parent: node.parent < 0 ? -1 : renumbered.get(node.parent)! }));
  }
  const isGateway = (node: AxNode): boolean => node.domIdentifier === "record-gateway";
  const gatewayWith = (change: Partial<AxNode>) => (nodes: AxNode[]) =>
    nodes.map((node) => (isGateway(node) ? ({ ...node, ...change } as AxNode) : node));

  /** The Record screen, through a window a test can change while a wait is running. */
  async function changing(
    initial: (nodes: AxNode[]) => AxNode[] = (nodes) => nodes,
    options: { timeoutMs?: number } = {},
  ) {
    const recorded = recordedBridge({ screen: "record" });
    let shape = initial;
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        const window = await recorded.window(request);
        return { ...window, nodes: shape([...window.nodes]) };
      },
    };
    const surface = new AxSurface({ processName: "Yam", bridge, ...options });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    const [gateway] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    return {
      surface,
      gateway: gateway!,
      show: (next: (nodes: AxNode[]) => AxNode[]) => {
        shape = next;
      },
    };
  }
  const later = (then: () => void): void => {
    setTimeout(then, 150);
  };

  it("waits for hidden, and does not return while the element is showing", async () => {
    const { surface, gateway, show } = await changing();
    const failure = await surface
      .act("waitFor", gateway, { state: "hidden", timeoutMs: 300 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TimeoutError);
    expect((failure as Error).message).toMatch(/to be hidden, and it is showing and enabled/);

    later(() => show(gatewayWith({ box: [302, 67, 0, 0] })));
    await expect(surface.act("waitFor", gateway, { state: "hidden", timeoutMs: 3_000 })).resolves.toEqual({
      ok: true,
    });
  });

  it("waits for visible on an element that has no area yet", async () => {
    const { surface, gateway, show } = await changing(gatewayWith({ box: [302, 67, 0, 0] }));
    later(() => show((nodes) => nodes));
    await expect(surface.act("waitFor", gateway, { state: "visible", timeoutMs: 3_000 })).resolves.toEqual({
      ok: true,
    });
  });

  it("waits for enabled and for disabled from the element's own state", async () => {
    const { surface, gateway, show } = await changing(gatewayWith({ enabled: false }));
    await expect(
      surface.act("waitFor", gateway, { state: "enabled", timeoutMs: 300 }),
    ).rejects.toThrow(/to be enabled, and it is showing and disabled/);
    await expect(surface.act("waitFor", gateway, { state: "disabled", timeoutMs: 300 })).resolves.toEqual({
      ok: true,
    });
    later(() => show((nodes) => nodes));
    await expect(surface.act("waitFor", gateway, { state: "enabled", timeoutMs: 3_000 })).resolves.toEqual({
      ok: true,
    });
  });

  it("waits for detached and attached by what the element is, not by its index", async () => {
    const { surface, gateway, show } = await changing();
    // A heading ahead of it goes: every index after it moves, and the gateway is still there.
    show((nodes) =>
      without(nodes, (node) => node.role === "AXHeading" && node.description === "Record review"),
    );
    await expect(
      surface.act("waitFor", gateway, { state: "detached", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);

    const going = await changing();
    later(() => going.show((nodes) => without(nodes, isGateway)));
    await expect(
      going.surface.act("waitFor", going.gateway, { state: "detached", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });

    // Gone when the wait starts, and back while it runs.
    const coming = await changing();
    coming.show((nodes) => without(nodes, isGateway));
    later(() => coming.show((nodes) => nodes));
    await expect(
      coming.surface.act("waitFor", coming.gateway, { state: "attached", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });

    const never = await changing();
    never.show((nodes) => without(nodes, isGateway));
    await expect(
      never.surface.act("waitFor", never.gateway, { state: "attached", timeoutMs: 300 }),
    ).rejects.toThrow(/is not in the window/);
  });

  it("refuses to answer about a deleted element with a look-alike that moved into its place", async () => {
    // Two "Accept" buttons with no DOM id: only their position tells them apart.
    const twins = (nodes: AxNode[]) =>
      nodes.map((node) =>
        node.domIdentifier === "action-record-accept" || node.domIdentifier === "action-record-repick"
          ? ({ ...node, domIdentifier: undefined, description: "Accept" } as AxNode)
          : node,
      );
    const { surface, show } = await changing(twins);
    const snapshot = await surface.snapshot();
    const first = snapshot.nodes.find((node) => node.role === "button" && node.name === "Accept")!;
    let removed = false;
    show((nodes) =>
      without(twins(nodes), (node) => {
        if (removed || node.description !== "Accept") return false;
        removed = true;
        return true;
      }),
    );
    await expect(
      surface.act("waitFor", first.ref, { state: "detached", timeoutMs: 3_000 }),
    ).rejects.toThrow(LocateError);
  });

  it("refuses a state it does not know, naming the six, before reading anything", async () => {
    const { surface, gateway } = await changing();
    await expect(surface.act("waitFor", gateway, { state: "checked" })).rejects.toThrow(DataError);
    await expect(surface.act("waitFor", gateway, { state: "checked" })).rejects.toThrow(
      /attached, detached, visible, hidden, enabled or disabled/,
    );
  });

  it("waits for the step's timeoutMs, else the session's timeout", async () => {
    const { surface, gateway } = await changing(undefined, { timeoutMs: 250 });
    await expect(surface.act("waitFor", gateway, { state: "hidden" })).rejects.toThrow(/Waited 250 ms/);
    const started = Date.now();
    await expect(
      surface.act("waitFor", gateway, { state: "hidden", timeoutMs: 100 }),
    ).rejects.toThrow(/Waited 100 ms/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
