/**
 * The UIA adapter as an `AgentSurface`, against the app's recorded trees (T6.1,
 * REQ-ADP-6, REQ-SURF-1, 4, 5).
 *
 * The bridge is injected, so this drives the whole adapter without Windows.
 * What it cannot prove is that `powershellBridge` reads a real UIA tree
 * correctly; that is the live gate `docs/spec/progress/phase-6.md` records.
 */
import { describe, expect, it } from "vitest";
import {
  ActionabilityError,
  DataError,
  LocateError,
  SessionError,
  TimeoutError,
  UnsupportedError,
} from "@svatah/yam-surface";
import {
  escapeSendKeys,
  sendKeysFor,
  UiaSurface,
  UIA_CAPABILITIES,
  type UiaNode,
} from "../src/index.js";
import { recordedBridge, type RecordedBridge } from "./recorded.js";

async function open(
  options: Parameters<typeof recordedBridge>[0] = {},
): Promise<{ surface: UiaSurface; bridge: RecordedBridge }> {
  const bridge = recordedBridge({ screen: "record", ...options });
  const surface = new UiaSurface({ processName: "Yam", bridge });
  await surface.open({ kind: "desktop", processName: "Yam" } as never);
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
     * level than Yam.
     */
    const bridge = recordedBridge({
      availability: {
        state: "unavailable",
        advice: "`UIAutomationClient` would not load; check Constrained Language Mode.",
      },
    });
    const surface = new UiaSurface({ processName: "Yam", bridge });
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(SessionError);
    await expect(surface.open({ kind: "desktop" } as never)).rejects.toThrow(
      /not reachable \(unavailable\).*yam surface doctor/s,
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
    expect(described.native?.["controlPath"]).toContain("Window[Yam]");
    expect(described.rolePath[0]).toBe("window");
  });

  it("gives the fingerprint an element's classes, which Chromium publishes as ClassName (LLD §6.4)", async () => {
    /*
     * The recorded trees carry Chromium's window class on every node, which is
     * not what a real Windows host answers: the runner's trace reads
     * `sv-rail-item sv-rail-active` on the Flows rail row. One node is given
     * that here.
     */
    const recorded = recordedBridge({ screen: "record" });
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        const window = await recorded.window(request);
        return {
          ...window,
          nodes: window.nodes.map((one) =>
            one.automationId === "rail-runs" ? { ...one, className: "sv-rail-item sv-rail-active css-1x2y3z" } : one,
          ),
        };
      },
    };
    const surface = new UiaSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);

    const [runs] = await surface.locate({ by: "automationId", value: "rail-runs", score: 1 });
    expect((await surface.describe(runs!)).native?.["stableClasses"]).toBe("sv-rail-item sv-rail-active");
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
    expect(
      await surface.locate({ by: "name", value: "Record review", nth: 1, score: 1 }),
    ).toEqual([all[1]]);
  });

  it("refuses a reference the current snapshot does not have", async () => {
    const { surface } = await open();
    await expect(surface.describe("r99999")).rejects.toThrow(LocateError);
  });
});

describe("act through UIA patterns (LLD §7.5)", () => {
  it("invokes a button through InvokePattern", async () => {
    const { surface, bridge } = await open();
    /*
     * A rail row, not "Stop recording": that button is *disabled* on a Record
     * screen with no session open, and an adapter is right to refuse a click on
     * a disabled control (the case below is about exactly that refusal).
     */
    const [ref] = await surface.locate({ by: "automationId", value: "rail-runs", score: 1 });
    await surface.act("click", ref!);
    expect(bridge.commands.filter((one) => one.kind === "pattern")).toEqual([
      { kind: "pattern", path: expect.any(Array), pattern: "Invoke", method: "Invoke" },
    ]);
  });

  it("selects a tab through SelectionItemPattern, because a tab has no Invoke", async () => {
    /*
     * The reason `invoke()` tries three patterns and not one. Pressing a tab
     * *selects* it; without `SelectionItem` a click on the Flows screen's view
     * tabs would fall through to the mouse for no reason at all.
     */
    const { surface, bridge } = await open({ screen: "flows" });
    // The Flows screen's three view tabs are the only tabs the app has (T10.3).
    const [ref] = await surface.locate({ by: "automationId", value: "plan", score: 1 });
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
    /*
     * The Surface explorer's intent field (T10.3): the one text field the app
     * has that a person types a sentence into, and the control REQ-BEH-4's
     * "every call records an intent" is about.
     */
    const { surface, bridge } = await open({ screen: "explorer" });
    const [ref] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    await surface.act("type", ref!, { value: "look at the booking page" });
    expect(bridge.commands).toContainEqual(
      expect.objectContaining({
        pattern: "Value",
        method: "SetValue",
        argument: "look at the booking page",
      }),
    );
    const [again] = await surface.locate({ by: "automationId", value: "explorer-intent", score: 1 });
    expect(await surface.read("value", again!)).toBe("look at the booking page");
  });

  it("refuses to act on a disabled element", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    const disabled = snapshot.nodes.find((node) => node.states.includes("disabled"))!;
    expect(disabled).toBeDefined();
    await expect(surface.act("click", disabled.ref)).rejects.toThrow(ActionabilityError);
  });

  it("says plainly that a desktop application has no navigation", async () => {
    // Unsupported, not a navigation that failed (SF-11): nothing was sent.
    const { surface, bridge } = await open();
    const before = bridge.commands.length;
    for (const action of ["navigate", "back", "forward", "refresh"] as const) {
      await expect(surface.act(action, undefined, { url: "/x" })).rejects.toThrow(UnsupportedError);
    }
    await expect(surface.read("url")).rejects.toThrow(UnsupportedError);
    await expect(surface.read("result")).rejects.toThrow(UnsupportedError);
    expect(bridge.commands.length).toBe(before);
  });

  it("refuses to drag, whatever the references, as unsupported rather than a timeout", async () => {
    const { surface } = await open();
    const snapshot = await surface.snapshot();
    await expect(
      surface.act("dragTo", snapshot.nodes[1]!.ref, {}, snapshot.nodes[2]!.ref),
    ).rejects.toThrow(UnsupportedError);
    await expect(surface.act("dragTo", "r99999", {}, "r99998")).rejects.toThrow(/cannot drag/);
    await expect(surface.act("upload", undefined, {})).rejects.toThrow(UnsupportedError);
  });

  it("refuses to deselect, rather than selecting what it was asked to deselect", async () => {
    /*
     * `deselectOption` shared `selectOption`'s code: expand the combo box, then
     * `SelectionItemPattern.Select()` on the named item — choosing the option
     * the caller wanted cleared. The bridge has no `RemoveFromSelection` to
     * send, so the answer is a refusal, and nothing is expanded on the way.
     */
    const { surface, bridge } = await open();
    const [gateway] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    const before = bridge.commands.length;
    await expect(
      surface.act("deselectOption", gateway!, { label: "anthropic" }),
    ).rejects.toThrow(UnsupportedError);
    await expect(
      surface.act("deselectOption", gateway!, { label: "anthropic" }),
    ).rejects.toThrow(/RemoveFromSelection/);
    expect(bridge.commands.slice(before)).toEqual([]);
  });

  it("refuses a predicate a window cannot answer as unsupported, not as a failed check", async () => {
    const { surface } = await open();
    await expect(
      surface.check({ kind: "urlContains", value: { kind: "literal", value: "/x" } }, "page"),
    ).rejects.toThrow(UnsupportedError);
    await expect(surface.check({ kind: "present" }, "dialog")).rejects.toThrow(UnsupportedError);
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
    expect(state).toEqual({ kind: "desktop", windowTitle: "Yam", windowIndex: 0 });
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

/**
 * `waitFor` with no reference waits for the window (SF-16).
 *
 * The loop that served both cases returned only when it found a reference, so
 * with none it re-read the window for its whole timeout and failed — however
 * early the words it was waiting for appeared.
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
    const recorded = recordedBridge({ screen: "record" });
    let title = "Yam";
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        return { ...(await recorded.window(request)), title };
      },
    };
    const surface = new UiaSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    setTimeout(() => {
      title = "Yam - scratch.yam";
    }, 150);
    await expect(
      surface.act("waitFor", undefined, { title: "scratch.yam", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("refuses a URL wait at once, and says what is missing when there is nothing to wait for", async () => {
    const { surface } = await open();
    const started = Date.now();
    await expect(
      surface.act("waitFor", undefined, { url: "/booking", timeoutMs: 5_000 }),
    ).rejects.toThrow(UnsupportedError);
    await expect(surface.act("waitFor", undefined, { timeoutMs: 5_000 })).rejects.toThrow(DataError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("still waits on a reference the way it did", async () => {
    const { surface } = await open();
    const [ref] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    await expect(surface.act("waitFor", ref!, { timeoutMs: 1_000 })).resolves.toEqual({ ok: true });
  });
});

/**
 * Gestures the bridge cannot make are refused, not reported as done (SF-11).
 *
 * `hover` and a `scrollIntoView` with no pattern answered `{ok: true}` having
 * done nothing, and `keyDown`/`keyUp` sent a whole key press.
 */
describe("no-op actions that reported success (SF-11)", () => {
  /** The Record screen, with the Gateway combo box's recorded node changed. */
  async function openWith(change: Partial<UiaNode>): Promise<{
    surface: UiaSurface;
    bridge: RecordedBridge;
  }> {
    const recorded = recordedBridge({ screen: "record" });
    const bridge: RecordedBridge = {
      ...recorded,
      async window(request) {
        const window = await recorded.window(request);
        return {
          ...window,
          nodes: window.nodes.map((node) =>
            node.automationId === "record-gateway" ? ({ ...node, ...change } as UiaNode) : node,
          ),
        };
      },
    };
    const surface = new UiaSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    return { surface, bridge };
  }
  const sent = (bridge: RecordedBridge) => bridge.commands.filter((one) => one.kind !== "activate");
  const gateway = async (surface: UiaSurface) =>
    (await surface.locate({ by: "automationId", value: "record-gateway", score: 1 }))[0];

  it("refuses to hover, and sends nothing", async () => {
    const { surface, bridge } = await open();
    await expect(surface.act("hover", await gateway(surface))).rejects.toThrow(UnsupportedError);
    expect(sent(bridge)).toEqual([]);
  });

  it("scrolls through ScrollItemPattern when the element has it", async () => {
    const { surface, bridge } = await openWith({
      patterns: ["Value", "ScrollItem"],
      box: [302, 2_000, 200, 28],
    });
    await expect(surface.act("scrollIntoView", await gateway(surface))).resolves.toEqual({ ok: true });
    expect(sent(bridge)).toEqual([
      { kind: "pattern", path: expect.any(Array), pattern: "Scroll", method: "ScrollIntoView" },
    ]);
  });

  it("answers ok without a pattern only for an element already inside the window", async () => {
    const { surface, bridge } = await open();
    // [302, 67, 200, 28] inside a 1280 by 860 window.
    await expect(surface.act("scrollIntoView", await gateway(surface))).resolves.toEqual({ ok: true });
    expect(sent(bridge)).toEqual([]);
  });

  it("refuses an element outside the window it has no pattern to scroll to", async () => {
    const { surface, bridge } = await openWith({ box: [302, 2_000, 200, 28] });
    const failure = await surface
      .act("scrollIntoView", await gateway(surface))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnsupportedError);
    expect((failure as Error).message).toMatch(/outside the window/);
    expect(sent(bridge)).toEqual([]);

    const boxless = await openWith({ box: undefined });
    await expect(
      boxless.surface.act("scrollIntoView", await gateway(boxless.surface)),
    ).rejects.toThrow(/publishes no bounding rectangle/);
  });

  it("refuses keyDown and keyUp rather than sending a whole press", async () => {
    const { surface, bridge } = await open();
    const ref = await gateway(surface);
    for (const action of ["keyDown", "keyUp"] as const) {
      await expect(surface.act(action, ref, { key: "Shift" })).rejects.toThrow(UnsupportedError);
    }
    expect(sent(bridge)).toEqual([]);
    await surface.act("press", undefined, { key: "Enter" });
    expect(sent(bridge)).toEqual([{ kind: "keys", text: sendKeysFor("Enter") }]);
  });
});

describe("a page wait's default is the configured step timeout", () => {
  it("waits as long as `timeoutMs` says when the step does not", async () => {
    const surface = new UiaSurface({
      processName: "Yam",
      bridge: recordedBridge({ screen: "record" }),
      timeoutMs: 250,
    });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    const failure = await surface
      .act("waitFor", undefined, { text: "No such words" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TimeoutError);
    expect((failure as Error).message).toMatch(/Waited 250 ms/);
  });
});

/**
 * A reference wait waits for the state it was asked for (pattern 19).
 *
 * The executor sends the step's predicate as `args.state`, and this adapter
 * ignored it: it re-read the window until some node sat at the reference's
 * index, which is at once.
 */
describe("waiting for an element to be in a state", () => {
  /** Drop nodes, and everything under them, and renumber the parents that remain. */
  function without(nodes: readonly UiaNode[], gone: (node: UiaNode) => boolean): UiaNode[] {
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
  const isGateway = (node: UiaNode): boolean => node.automationId === "record-gateway";
  const gatewayWith = (change: Partial<UiaNode>) => (nodes: UiaNode[]) =>
    nodes.map((node) => (isGateway(node) ? ({ ...node, ...change } as UiaNode) : node));

  async function changing(
    initial: (nodes: UiaNode[]) => UiaNode[] = (nodes) => nodes,
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
    const surface = new UiaSurface({ processName: "Yam", bridge, ...options });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);
    const [gateway] = await surface.locate({ by: "automationId", value: "record-gateway", score: 1 });
    return {
      surface,
      gateway: gateway!,
      show: (next: (nodes: UiaNode[]) => UiaNode[]) => {
        shape = next;
      },
    };
  }
  const later = (then: () => void): void => {
    setTimeout(then, 150);
  };

  it("waits for hidden — IsOffscreen — and not while the element is showing", async () => {
    const { surface, gateway, show } = await changing();
    await expect(
      surface.act("waitFor", gateway, { state: "hidden", timeoutMs: 300 }),
    ).rejects.toThrow(/to be hidden, and it is showing and enabled/);
    later(() => show(gatewayWith({ isOffscreen: true })));
    await expect(
      surface.act("waitFor", gateway, { state: "hidden", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("waits for visible on an element that is off screen", async () => {
    const { surface, gateway, show } = await changing(gatewayWith({ isOffscreen: true }));
    later(() => show((nodes) => nodes));
    await expect(
      surface.act("waitFor", gateway, { state: "visible", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("waits for enabled and for disabled from IsEnabled", async () => {
    const { surface, gateway, show } = await changing(gatewayWith({ isEnabled: false }));
    await expect(
      surface.act("waitFor", gateway, { state: "enabled", timeoutMs: 300 }),
    ).rejects.toThrow(/to be enabled, and it is showing and disabled/);
    await expect(
      surface.act("waitFor", gateway, { state: "disabled", timeoutMs: 300 }),
    ).resolves.toEqual({ ok: true });
    later(() => show((nodes) => nodes));
    await expect(
      surface.act("waitFor", gateway, { state: "enabled", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("waits for detached and attached by what the element is, not by its index", async () => {
    const moved = await changing();
    // Text ahead of it goes: every index after it moves, and the gateway is still there.
    moved.show((nodes) => without(nodes, (node) => node.name === "Record review"));
    await expect(
      moved.surface.act("waitFor", moved.gateway, { state: "detached", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);

    const going = await changing();
    later(() => going.show((nodes) => without(nodes, isGateway)));
    await expect(
      going.surface.act("waitFor", going.gateway, { state: "detached", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });

    const coming = await changing();
    coming.show((nodes) => without(nodes, isGateway));
    later(() => coming.show((nodes) => nodes));
    await expect(
      coming.surface.act("waitFor", coming.gateway, { state: "attached", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("refuses to answer about a deleted element with a look-alike that moved into its place", async () => {
    const twins = (nodes: UiaNode[]) =>
      nodes.map((node) =>
        node.automationId === "action-record-accept" || node.automationId === "action-record-repick"
          ? ({ ...node, automationId: undefined, name: "Accept" } as UiaNode)
          : node,
      );
    const { surface, show } = await changing(twins);
    const snapshot = await surface.snapshot();
    const first = snapshot.nodes.find((node) => node.role === "button" && node.name === "Accept")!;
    let removed = false;
    show((nodes) =>
      without(twins(nodes), (node) => {
        if (removed || node.name !== "Accept") return false;
        removed = true;
        return true;
      }),
    );
    await expect(
      surface.act("waitFor", first.ref, { state: "detached", timeoutMs: 3_000 }),
    ).rejects.toThrow(LocateError);
  });

  it("refuses a state it does not know, naming the six", async () => {
    const { surface, gateway } = await changing();
    await expect(surface.act("waitFor", gateway, { state: "checked" })).rejects.toThrow(
      /attached, detached, visible, hidden, enabled or disabled/,
    );
    await expect(surface.act("waitFor", gateway, { state: "checked" })).rejects.toThrow(DataError);
  });

  it("waits for the step's timeoutMs, else the session's timeout", async () => {
    const { surface, gateway } = await changing(undefined, { timeoutMs: 250 });
    await expect(surface.act("waitFor", gateway, { state: "hidden" })).rejects.toThrow(/Waited 250 ms/);
    await expect(
      surface.act("waitFor", gateway, { state: "hidden", timeoutMs: 100 }),
    ).rejects.toThrow(/Waited 100 ms/);
  });
});
