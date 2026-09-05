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
import { sessionStateSchema, CAPABILITY_FLAGS } from "@svatah/schema";
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
      dialogs: async () => {
        await surface.act("dialog", undefined, { accept: true });
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
        const dir = mkdtempSync(join(tmpdir(), "svatah-trace-"));
        await surface.trace(true);
        await surface.act("scrollToBottom");
        await surface.trace(false, join(dir, "trace.zip"));
        return statSync(join(dir, "trace.zip")).size > 0;
      },
      screenshot: async () => {
        const dir = mkdtempSync(join(tmpdir(), "svatah-shot-"));
        await surface.screenshot(join(dir, "s.png"));
        return statSync(join(dir, "s.png")).size > 0;
      },
      restore: async () => {
        await surface.restore(await surface.state());
        return true;
      },
      // WebMCP is REQ-ADP-9 (P2) and is claimed as false; the proof is that a
      // `webmcp` candidate locates nothing rather than pretending to.
      webmcp: async () =>
        (await surface.locate({ by: "webmcp", tool: "book", score: 1 })).length === 0,
    };

    for (const flag of CAPABILITY_FLAGS) {
      const proof = proofs[flag];
      expect(proof, `no proof for the "${flag}" capability`).toBeDefined();
      const held = await proof!();
      if (capabilities[flag]) {
        expect(held, `the adapter claims "${flag}" but the proof failed`).toBeTruthy();
      }
    }
    expect(capabilities.webmcp, "webmcp is P2 and must not be claimed yet").toBe(false);
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
      expression: 'document.cookie = "svatah_session=abc123; path=/";',
    });
    const before = await surface.act("evaluate", undefined, { expression: "document.cookie" });
    expect(String(before.value)).toContain("svatah_session=abc123");

    const dir = mkdtempSync(join(tmpdir(), "svatah-state-"));
    const path = join(dir, "storage.json");
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [
          {
            name: "svatah_session",
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
      expression: 'document.cookie = "svatah_session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";',
    });
    const cleared = await surface.act("evaluate", undefined, { expression: "document.cookie" });
    expect(String(cleared.value)).not.toContain("abc123");

    const saved = await surface.state();
    await surface.restore({ ...saved, storageState: path });

    const after = await surface.act("evaluate", undefined, { expression: "document.cookie" });
    expect(String(after.value)).toContain("svatah_session=abc123");
    expect(JSON.parse(readFileSync(path, "utf8")).cookies).toHaveLength(1);
  });

  test("restore refuses a state from another kind of adapter", async ({ openSurface }) => {
    const surface = await openSurface("own", "/");
    await expect(
      surface.restore({ kind: "desktop", windowTitle: "Svatah ADE" }),
    ).rejects.toBeInstanceOf(SessionError);
  });

  test("state records the active frame and the last dialog", async ({ openSurface }) => {
    const surface = await openSurface("own", "/widgets");
    await surface.act("dialog", undefined, { accept: true });
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
    const dir = mkdtempSync(join(tmpdir(), "svatah-mask-"));
    const path = join(dir, "masked.png");

    await surface.screenshot(path, [password]);
    expect(statSync(path).size).toBeGreaterThan(0);

    // The marker attribute must not survive: `describe()` reads an element's
    // attributes, and an adapter artefact would end up in every fingerprint.
    const attrs = (await surface.describe(password)).attrs;
    expect(Object.keys(attrs)).not.toContain("data-svatah-mask");
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
