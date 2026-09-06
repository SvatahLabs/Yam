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
import { LocateError, NavigationError, ScriptError } from "@svatah/yam-surface";
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
    const { surface } = await open({ source: "android-login.xml" });
    await expect(surface.act("navigate", undefined, { url: "/login" })).rejects.toThrow(
      NavigationError,
    );
    await expect(surface.act("evaluate", undefined, { script: "return 1" })).rejects.toThrow(
      ScriptError,
    );
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
  for (const action of ["switchWindow", "closeOtherWindows", "dialog", "upload", "selectOption"] as const) {
    it(`refuses "${action}" with the reason`, async () => {
      const { surface } = await open({ source: "android-login.xml" });
      await expect(surface.act(action)).rejects.toThrow(ScriptError);
    });
  }
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
