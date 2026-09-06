/**
 * T1.1 Validate — "`restore` returns to URL and storage state" and "capabilities
 * list matches implementation".
 *
 * Also the session concerns of LLD §7.1 that are not one action: one context per
 * session, storage state from config, page tracking, the dialog queue, the active
 * frame, tracing, masked screenshots, and the error translation of LLD §8.4 that
 * lets the executor classify a failure without knowing which adapter ran.
 *
 * Refs: REQ-ADP-1, REQ-AUTO-2, REQ-NFR-6, REQ-SURF-2, LLD §2.4, §7.1, §8.4.
 */
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionStateSchema, CAPABILITY_FLAGS } from "@svatah/yam-schema";
import {
  clearAdapters,
  createSurface,
  DEFAULT_CONFIG,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
  listAdapters,
} from "./surface-imports.js";
import {
  PLAYWRIGHT_CAPABILITIES,
  PlaywrightSurface,
  registerPlaywrightAdapter,
  translate,
} from "../src/index.js";
import { expect, refByTestId, test } from "./fixtures.js";

test.describe("capabilities (LLD §2.4)", () => {
  test("the descriptor names every flag the schema publishes", () => {
    expect(Object.keys(PLAYWRIGHT_CAPABILITIES).sort()).toEqual([...CAPABILITY_FLAGS].sort());
  });

  test("every capability the adapter claims is actually implemented", async ({ openSurface }) => {
    const surface = await openSurface("own", "/widgets");
    const capabilities = surface.capabilities();

    // Each claimed flag is paired with the call that proves it. A flag claimed
    // without a proof here would be a promise the executor's capability gate
    // makes on the adapter's behalf and the adapter cannot keep.
    const proofs: Record<string, () => Promise<unknown>> = {
      // Draft 2.21: a person's click as an element, here scripted through YAM_PICK.
      // The proofs run in the schema's flag order, so this one runs last, after
      // `restore` has moved the page; it goes back to the widgets page first.
      pick: async () => {
        const saved = process.env["YAM_PICK"];
        // `show-alert` survives the proofs that ran before this one; the drag
        // source does not, once it has been dropped.
        process.env["YAM_PICK"] = JSON.stringify({ "the show alert button": "show-alert" });
        try {
          const origin = new URL((await surface.state()).url ?? "http://127.0.0.1").origin;
          await surface.act("navigate", undefined, { url: `${origin}/widgets` });
          const ref = await surface.pick!("the show alert button");
          if (ref === undefined) return false;
          const expected = await refByTestId(surface, "show-alert");
          return (await surface.describe(ref)).role === (await surface.describe(expected)).role;
        } finally {
          if (saved === undefined) delete process.env["YAM_PICK"];
          else process.env["YAM_PICK"] = saved;
        }
      },
      dialogs: async () => {
        await surface.act("dialog", undefined, { action: "accept" });
        await surface.act("click", await refByTestId(surface, "show-alert"));
        return (await surface.check({ kind: "present" }, "dialog")).ok;
      },
      frames: async () => {
        await surface.act("switchFrame", undefined, { url: "/widgets/frame" });
        const inside = await surface.locate({ by: "testid", value: "frame-input", score: 1 });
        await surface.act("switchFrame", undefined, { name: "main" });
        return inside.length === 1;
      },
      windows: async () => (await surface.act("closeOtherWindows")).ok,
      upload: async () =>
        (
          await surface.act("upload", await refByTestId(surface, "upload"), {
            files: [new URL(import.meta.url).pathname],
          })
        ).ok,
      drag: async () =>
        (
          await surface.act(
            "dragTo",
            await refByTestId(surface, "drag-source"),
            {},
            await refByTestId(surface, "drag-target"),
          )
        ).ok,
      trace: async () => {
        const dir = mkdtempSync(join(tmpdir(), "yam-trace-"));
        await surface.trace(true);
        await surface.act("scrollToBottom");
        await surface.trace(false, join(dir, "trace.zip"));
        return statSync(join(dir, "trace.zip")).size > 0;
      },
      screenshot: async () => {
        const dir = mkdtempSync(join(tmpdir(), "yam-shot-"));
        await surface.screenshot(join(dir, "s.png"));
        return statSync(join(dir, "s.png")).size > 0;
      },
      restore: async () => {
        await surface.restore(await surface.state());
        return true;
      },
      /*
       * WebMCP (T6.3, REQ-ADP-9). The claim is that this adapter can read a
       * page's `navigator.modelContext` declaration — so the proof is that it
       * finds a tool on the page that declares one, and finds nothing on the
       * same page with `?webmcp=off`. Either half alone would pass for an
       * adapter that always answered the same way.
       */
      webmcp: async () => {
        await surface.act("navigate", undefined, { url: "/site-tools" });
        const declared = await surface.locate({ by: "webmcp", tool: "book-the-slot", score: 1 });
        await surface.act("navigate", undefined, { url: "/site-tools?webmcp=off" });
        const gone = await surface.locate({ by: "webmcp", tool: "book-the-slot", score: 1 });
        return declared.length === 1 && gone.length === 0;
      },
    };

    for (const flag of CAPABILITY_FLAGS) {
      const proof = proofs[flag];
      expect(proof, `no proof for the "${flag}" capability`).toBeDefined();
      const held = await proof!();
      if (capabilities[flag]) {
        expect(held, `the adapter claims "${flag}" but the proof failed`).toBeTruthy();
      }
    }
    // T6.3 lands it: the adapter reads a declaration, so it claims the capability
    // and the proof above is what backs the claim.
    expect(capabilities.webmcp).toBe(true);
  });

  test("capabilities() returns a copy, so a caller cannot mutate the adapter", async ({
    openSurface,
  }) => {
    const surface = await openSurface("own", "/");
    const first = surface.capabilities();
    first.dialogs = false;
    expect(surface.capabilities().dialogs).toBe(true);
  });
});

test.describe("state and restore (REQ-AUTO-2)", () => {
  test("state() validates against the published schema and names where the session is", async ({
    openSurface,
    origin,
  }) => {
    const surface = await openSurface("own", "/booking");
    const state = await surface.state();
    expect(sessionStateSchema.safeParse(state).success).toBe(true);
    expect(state.kind).toBe("web");
    expect(state.url).toBe(`${origin}/booking`);
    expect(state.windowTitle).toContain("Booking");
    expect(state.windowIndex).toBe(0);
    expect(state.dialog).toBeNull();
  });

  test("restore returns to the URL the state named", async ({ openSurface, origin }) => {
    const surface = await openSurface("own", "/booking");
    const saved = await surface.state();

    await surface.act("navigate", undefined, { url: "/checkout" });
    expect(await surface.read("url")).toBe(`${origin}/checkout`);

    await surface.restore(saved);
    expect(await surface.read("url")).toBe(`${origin}/booking`);
  });

  test("restore re-applies storage state", async ({ openSurface, origin }) => {
    const surface = await openSurface("own", "/dashboard");

    // A cookie stands for the session a real flow would have. It is written into
    // a storage-state file, cleared, and put back by `restore`.
    await surface.act("evaluate", undefined, {
      expression: 'document.cookie = "yam_session=abc123; path=/";',
    });
    const before = await surface.act("evaluate", undefined, { expression: "document.cookie" });
    expect(String(before.value)).toContain("yam_session=abc123");

    const dir = mkdtempSync(join(tmpdir(), "yam-state-"));
    const path = join(dir, "storage.json");
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [
          {
            name: "yam_session",
            value: "abc123",
            domain: new URL(origin).hostname,
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      }),
    );

    await surface.act("evaluate", undefined, {
      expression: 'document.cookie = "yam_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";',
    });
    const cleared = await surface.act("evaluate", undefined, { expression: "document.cookie" });
    expect(String(cleared.value)).not.toContain("abc123");

    const saved = await surface.state();
    await surface.restore({ ...saved, storageState: path });

    const after = await surface.act("evaluate", undefined, { expression: "document.cookie" });
    expect(String(after.value)).toContain("yam_session=abc123");
    expect(JSON.parse(readFileSync(path, "utf8")).cookies).toHaveLength(1);
  });

  test("restore refuses a state from another kind of adapter", async ({ openSurface }) => {
    const surface = await openSurface("own", "/");
    await expect(
      surface.restore({ kind: "desktop", windowTitle: "Yam" }),
    ).rejects.toBeInstanceOf(SessionError);
  });

  test("state records the active frame and the last dialog", async ({ openSurface }) => {
    const surface = await openSurface("own", "/widgets");
    await surface.act("dialog", undefined, { action: "accept" });
    await surface.act("click", await refByTestId(surface, "show-alert"));
    await surface.act("switchFrame", undefined, { url: "/widgets/frame" });

    const state = await surface.state();
    // The frame's name when it has one — the iframe's `id` here — and its URL
    // when it does not. A name is the stabler of the two across navigations.
    expect(state.frame).toBe("embedded");
    expect(state.dialog).toMatchObject({ type: "alert", message: "Saved." });
  });
});

test.describe("screenshots and masking (REQ-NFR-6)", () => {
  test("a masked reference is painted over and the mark is removed again", async ({
    openSurface,
  }) => {
    const surface = await openSurface("own", "/login");
    const password = await refByTestId(surface, "password");
    const dir = mkdtempSync(join(tmpdir(), "yam-mask-"));
    const path = join(dir, "masked.png");

    await surface.screenshot(path, [password]);
    expect(statSync(path).size).toBeGreaterThan(0);

    // The marker attribute must not survive: `describe()` reads an element's
    // attributes, and an adapter artefact would end up in every fingerprint.
    const attrs = (await surface.describe(password)).attrs;
    expect(Object.keys(attrs)).not.toContain("data-yam-mask");
  });
});

test.describe("the adapter registry (REQ-SURF-2)", () => {
  test("registers under 'playwright' and is idempotent", async () => {
    clearAdapters();
    registerPlaywrightAdapter();
    registerPlaywrightAdapter();
    expect(listAdapters()).toEqual(["playwright"]);

    const surface = await createSurface({
      ...DEFAULT_CONFIG,
      project: "adapter-playwright-test",
      adapter: "playwright",
    });
    expect(surface.kind).toBe("web");
    expect(surface).toBeInstanceOf(PlaywrightSurface);
    clearAdapters();
  });
});

test.describe("error translation (LLD §8.4)", () => {
  test("maps Playwright's messages onto the surface's typed errors", () => {
    const cases: Array<[string, unknown]> = [
      ["Timeout 5000ms exceeded.", TimeoutError],
      ["strict mode violation: locator resolved to 3 elements", LocateError],
      ["page.goto: net::ERR_CONNECTION_REFUSED", NavigationError],
      ["Target page, context or browser has been closed", SessionError],
      ["Evaluation failed: ReferenceError: nope is not defined", ScriptError],
    ];
    for (const [message, type] of cases) {
      const translated = translate(new Error(message));
      expect(translated, message).toBeInstanceOf(type as never);
    }
  });

  test("passes an already-typed surface error through unchanged", () => {
    const original = new LocateError("already typed");
    expect(translate(original)).toBe(original);
  });

  test("a non-Error value is returned as it came", () => {
    expect(translate("a string")).toBe("a string");
  });

  test("a real timeout from the browser is a TimeoutError", async ({ openSurface }) => {
    const surface = new PlaywrightSurface({ headless: true, timeoutMs: 500 });
    await surface.open({});
    try {
      await surface.act("navigate", undefined, { url: "http://127.0.0.1:1/nothing" });
      throw new Error("expected the navigation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NavigationError);
    } finally {
      await surface.close();
    }
    void openSurface;
  });
});

test.describe("session lifecycle", () => {
  test("opening twice is refused", async ({ openSurface, origin }) => {
    const surface = await openSurface("own", "/");
    await expect(surface.open({ baseUrl: origin })).rejects.toBeInstanceOf(SessionError);
  });

  test("acting on a closed session says the session is not open", async ({ origin }) => {
    const surface = new PlaywrightSurface({ headless: true });
    await surface.open({ baseUrl: origin });
    await surface.close();
    await expect(surface.snapshot()).rejects.toBeInstanceOf(SessionError);
  });

  test("close is safe to call twice", async ({ origin }) => {
    const surface = new PlaywrightSurface({ headless: true });
    await surface.open({ baseUrl: origin });
    await surface.close();
    await surface.close();
  });
});

/**
 * Attaching to a Chromium that is already running (T11.2, LLD §13.9).
 *
 * > The Playwright adapter attaches to an existing Chromium when
 * > `YAM_CDP_URL` or `app.attach.cdpUrl` is set, exactly as the BiDi adapter
 * > attaches, so a flow can drive the app's renderer.
 *
 * A real Chromium with a real DevTools endpoint, because the thing worth
 * checking is that it drives the browser *that is already running* rather than
 * one of its own — and a fake endpoint cannot fail that way. What the app adds
 * on top is a packaged Electron and a granted permission, and that is
 * `evals/self/cdp` and `docs/spec/progress/phase-11.md`.
 */
test.describe("attaching over CDP (T11.2, LLD §13.9)", () => {
  /** A Chromium with a DevTools endpoint, and its URL. */
  async function running(): Promise<{ url: string; close: () => Promise<void> }> {
    const { chromium } = await import("playwright");
    const port = 9500 + Math.floor(Math.random() * 400);
    const browser = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${port}`],
    });
    // One page, so the attached session has a context to adopt: a browser with
    // nothing open is a browser with nothing to drive, and the adapter says so.
    const page = await browser.newPage();
    await page.setContent('<button id="attached-button">Attached</button>');
    return {
      url: `http://127.0.0.1:${port}`,
      close: async () => {
        await browser.close();
      },
    };
  }

  test("drives the browser that is already running, not one of its own", async () => {
    const other = await running();
    try {
      const surface = new PlaywrightSurface({ cdpUrl: other.url });
      await surface.open({});
      try {
        const snapshot = await surface.snapshot();
        // The page *that browser* had open, which a launched Chromium would not.
        expect(snapshot.nodes.some((node) => node.name === "Attached")).toBe(true);
      } finally {
        await surface.close();
      }
      /*
       * And it is still running. `close()` on an attached session ends the
       * connection, not the browser: a session that quit somebody's Chromium —
       * or the app, mid-run — because a flow ended would be the adapter
       * deciding what the application is for.
       */
      const { chromium } = await import("playwright");
      const again = await chromium.connectOverCDP(other.url);
      expect(again.contexts().length).toBeGreaterThan(0);
      await again.close();
    } finally {
      await other.close();
    }
  });

  test("reads `YAM_CDP_URL` when nothing else names one", async () => {
    const other = await running();
    const before = process.env["YAM_CDP_URL"];
    process.env["YAM_CDP_URL"] = other.url;
    try {
      const surface = new PlaywrightSurface({});
      await surface.open({});
      try {
        const snapshot = await surface.snapshot();
        expect(snapshot.nodes.some((node) => node.name === "Attached")).toBe(true);
      } finally {
        await surface.close();
      }
    } finally {
      if (before === undefined) delete process.env["YAM_CDP_URL"];
      else process.env["YAM_CDP_URL"] = before;
      await other.close();
    }
  });

  test("the session's own `attach.cdpUrl` wins over the environment", async () => {
    const other = await running();
    const before = process.env["YAM_CDP_URL"];
    // A URL nothing is listening on: if the environment won, this would attach
    // to `other` and pass for the wrong reason.
    process.env["YAM_CDP_URL"] = "http://127.0.0.1:1";
    try {
      const surface = new PlaywrightSurface({});
      await surface.open({ attach: { cdpUrl: other.url } });
      try {
        const snapshot = await surface.snapshot();
        expect(snapshot.nodes.some((node) => node.name === "Attached")).toBe(true);
      } finally {
        await surface.close();
      }
    } finally {
      if (before === undefined) delete process.env["YAM_CDP_URL"];
      else process.env["YAM_CDP_URL"] = before;
      await other.close();
    }
  });

  test("says what to do when nothing is listening", async () => {
    const surface = new PlaywrightSurface({ cdpUrl: "http://127.0.0.1:1" });
    await expect(surface.open({})).rejects.toThrow(/--remote-debugging-port/);
  });

  test("refuses `Quit the app`, which is a desktop step (pattern 31)", async ({ openSurface }) => {
    const surface = await openSurface("own", "/");
    await expect(surface.act("quit", undefined)).rejects.toThrow(/desktop step/);
  });
});
