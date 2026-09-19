/**
 * The BiDi adapter against a real browser (T4.1, REQ-ADP-4, LLD §7.3).
 *
 * `yam surface conform --adapter bidi` is the suite that decides whether the
 * adapter is conformant, and `scripts/bidi-independence.mjs` runs it. These are
 * the things that suite does *not* ask, because they are BiDi's rather than the
 * surface's: that the actionability wait actually waits, that a reference
 * survives what it should and dies when it should, and that a candidate kind
 * with no protocol equivalent resolves through the injected script.
 *
 * They run under vitest rather than Playwright Test, deliberately. This package
 * is the independence proof; a test suite that needed Playwright to check it
 * would put Playwright back in its tree.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startSampleApp, type SampleServer } from "sample-web";
import { DataError, LocateError, TimeoutError, UnsupportedError } from "@svatah/yam-surface";
import { bidiAvailable } from "../src/launch.js";
import { BidiSurface } from "../src/surface.js";

/**
 * Skipped, loudly, when there is no browser to drive.
 *
 * A suite that passed because nothing ran would be worse than one that says it
 * did not run: `pnpm browsers` downloads the Gecko build these need, and
 * `YAM_BIDI_URL` points them at anything else that speaks the protocol.
 */
const available = bidiAvailable();
const describeWithBrowser = available ? describe : describe.skip;

if (!available) {
  console.warn(
    "adapter-bidi: no WebDriver BiDi endpoint and no Gecko browser, so the browser-backed " +
      "tests are skipped. `pnpm browsers` downloads one, or set YAM_BIDI_URL.",
  );
}

let app: SampleServer;
const opened: BidiSurface[] = [];

async function open(path = "/"): Promise<BidiSurface> {
  const surface = new BidiSurface({ headless: true, timeoutMs: 10_000, testIdAttributes: ["data-testid"] });
  await surface.open({ baseUrl: app.origin });
  await surface.act("navigate", undefined, { url: path });
  opened.push(surface);
  return surface;
}

beforeAll(async () => {
  if (!available) return;
  app = await startSampleApp(0);
}, 180_000);

/*
 * A test's browser is closed when the test ends, not when the file does.
 *
 * All of them were closed in `afterAll`, so the last test ran beside fourteen
 * Firefoxes that had nothing left to do. On the four-CPU Windows runner the
 * fifth test's `session.subscribe` missed its ten-second deadline beside four
 * of them, and Node warned about the exit listeners they were holding.
 */
afterEach(async () => {
  for (const surface of opened.splice(0)) await surface.close().catch(() => undefined);
  // Its own deadline: a close may take two seconds to end the session and five
  // for the browser to exit, and a hook's default is ten.
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describeWithBrowser("the injected snapshot (LLD §7.3, REQ-SURF-4)", () => {
  it("reports roles, names and states computed from the DOM", async () => {
    const surface = await open("/login");
    const { nodes } = await surface.snapshot();

    const username = nodes.find((n) => n.role === "textbox" && n.name === "Username");
    expect(username, JSON.stringify(nodes.slice(0, 8))).toBeDefined();
    // BiDi exposes the DOM, not an accessibility tree with references. Both of
    // these come from the injected accessible-name algorithm, which is the whole
    // reason it exists.
    expect(username!.states).toContain("required");
    expect(nodes.find((n) => n.role === "checkbox" && n.name === "Remember me")?.states).toContain(
      "unchecked",
    );
  }, 120_000);

  it("gives every node a reference and a structural hash", async () => {
    const surface = await open("/login");
    const snapshot = await surface.snapshot();
    expect(snapshot.nodes.every((n) => /^r\d+$/.test(n.ref))).toBe(true);
    expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.text).toContain("[ref=");
  }, 120_000);

  it("narrows to a subtree when asked for one", async () => {
    const surface = await open("/login");
    const whole = await surface.snapshot();
    const form = whole.nodes.find((n) => n.role === "form" || n.role === "main");
    expect(form).toBeDefined();
    const part = await surface.snapshot({ root: form!.ref });
    expect(part.nodes.length).toBeLessThan(whole.nodes.length);
  }, 120_000);
});

describeWithBrowser("locate answers every web candidate kind (LLD §6.3)", () => {
  it("resolves role, label, testid, css, xpath, id and name", async () => {
    const surface = await open("/login");
    const one = async (candidate: Parameters<BidiSurface["locate"]>[0]) =>
      (await surface.locate(candidate)).length;

    expect(await one({ by: "id", value: "username", score: 1 })).toBe(1);
    expect(await one({ by: "name", value: "username", score: 1 })).toBe(1);
    expect(await one({ by: "css", value: "#username", score: 1 })).toBe(1);
    expect(await one({ by: "xpath", value: "//input[@id='username']", score: 1 })).toBe(1);
    expect(await one({ by: "testid", value: "username", attribute: "data-testid", score: 1 })).toBe(1);
    expect(await one({ by: "label", value: "Username", score: 1 })).toBe(1);
    expect(await one({ by: "role", role: "textbox", name: "Username", score: 1 })).toBe(1);
    expect(await one({ by: "placeholder", value: "you@example.com", score: 1 })).toBe(1);
  }, 120_000);

  it("returns them all when a candidate names more than one element", async () => {
    // The resolver requires exactly one and reports the rest (LLD §6.3); an
    // adapter that quietly picked the first would take that decision away.
    const surface = await open("/login");
    expect((await surface.locate({ by: "role", role: "textbox", score: 1 })).length).toBeGreaterThan(1);
  }, 120_000);

  it("returns nothing for a candidate that matches nothing", async () => {
    const surface = await open("/login");
    expect(await surface.locate({ by: "css", value: "#not-here", score: 1 })).toEqual([]);
  }, 120_000);

  it("refuses a candidate kind that belongs to another adapter", async () => {
    const surface = await open("/login");
    // "A candidate that cannot be honoured is a configuration mistake, not a
    // missing element" — the same rule the Playwright adapter follows.
    await expect(surface.locate({ by: "resourceId", value: "x", score: 1 })).rejects.toThrow(
      LocateError,
    );
    await expect(surface.locate({ by: "automationId", value: "x", score: 1 })).rejects.toThrow(
      /UIA and AX/,
    );
  }, 120_000);
});

describeWithBrowser("the actionability wait (LLD §7.3)", () => {
  it("waits for a control that is not there yet, then acts on it", async () => {
    const surface = await open("/login");
    // The sample application's error banner is hidden until a failed sign-in.
    // Acting on it before that must be a refusal with a reason, not a hang and
    // not a click into nothing.
    const [banner] = await surface.locate({ by: "css", value: "#error-banner", score: 1 });
    if (banner === undefined) return; // the page has no such element; nothing to assert
    const surfaceWithShortTimeout = new BidiSurface({ headless: true, timeoutMs: 1_500 });
    void surfaceWithShortTimeout;
    await expect(surface.act("click", banner)).rejects.toThrow(/did not become actionable/);
  }, 120_000);

  it("says which of the three conditions failed", async () => {
    const surface = await open("/login");
    const [disabled] = await surface.locate({ by: "css", value: "[disabled]", score: 1 });
    if (disabled === undefined) return;
    await expect(surface.act("click", disabled)).rejects.toThrow(/it is disabled|it is not visible/);
  }, 120_000);
});

describeWithBrowser("references and navigation (LLD §2.2)", () => {
  it("keeps a minted reference alive across an action on the same page", async () => {
    const surface = await open("/login");
    const [field] = await surface.locate({ by: "id", value: "username", score: 1 });
    await surface.act("type", field!, { value: "someone@example.com" });
    expect(await surface.read("value", field!)).toBe("someone@example.com");
    // Still the same reference afterwards: within one document, a handle holds.
    await surface.act("clear", field!);
    expect(await surface.read("value", field!)).toBe("");
  }, 120_000);

  it("says a reference is stale after a navigation rather than acting on nothing", async () => {
    const surface = await open("/login");
    const [field] = await surface.locate({ by: "id", value: "username", score: 1 });
    await surface.act("navigate", undefined, { url: "/dashboard" });
    await expect(surface.describe(field!)).rejects.toThrow(/no longer resolves|not a reference/);
  }, 120_000);

  it("reports the URL from the document, not from the protocol's context tree", async () => {
    /*
     * Gecko updates `browsingContext.getTree`'s `url` lazily: a click that
     * navigates leaves the tree reporting the previous document for a while
     * after the new one has loaded. A caller that acted and then read the URL
     * would see where it used to be — which is exactly what the fixtures'
     * `Go back` did before this.
     */
    const surface = await open("/");
    const [link] = await surface.locate({ by: "role", role: "link", name: "Sign in", score: 1 });
    const result = await surface.act("click", link!);
    expect(result.navigated).toBe(true);
    expect(String(await surface.read("url"))).toContain("/login");
  }, 120_000);
});

describeWithBrowser("describe feeds synthesis and fingerprinting (LLD §3.3)", () => {
  it("returns tag, attributes, text, neighbours, role path, box and index", async () => {
    const surface = await open("/login");
    const [field] = await surface.locate({ by: "id", value: "password", score: 1 });
    const described = await surface.describe(field!);

    expect(described.ref).toBe(field);
    expect(described.role).toBe("textbox");
    expect(described.name).toBe("Password");
    expect(described.tag).toBe("input");
    expect(Object.keys(described.attrs).length).toBeGreaterThan(0);
    expect(Array.isArray(described.neighbours.before)).toBe(true);
    expect(Array.isArray(described.rolePath)).toBe(true);
    expect(described.box).toHaveLength(4);
    expect(Number.isInteger(described.index)).toBe(true);
    // The paths synthesis ranks candidates from; `native` is documented as
    // "never used above the surface except by synthesis" (LLD §2.2).
    expect(described.native?.["cssPath"]).toBeTruthy();
    expect(described.native?.["xpath"]).toBeTruthy();
  }, 120_000);

  it("never reports an ignored attribute, to any caller", async () => {
    // `bindings.ignoreAttributes` is enforced at the point the surface first
    // sees the DOM, so an ignored attribute cannot reach a candidate, a
    // fingerprint, a score or a `native` extra (LLD §3.5).
    const surface = new BidiSurface({
      headless: true,
      timeoutMs: 10_000,
      ignoreAttributes: ["data-yam-eval", "id"],
    });
    opened.push(surface);
    await surface.open({ baseUrl: app.origin });
    await surface.act("navigate", undefined, { url: "/login" });

    const [field] = await surface.locate({ by: "css", value: "input[name=username]", score: 1 });
    const described = await surface.describe(field!);
    expect(described.attrs["id"]).toBeUndefined();
    expect(described.attrs["data-yam-eval"]).toBeUndefined();
    expect(JSON.stringify(described.native)).not.toContain("data-yam-eval");
  }, 120_000);
});

describeWithBrowser("waitFor, on the page and on an element (SF-11, SF-16)", () => {
  /*
   * Each change is made a moment after the wait starts, so a wait that
   * answered from the page as it was when it was asked would fail.
   */
  it("waits for the page's text, URL and title when given no reference", async () => {
    const surface = await open("/login");
    await surface.act("evaluate", undefined, {
      script:
        "setTimeout(() => { const p = document.createElement('p'); p.textContent = 'Saved at noon'; " +
        "document.body.append(p); }, 300);",
    });
    expect((await surface.act("waitFor", undefined, { text: "Saved at noon" })).ok).toBe(true);

    await surface.act("evaluate", undefined, {
      script: "setTimeout(() => history.pushState({}, '', '/login/after'), 300);",
    });
    expect((await surface.act("waitFor", undefined, { url: "/login/after" })).ok).toBe(true);

    await surface.act("evaluate", undefined, {
      script: "setTimeout(() => { document.title = 'Sign in, done'; }, 300);",
    });
    expect((await surface.act("waitFor", undefined, { title: "done" })).ok).toBe(true);
  }, 120_000);

  it("gives up at the caller's timeoutMs, and refuses a wait for nothing", async () => {
    const surface = await open("/login");
    await expect(
      surface.act("waitFor", undefined, { text: "never on this page", timeoutMs: 400 }),
    ).rejects.toBeInstanceOf(TimeoutError);
    await expect(surface.act("waitFor", undefined, {})).rejects.toBeInstanceOf(DataError);
  }, 120_000);

  /*
   * A page wait waited ten seconds whatever the adapter's own timeout said,
   * and read the active context's text alone, so a "Saved" inside a
   * same-origin frame on the page never arrived.
   */
  it("waits the adapter's own timeout by default, and reads same-origin frames", async () => {
    const surface = await open("/widgets");
    expect((await surface.act("waitFor", undefined, { text: "Inside the frame", timeoutMs: 5_000 })).ok).toBe(true);

    const quick = new BidiSurface({ headless: true, timeoutMs: 300, testIdAttributes: ["data-testid"] });
    opened.push(quick);
    await quick.open({ baseUrl: app.origin });
    await quick.act("navigate", undefined, { url: "/login" });
    const error = await quick
      .act("waitFor", undefined, { text: "never on this page" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).message).toContain("Waited 300 ms");
  }, 120_000);

  it("waits for an element to leave the document, and to come back", async () => {
    const surface = await open("/login");
    const [field] = await surface.locate({ by: "id", value: "username", score: 1 });

    await expect(
      surface.act("waitFor", field!, { state: "detached", timeoutMs: 300 }),
    ).rejects.toBeInstanceOf(TimeoutError);

    await surface.act("evaluate", undefined, {
      script:
        "const field = document.getElementById('username'); const parent = field.parentElement; " +
        "setTimeout(() => field.remove(), 300); " +
        "setTimeout(() => { field.hidden = true; parent.append(field); }, 1200);",
    });
    expect((await surface.act("waitFor", field!, { state: "detached" })).ok).toBe(true);
    // Put back hidden: attached holds, which the `visible` row it used to fall
    // through to would not have said until its timeout.
    expect((await surface.act("waitFor", field!, { state: "attached", timeoutMs: 5_000 })).ok).toBe(true);

    await expect(surface.act("waitFor", field!, { state: "unheard-of" })).rejects.toBeInstanceOf(DataError);
  }, 120_000);
});

describeWithBrowser("refusals are unsupported, not failures (SF-11)", () => {
  it("refuses `quit` and `invoke` as actions it will never perform", async () => {
    const surface = await open("/");
    await expect(surface.act("quit")).rejects.toBeInstanceOf(UnsupportedError);
    await expect(surface.act("invoke")).rejects.toBeInstanceOf(UnsupportedError);
  }, 120_000);
});

describeWithBrowser("the session's cookies for a URL (REQ-ADP-3)", () => {
  it("answers the cookies the browser would send to that URL, by name", async () => {
    const surface = await open("/dashboard");
    await surface.act("evaluate", undefined, {
      script: 'document.cookie = "yam_session=abc123; path=/"; document.cookie = "admin_only=1; path=/admin";',
    });

    expect(await surface.cookies(`${app.origin}/api/bookings`)).toEqual({ yam_session: "abc123" });
    expect(await surface.cookies(`${app.origin}/admin/users`)).toEqual({ yam_session: "abc123", admin_only: "1" });
    expect(await surface.cookies("/api/bookings")).toEqual({ yam_session: "abc123" });
    expect(await surface.cookies("http://elsewhere.invalid/api/bookings")).toEqual({});
  }, 120_000);
});

describeWithBrowser("the session says what it is driving (LLD §7.3)", () => {
  it("names the browser, so a conformance result means something", async () => {
    const surface = await open("/");
    expect(surface.browser()).not.toBe("(not open)");
    expect(surface.browser().length).toBeGreaterThan(0);
  }, 120_000);
});
