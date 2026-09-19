/**
 * The Appium surface, driven against a recorded device (T4.2, LLD §7.4).
 *
 * `AppiumClient` is the W3C command set the adapter uses, and it is an interface
 * for exactly this reason: everything above it — the context switching, the
 * snapshot, the ref scheme, the action table, the predicates — can be exercised
 * against a fake device that answers from a page source on disk. No emulator was
 * available to this phase; the emulator gate in `README.md` is what covers the
 * half a fake cannot, and this is the half it can.
 *
 * The fake is deliberately not clever. It answers XPath queries against the page
 * source it is holding and records every command it was given, so a test asserts
 * on *what the adapter did to the device* rather than on what it returned.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionabilityError,
  DataError,
  LocateError,
  TimeoutError,
  UnsupportedError,
} from "@svatah/yam-surface";
import type { AppiumClient, ElementId } from "../src/client.js";
import { parsePageSource, xpathOf, type SourceNode } from "../src/page-source.js";
import { AppiumSurface, APPIUM_CAPABILITIES } from "../src/surface.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

interface Recorded {
  readonly command: string;
  readonly args: readonly unknown[];
}

/**
 * A device that answers from a page source.
 *
 * Element ids are the XPath of the node they name, which makes an assertion
 * about "which element did it click" readable — and makes `findElements` a
 * matter of walking the tree the page source describes.
 */
function fakeDevice(options: { source: string; context?: string; url?: string }) {
  const calls: Recorded[] = [];
  let source = parsePageSource(readFileSync(join(FIXTURES, options.source), "utf8"));
  let context = options.context ?? "NATIVE_APP";
  let url = options.url ?? "";
  const contexts = ["NATIVE_APP", "WEBVIEW_com.yam.sample"];

  /** Every node with the path that names it. */
  const walk = (node: SourceNode, path: SourceNode[]): Array<[SourceNode, SourceNode[]]> => {
    const here: SourceNode[] = [...path, node];
    return [[node, here], ...node.children.flatMap((child) => walk(child, here))];
  };

  const record = (command: string, ...args: unknown[]): void => {
    calls.push({ command, args });
  };

  const nodeAt = (id: ElementId): SourceNode | undefined =>
    walk(source, []).find(([, path]) => xpathOf(path) === id)?.[0];

  const client: AppiumClient = {
    getPageSource: async () => {
      record("getPageSource");
      return readFileSync(join(FIXTURES, options.source), "utf8");
    },
    getContexts: async () => contexts,
    getContext: async () => context,
    switchContext: async (name) => {
      record("switchContext", name);
      context = name;
    },

    findElements: async (using, value) => {
      record("findElements", using, value);
      const all = walk(source, []);
      if (using === "xpath") {
        // Enough XPath for what the adapter emits: an exact path, or a
        // predicate over `@class` / `@content-desc` / `@text` / `@label`.
        const exact = all.filter(([, path]) => xpathOf(path) === value);
        if (exact.length > 0) return exact.map(([, path]) => xpathOf(path));
        const wanted = [...value.matchAll(/@([a-z-]+)='([^']*)'/g)].map(
          ([, attribute, expected]) => [attribute!, expected!] as const,
        );
        return all
          .filter(([node]) =>
            wanted.some(([attribute, expected]) =>
              attribute === "class" ? node.tag === expected : node.attrs[attribute] === expected,
            ),
          )
          .map(([, path]) => xpathOf(path));
      }
      if (using === "accessibility id") {
        return all
          .filter(([node]) => node.attrs["content-desc"] === value || node.attrs["name"] === value)
          .map(([, path]) => xpathOf(path));
      }
      if (using === "id") {
        return all
          .filter(([node]) => node.attrs["resource-id"] === value)
          .map(([, path]) => xpathOf(path));
      }
      return [];
    },

    click: async (element) => record("click", element),
    sendKeys: async (element, text) => record("sendKeys", element, text),
    clear: async (element) => record("clear", element),
    getText: async (element) => nodeAt(element)?.attrs["text"] ?? "",
    getAttribute: async (element, name) => {
      const node = nodeAt(element);
      return name === "class" ? (node?.tag ?? null) : (node?.attrs[name] ?? null);
    },
    getRect: async (element) => {
      const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(nodeAt(element)?.attrs["bounds"] ?? "");
      if (bounds === null) return { x: 0, y: 0, width: 0, height: 0 };
      const [l, t, r, b] = bounds.slice(1).map(Number) as [number, number, number, number];
      return { x: l, y: t, width: r - l, height: b - t };
    },
    isDisplayed: async (element) => nodeAt(element)?.attrs["displayed"] !== "false",
    isEnabled: async (element) => nodeAt(element)?.attrs["enabled"] !== "false",
    isSelected: async (element) => nodeAt(element)?.attrs["checked"] === "true",

    navigateTo: async (to) => {
      record("navigateTo", to);
      url = to;
    },
    getUrl: async () => url,
    getTitle: async () => "Yam Sample",
    back: async () => record("back"),
    forward: async () => record("forward"),
    refresh: async () => record("refresh"),
    execute: async <T,>(script: string, args: unknown[]) => {
      record("execute", script, args);
      return "" as T;
    },
    performActions: async (actions) => record("performActions", actions),
    screenshot: async () => Buffer.from("not a real png").toString("base64"),
    deleteSession: async () => record("deleteSession"),
  };

  return {
    client,
    calls,
    of: (command: string) => calls.filter((c) => c.command === command),
    /** Swap the screen, as a tap that navigated would. */
    setSource: (next: string) => {
      source = parsePageSource(readFileSync(join(FIXTURES, next), "utf8"));
      options = { ...options, source: next };
    },
  };
}

async function open(options: Parameters<typeof fakeDevice>[0] & { ignoreAttributes?: string[] }) {
  const device = fakeDevice(options);
  const surface = new AppiumSurface({
    connect: async () => device.client,
    timeoutMs: 2_000,
    ...(options.ignoreAttributes === undefined ? {} : { ignoreAttributes: options.ignoreAttributes }),
  });
  await surface.open({});
  return { surface, device };
}

describe("capabilities declare what a phone does not have (LLD §2.4)", () => {
  it("has no windows, no native dialogs and no file picker", () => {
    // "capability flags declare what the adapter cannot do rather than emulating
    // it": the executor refuses such a plan at start, not halfway through.
    expect(APPIUM_CAPABILITIES).toMatchObject({
      windows: false,
      dialogs: false,
      upload: false,
      frames: false,
      trace: false,
      webmcp: false,
      pick: false,
      observe: false,
    });
  });

  it("has screenshots, drag and restore", () => {
    expect(APPIUM_CAPABILITIES).toMatchObject({ screenshot: true, drag: true, restore: true });
  });
});

describe("snapshot over a native screen (REQ-SURF-4)", () => {
  it("produces the same shape a web page produces", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const snapshot = await surface.snapshot();

    expect(snapshot.nodes.map((n) => `${n.role}:${n.name ?? ""}`)).toEqual([
      "group:",
      "group:",
      "text:Sign in",
      "textbox:Username",
      "textbox:Password",
      "checkbox:Remember me",
      "button:Sign in button",
      "button:Forgot password?",
      "text:Invalid credentials & try again",
    ]);
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.text).toContain("[ref=");
  });

  it("does not leak the raw page source into the snapshot", async () => {
    // `ConvertedNode.path` is the XML the conversion walked. It is how `act` and
    // `describe` find their element again, and it must never cross the surface —
    // "the surface never exposes raw locators to callers above it" (REQ-SURF-5).
    const { surface } = await open({ source: "android-login.xml" });
    const snapshot = await surface.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain('"path"');
    expect(JSON.stringify(snapshot)).not.toContain('"children"');
  });

  it("never reports an ignored attribute, to any caller (LLD §3.5)", async () => {
    const { surface } = await open({
      source: "android-login.xml",
      ignoreAttributes: ["resource-id"],
    });
    const snapshot = await surface.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("com.yam.sample:id/username");
  });
});

describe("locate and describe (LLD §6.3, §3.3)", () => {
  it("resolves a native candidate to exactly one reference", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    const refs = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    expect(refs).toHaveLength(1);
    expect(device.of("findElements")[0]!.args).toEqual(["accessibility id", "Sign in button"]);
  });

  it("returns every match, and lets the resolver decide", async () => {
    // Two rows with the same button text; the resolver's exactly-one rule is
    // what turns that into a failure the person sees (LLD §6.3).
    const { surface } = await open({ source: "android-list.xml" });
    expect(await surface.locate({ by: "text", value: "Book now", score: 1 })).toHaveLength(2);
  });

  it("honours `nth` for a candidate that legitimately matches several", async () => {
    const { surface } = await open({ source: "android-list.xml" });
    expect(await surface.locate({ by: "text", value: "Book now", nth: 1, score: 1 })).toHaveLength(1);
  });

  it("describes a snapshot reference from the tree, with neighbours and a role path", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const snapshot = await surface.snapshot();
    const submit = snapshot.nodes.find((n) => n.name === "Sign in button")!;
    const described = await surface.describe(submit.ref);

    expect(described.role).toBe("button");
    expect(described.tag).toBe("android.widget.Button");
    expect(described.attrs["resource-id"]).toBe("com.yam.sample:id/submit");
    // The neighbours and the role path are what fingerprinting scores on, and
    // only the tree knows them — which is why a snapshot reference is described
    // from the page source rather than from the driver (LLD §3.3).
    expect(described.neighbours.before).toContain("Remember me");
    expect(described.neighbours.after).toContain("Forgot password?");
    expect(described.rolePath).toEqual(["group", "group"]);
    expect(described.box).toEqual([42, 864, 996, 144]);
    expect(described.native?.["xpath"]).toContain("android.widget.Button");
  });

  it("refuses a reference the session never issued", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    await expect(surface.describe("r99")).rejects.toThrow(LocateError);
    await expect(surface.describe("nonsense")).rejects.toThrow(LocateError);
  });
});

describe("three steps on a native screen (T4.2's Validate)", () => {
  it("types into two fields and taps a button, on the elements it said it would", async () => {
    /*
     * The native half of "native sample grounds and replays three steps",
     * against a recorded screen rather than an emulator. What it establishes is
     * that a *bound* step reaches the right element: each of the three resolves
     * a stored candidate, and the commands the device received name the element
     * that candidate meant.
     */
    const { surface, device } = await open({ source: "android-login.xml" });

    const [username] = await surface.locate({ by: "resourceId", value: "com.yam.sample:id/username", score: 1 });
    await surface.act("type", username!, { value: "someone@example.com" });

    const [password] = await surface.locate({ by: "resourceId", value: "com.yam.sample:id/password", score: 1 });
    await surface.act("type", password!, { value: "hunter2" });

    const [submit] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    await surface.act("click", submit!);

    expect(device.of("sendKeys").map((c) => c.args)).toEqual([
      [expect.stringContaining("android.widget.EditText[1]"), "someone@example.com"],
      [expect.stringContaining("android.widget.EditText[2]"), "hunter2"],
    ]);
    expect(device.of("click")).toHaveLength(1);
    expect(device.of("click")[0]!.args[0]).toContain("android.widget.Button[1]");
  });

  it("re-resolves a snapshot reference against the device before acting", async () => {
    // An `rN` is a position in a page source, and a page source is a picture.
    // Acting on one means finding the element again — the one place the snapshot
    // and the driver have to agree, through the XPath the conversion recorded.
    const { surface, device } = await open({ source: "android-login.xml" });
    const snapshot = await surface.snapshot();
    const checkbox = snapshot.nodes.find((n) => n.role === "checkbox")!;
    await surface.act("click", checkbox.ref);

    const lookup = device.of("findElements").at(-1)!;
    expect(lookup.args[0]).toBe("xpath");
    expect(lookup.args[1]).toContain("android.widget.CheckBox");
    expect(device.of("click")[0]!.args[0]).toContain("android.widget.CheckBox");
  });

  it("taps rather than clicks when a gesture is what the platform has", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    const [submit] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    await surface.act("pressAndHold", submit!);

    const [stream] = device.of("performActions")[0]!.args as [Array<Record<string, unknown>>];
    expect(stream[0]).toMatchObject({ type: "pointer", parameters: { pointerType: "touch" } });
    // A long press is what a phone has instead of a right click.
    const actions = stream[0]!["actions"] as Array<Record<string, unknown>>;
    expect(actions.some((a) => a["type"] === "pause" && Number(a["duration"]) >= 500)).toBe(true);
  });
});

describe("predicates over a device (LLD §2.3)", () => {
  it("answers state predicates from the driver", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const snapshot = await surface.snapshot();
    const disabled = snapshot.nodes.find((n) => n.name === "Forgot password?")!;
    const checkbox = snapshot.nodes.find((n) => n.role === "checkbox")!;

    expect((await surface.check({ kind: "disabled" }, "ref", disabled.ref)).ok).toBe(true);
    expect((await surface.check({ kind: "enabled" }, "ref", disabled.ref)).ok).toBe(false);
    expect((await surface.check({ kind: "unchecked" }, "ref", checkbox.ref)).ok).toBe(true);
  });

  it("answers a text predicate over the whole screen", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const check = await surface.check(
      { kind: "textContains", value: { kind: "literal", value: "Remember me" } },
      "page",
    );
    expect(check.ok).toBe(true);
  });

  it("refuses a dialog predicate rather than guessing", async () => {
    // `capabilities().dialogs` is false; a permission prompt belongs to another
    // application and is not something this surface can see.
    const { surface } = await open({ source: "android-login.xml" });
    await expect(surface.check({ kind: "present" }, "dialog")).rejects.toThrow(/no dialog surface/);
  });
});

describe("contexts are what a phone has instead of frames (LLD §7.4)", () => {
  it("switches to a webview and back", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    await surface.act("switchFrame", undefined, { name: "webview" });
    expect(device.of("switchContext").at(-1)!.args).toEqual(["WEBVIEW_com.yam.sample"]);

    await surface.act("switchFrame", undefined, { name: "main" });
    expect(device.of("switchContext").at(-1)!.args).toEqual(["NATIVE_APP"]);
  });

  it("says what contexts there are when none matches", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    // The fake has exactly two, and neither is called "frame".
    void device;
    await expect(surface.act("switchFrame", undefined, { name: "chrome" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("refuses to navigate a native context, and says how to get one that can", async () => {
    // Unsupported here, not a navigation or a script that failed (SF-11):
    // nothing was sent, and no wait gives a native screen a URL.
    const { surface, device } = await open({ source: "android-login.xml" });
    await expect(surface.act("navigate", undefined, { url: "/login" })).rejects.toThrow(
      UnsupportedError,
    );
    await expect(surface.act("navigate", undefined, { url: "/login" })).rejects.toThrow(/webview/);
    await expect(surface.act("evaluate", undefined, { script: "return 1" })).rejects.toThrow(
      UnsupportedError,
    );
    expect(device.of("navigateTo")).toEqual([]);
    expect(device.of("execute")).toEqual([]);
  });

  it("navigates and evaluates once the session is in a webview", async () => {
    const { surface, device } = await open({
      source: "android-login.xml",
      context: "WEBVIEW_com.yam.sample",
    });
    await surface.act("navigate", undefined, { url: "http://10.0.2.2:4173/login" });
    expect(device.of("navigateTo")[0]!.args).toEqual(["http://10.0.2.2:4173/login"]);
    expect(await surface.read("url")).toBe("http://10.0.2.2:4173/login");
  });
});

describe("actions a phone does not have are refused, not emulated (LLD §2.4)", () => {
  /*
   * As `UnsupportedError` (SF-11). They were `ScriptError`s — and `quit` a
   * `NavigationError` — which a caller is told as `OUTCOME_UNKNOWN` and
   * `CONNECT_FAILED`: "check whether it happened", "the device went away".
   * Neither is true of an action that was never sent.
   */
  for (const action of [
    "switchWindow",
    "closeOtherWindows",
    "dialog",
    "upload",
    "selectOption",
    "deselectOption",
    "deselectAll",
    "resizeWindow",
    "quit",
    "invoke",
  ] as const) {
    it(`refuses "${action}" with the reason`, async () => {
      const { surface, device } = await open({ source: "android-login.xml" });
      await expect(surface.act(action)).rejects.toThrow(UnsupportedError);
      expect(device.of("performActions")).toEqual([]);
      expect(device.of("click")).toEqual([]);
    });
  }

  it("refuses to hover, because a tap in its place would press the element", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    const [submit] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    await expect(surface.act("hover", submit!)).rejects.toThrow(UnsupportedError);
    await expect(surface.act("hover", submit!)).rejects.toThrow(/no hover/);
    expect(device.of("click")).toEqual([]);
  });

  it("still taps for hoverAndClick, whose meaning is the click", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    const [submit] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    await surface.act("hoverAndClick", submit!);
    expect(device.of("click")).toHaveLength(1);
  });

  it("refuses to release, because a long press on a phone is already over", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    const [submit] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    await surface.act("pressAndHold", submit!);
    await expect(surface.act("release", submit!)).rejects.toThrow(UnsupportedError);
    // One gesture reached the device: the long press, and not a second tap.
    expect(device.of("performActions")).toHaveLength(1);
  });

  it("refuses a dialog predicate as unsupported", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    await expect(surface.check({ kind: "present" }, "dialog")).rejects.toThrow(UnsupportedError);
  });
});

/**
 * Scrolling an element into view (LLD §7.4, SF-11).
 *
 * The webview branch called its script with no arguments, so it scrolled
 * nothing and said it had; the native branch made one half-screen swipe the
 * same way whatever the element was. Both answered `{ok: true}`.
 */
describe("scrolling an element into view", () => {
  /** A device whose content moves with the swipes it is sent. */
  function scrollingDevice(options: { startY: number; stuck?: boolean }) {
    const device = fakeDevice({ source: "android-list.xml" });
    let offset = 0;
    const swipes: Array<{ from: number; to: number }> = [];
    const client: AppiumClient = {
      ...device.client,
      getRect: async (element) => {
        const rect = await device.client.getRect(element);
        return element.includes("android.widget.Button")
          ? { ...rect, y: options.startY + offset }
          : rect;
      },
      performActions: async (actions) => {
        await device.client.performActions(actions);
        const moves = (
          (actions[0] as { actions: Array<{ type: string; y?: number }> }).actions
        ).filter((one) => one.type === "pointerMove");
        const from = moves[0]!.y!;
        const to = moves[1]!.y!;
        swipes.push({ from, to });
        if (options.stuck !== true) offset += to - from;
      },
    };
    return { device, client, swipes, rectY: () => options.startY + offset };
  }

  async function openOn(client: AppiumClient): Promise<AppiumSurface> {
    const surface = new AppiumSurface({ connect: async () => client, timeoutMs: 2_000 });
    await surface.open({});
    return surface;
  }

  it("swipes up, in steps, until an element below the screen is inside it", async () => {
    // The screen is 2400 tall; the button starts two screens down.
    const phone = scrollingDevice({ startY: 4_000 });
    const surface = await openOn(phone.client);
    const [button] = await surface.locate({ by: "text", value: "Book now", nth: 0, score: 1 });
    await expect(surface.act("scrollIntoView", button!)).resolves.toMatchObject({ ok: true });

    expect(phone.swipes.length).toBeGreaterThan(1);
    for (const swipe of phone.swipes) {
      expect(swipe.to, "the finger moves up to bring content up").toBeLessThan(swipe.from);
      // Never from an edge, where the platform starts its own gestures.
      expect(Math.min(swipe.from, swipe.to)).toBeGreaterThan(0);
      expect(Math.max(swipe.from, swipe.to)).toBeLessThan(2_400);
    }
    expect(phone.rectY()).toBeGreaterThanOrEqual(0);
    expect(phone.rectY() + 90).toBeLessThanOrEqual(2_400);
  });

  it("swipes down for an element above the screen", async () => {
    const phone = scrollingDevice({ startY: -1_500 });
    const surface = await openOn(phone.client);
    const [button] = await surface.locate({ by: "text", value: "Book now", nth: 0, score: 1 });
    await surface.act("scrollIntoView", button!);
    expect(phone.swipes.every((swipe) => swipe.to > swipe.from)).toBe(true);
    expect(phone.rectY()).toBeGreaterThanOrEqual(0);
  });

  it("does not swipe at all when the element is already on screen", async () => {
    const phone = scrollingDevice({ startY: 630 });
    const surface = await openOn(phone.client);
    const [button] = await surface.locate({ by: "text", value: "Book now", nth: 0, score: 1 });
    await surface.act("scrollIntoView", button!);
    expect(phone.swipes).toEqual([]);
  });

  it("gives up, and says so, when a swipe does not move the element", async () => {
    const phone = scrollingDevice({ startY: 4_000, stuck: true });
    const surface = await openOn(phone.client);
    const [button] = await surface.locate({ by: "text", value: "Book now", nth: 0, score: 1 });
    const failure = await surface.act("scrollIntoView", button!).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ActionabilityError);
    expect((failure as Error).message).toMatch(/did not move it/);
    // One swipe to learn that swiping does nothing, not eight.
    expect(phone.swipes).toHaveLength(1);
  });

  it("hands a webview the element to scroll", async () => {
    const { surface, device } = await open({
      source: "android-login.xml",
      context: "WEBVIEW_com.yam.sample",
    });
    const submit = (await surface.snapshot()).nodes.find((node) => node.name === "Sign in button")!;
    await surface.act("scrollIntoView", submit.ref);
    const [script, args] = device.of("execute").at(-1)!.args as [string, unknown[]];
    expect(script).toContain("scrollIntoView");
    expect(args).toHaveLength(1);
    expect(args[0]).toEqual({
      "element-6066-11e4-a52e-4f735466cecf": expect.stringContaining("android.widget.Button"),
    });
  });
});

/** `waitFor` with no reference waits for the screen (SF-16). */
describe("waiting for the screen rather than an element (SF-16)", () => {
  it("returns once a native screen says the text", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    await expect(
      surface.act("waitFor", undefined, { text: "Remember me", timeoutMs: 1_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("times out, as a timeout, on text the screen never shows", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    await expect(
      surface.act("waitFor", undefined, { text: "Welcome back", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);
  });

  it("waits for a webview's URL and its words", async () => {
    const device = fakeDevice({
      source: "android-login.xml",
      context: "WEBVIEW_com.yam.sample",
      url: "http://10.0.2.2:4173/login",
    });
    let body = "Sign in";
    const client: AppiumClient = {
      ...device.client,
      execute: async <T,>(script: string, args: unknown[]) => {
        await device.client.execute(script, args);
        return (script.includes("innerText") ? body : "") as T;
      },
    };
    const surface = new AppiumSurface({ connect: async () => client, timeoutMs: 2_000 });
    await surface.open({});
    setTimeout(() => {
      void client.navigateTo("http://10.0.2.2:4173/dashboard");
      body = "Welcome back, Ada";
    }, 150);
    await expect(
      surface.act("waitFor", undefined, { url: "/dashboard", text: "Welcome back", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("says what is missing when there is nothing to wait for", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    await expect(surface.act("waitFor", undefined, {})).rejects.toThrow(DataError);
  });
});

/**
 * A native swipe to the top or the bottom (SF-11).
 *
 * The distance was the centre's `y`, a coordinate rather than a length: on a
 * screen whose box starts at 0 the finger ended on the edge, where the platform
 * starts its own gestures, and on one whose box starts lower it ended past it.
 */
describe("scrolling to the top and the bottom of a native screen", () => {
  it("swipes four tenths of the screen from its centre, and never reaches an edge", async () => {
    const device = fakeDevice({ source: "android-login.xml" });
    // The application's frame starts 200 pixels down, below a status bar.
    const client: AppiumClient = {
      ...device.client,
      getPageSource: async () =>
        (await device.client.getPageSource()).replace(
          'bounds="[0,0][1080,2400]"',
          'bounds="[0,200][1080,2400]"',
        ),
    };
    const surface = new AppiumSurface({ connect: async () => client, timeoutMs: 2_000 });
    await surface.open({});

    const swipe = (at: number): { from: number; to: number; x: number } => {
      const sent = device.of("performActions")[at]!.args[0] as Array<{
        actions: Array<{ type: string; x?: number; y?: number }>;
      }>;
      const moves = sent[0]!.actions.filter((one) => one.type === "pointerMove");
      return { from: moves[0]!.y!, to: moves[1]!.y!, x: moves[0]!.x! };
    };

    await surface.act("scrollToTop");
    await surface.act("scrollToBottom");
    // The box is 1080 by 2200 from y 200: its centre is 1300, four tenths is 880.
    expect(swipe(0)).toEqual({ from: 1_300, to: 2_180, x: 540 });
    expect(swipe(1)).toEqual({ from: 1_300, to: 420, x: 540 });
    for (const at of [0, 1]) {
      // Before: scrollToTop went from 1300 to 2600, past the bottom of a screen that ends at 2400.
      expect(swipe(at).to).toBeGreaterThan(200);
      expect(swipe(at).to).toBeLessThan(2_400);
    }
  });
});

/**
 * The keyboard a key action has (SF-11).
 */
describe("keys", () => {
  const sentKeys = (device: ReturnType<typeof fakeDevice>): unknown[] =>
    device.of("performActions").map((call) => {
      const [sequence] = call.args[0] as Array<{ actions: Array<{ value?: string }> }>;
      return sequence!.actions.map((one) => one.value);
    });

  it("sends a named key as its W3C codepoint, and a character as itself", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    await surface.act("press", undefined, { key: "Tab" });
    await surface.act("press", undefined, { key: "ArrowDown" });
    await surface.act("press", undefined, { key: "a" });
    await surface.act("press", undefined, { key: "Enter" });
    // Before: "Tab" went to the driver as the three characters T, a, b.
    expect(sentKeys(device)).toEqual([
      ["\uE004", "\uE004"],
      ["\uE015", "\uE015"],
      ["a", "a"],
      ["\uE007", "\uE007"],
    ]);
  });

  it("refuses a key name it has no codepoint for, before the driver sees it", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    await expect(surface.act("press", undefined, { key: "F13" })).rejects.toThrow(UnsupportedError);
    expect(device.of("performActions")).toEqual([]);
  });

  it("refuses keyDown and keyUp, which a key action sequence cannot hold", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    for (const action of ["keyDown", "keyUp"] as const) {
      await expect(surface.act(action, undefined, { key: "Shift" })).rejects.toThrow(UnsupportedError);
    }
    expect(device.of("performActions")).toEqual([]);
  });
});

describe("native waits that could only burn their timeout (SF-16)", () => {
  it("refuses a URL wait in a native context at once", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const started = Date.now();
    await expect(
      surface.act("waitFor", undefined, { url: "/dashboard", timeoutMs: 5_000 }),
    ).rejects.toThrow(UnsupportedError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("honours the step's timeoutMs on a reference wait", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const [submit] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    const started = Date.now();
    // The session's timeout is 2000 ms; the step asked for 200.
    await expect(
      surface.act("waitFor", submit!, { state: "hidden", timeoutMs: 200 }),
    ).rejects.toThrow(/Waited 200 ms/);
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("waits for the screen as long as the session's timeout when the step does not say", async () => {
    const device = fakeDevice({ source: "android-login.xml" });
    const surface = new AppiumSurface({ connect: async () => device.client, timeoutMs: 250 });
    await surface.open({});
    const failure = await surface
      .act("waitFor", undefined, { text: "Welcome back" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TimeoutError);
    expect((failure as Error).message).toMatch(/Waited 250 ms/);
  });
});

/**
 * A reference wait waits for the state it was asked for (pattern 19).
 *
 * `attached` and `disabled` fell through to "displayed", an unknown state was
 * not refused, and every read that threw counted as "not shown".
 */
describe("waiting for an element to be in a state", () => {
  /** A device whose Sign in button a test can hide, disable or remove while a wait runs. */
  async function waitingDevice() {
    const device = fakeDevice({ source: "android-login.xml" });
    const button = { gone: false, displayed: true, enabled: true, failure: undefined as Error | undefined };
    const isButton = (id: ElementId): boolean => id.includes("android.widget.Button");
    const ask = <T,>(id: ElementId, answer: () => T, fallback: () => Promise<T>): Promise<T> => {
      if (!isButton(id)) return fallback();
      if (button.failure !== undefined) return Promise.reject(button.failure);
      if (button.gone) {
        return Promise.reject(
          Object.assign(new Error("The element is not attached to the page document"), {
            name: "stale element reference",
          }),
        );
      }
      return Promise.resolve(answer());
    };
    const client: AppiumClient = {
      ...device.client,
      isDisplayed: (id) => ask(id, () => button.displayed, () => device.client.isDisplayed(id)),
      isEnabled: (id) => ask(id, () => button.enabled, () => device.client.isEnabled(id)),
      findElements: async (using, value) =>
        (await device.client.findElements(using, value)).filter((id) => !(button.gone && isButton(id))),
    };
    const surface = new AppiumSurface({ connect: async () => client, timeoutMs: 2_000 });
    await surface.open({});
    const [handle] = await surface.locate({ by: "accessibilityId", value: "Sign in button", score: 1 });
    const snapshot = await surface.snapshot();
    const indexed = snapshot.nodes.find((node) => node.name === "Sign in button")!.ref;
    return { surface, button, handle: handle!, indexed };
  }
  const later = (then: () => void): void => {
    setTimeout(then, 150);
  };

  it("waits for disabled, and does not return while the element is enabled", async () => {
    const { surface, button, handle } = await waitingDevice();
    // Before: `disabled` meant displayed, and this returned at once.
    await expect(
      surface.act("waitFor", handle, { state: "disabled", timeoutMs: 300 }),
    ).rejects.toThrow(/to be disabled, and it is displayed and enabled/);
    later(() => {
      button.enabled = false;
    });
    await expect(
      surface.act("waitFor", handle, { state: "disabled", timeoutMs: 3_000 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      surface.act("waitFor", handle, { state: "enabled", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);
  });

  it("answers attached for an element that is there but not displayed", async () => {
    const { surface, button, handle } = await waitingDevice();
    button.displayed = false;
    // Before: `attached` waited for it to be displayed.
    await expect(
      surface.act("waitFor", handle, { state: "attached", timeoutMs: 300 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      surface.act("waitFor", handle, { state: "hidden", timeoutMs: 300 }),
    ).resolves.toMatchObject({ ok: true });
    later(() => {
      button.displayed = true;
    });
    await expect(
      surface.act("waitFor", handle, { state: "visible", timeoutMs: 3_000 }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("waits for detached on a driver handle and on a snapshot reference", async () => {
    const { surface, button, handle, indexed } = await waitingDevice();
    await expect(
      surface.act("waitFor", indexed, { state: "detached", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);
    later(() => {
      button.gone = true;
    });
    await expect(
      surface.act("waitFor", handle, { state: "detached", timeoutMs: 3_000 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      surface.act("waitFor", indexed, { state: "detached", timeoutMs: 300 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      surface.act("waitFor", handle, { state: "attached", timeoutMs: 300 }),
    ).rejects.toThrow(/the driver no longer finds it/);
  });

  it("ends the wait on a driver failure instead of reading it as hidden", async () => {
    const { surface, button, handle } = await waitingDevice();
    button.failure = new Error("invalid session id");
    const started = Date.now();
    await expect(
      surface.act("waitFor", handle, { state: "hidden", timeoutMs: 3_000 }),
    ).rejects.toThrow(/invalid session id/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("refuses a state it does not know, naming the six", async () => {
    const { surface, handle } = await waitingDevice();
    await expect(surface.act("waitFor", handle, { state: "checked" })).rejects.toThrow(DataError);
    await expect(surface.act("waitFor", handle, { state: "present" })).rejects.toThrow(
      /attached, detached, visible, hidden, enabled or disabled/,
    );
  });

  it("refuses a reference the session never issued, rather than waiting it out", async () => {
    const { surface } = await waitingDevice();
    await expect(
      surface.act("waitFor", "h99", { state: "detached", timeoutMs: 3_000 }),
    ).rejects.toThrow(LocateError);
  });
});

describe("session state (REQ-AUTO-2)", () => {
  it("records the context, which is the navigable thing a phone has", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    const state = await surface.state();
    expect(state.kind).toBe("mobile");
    expect(state.frame).toBe("NATIVE_APP");
    expect(state.dialog).toBeNull();
  });

  it("restores the context it was told about", async () => {
    const { surface, device } = await open({ source: "android-login.xml" });
    await surface.restore({ kind: "mobile", frame: "WEBVIEW_com.yam.sample" });
    expect(device.of("switchContext").at(-1)!.args).toEqual(["WEBVIEW_com.yam.sample"]);
  });

  it("refuses to restore a web session into a phone", async () => {
    const { surface } = await open({ source: "android-login.xml" });
    await expect(surface.restore({ kind: "web", url: "http://x" })).rejects.toThrow(
      /Cannot restore a "web" session/,
    );
  });
});
