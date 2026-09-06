/**
 * T1.1 Validate — "one Playwright test per action … on `apps/sample-web`".
 *
 * `SURFACE_ACTIONS` is the IR action set minus the three the executor keeps to
 * itself (LLD §2.3). Every one of those has a test here, and the last test in
 * the file asserts that: a new action cannot be added to the schema without a
 * test appearing, because the coverage check reads the schema's own list.
 *
 * Refs: REQ-ADP-1, REQ-RUN-10, LLD §7.1.
 */
import { SURFACE_ACTIONS, type SurfaceAction } from "@svatah/schema";
import { LocateError, ScriptError, SessionError } from "@svatah/surface";
import { expect, MECHANISMS, refByTestId, test } from "./fixtures.js";

/**
 * Coverage is read from this file's own test titles, not from a list a person
 * maintains and not from a set filled while the tests run — `fullyParallel`
 * spreads tests across workers, so a runtime set would only ever see part of the
 * suite. Every test that exercises an action names it in `[brackets]` in its
 * title, and the last test greps the source for those tags.
 */
for (const mechanism of MECHANISMS) {
  test.describe(`actions (${mechanism} refs)`, () => {
    /* ── navigation ─────────────────────────────────────────────────────── */

    test("[navigate][back][forward][refresh] navigate, back, forward, refresh", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/");

      const navigated = await surface.act("navigate", undefined, { url: "/login" });
      expect(navigated.ok).toBe(true);
      expect(navigated.navigated).toBe(true);
      expect(await surface.read("url")).toContain("/login");

      await surface.act("back");
      expect(await surface.read("url")).not.toContain("/login");

      await surface.act("forward");
      expect(await surface.read("url")).toContain("/login");

      await surface.act("refresh");
      expect(await surface.read("url")).toContain("/login");
    });

    test("navigate resolves a relative url against the session base url", async ({
      openSurface,
      origin,
    }) => {
      const surface = await openSurface(mechanism, "/");
      await surface.act("navigate", undefined, { url: "/dashboard" });
      expect(await surface.read("url")).toBe(`${origin}/dashboard`);
    });

    /* ── pointer ────────────────────────────────────────────────────────── */

    test("[click] click follows a link", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/");
      await surface.act("click", await refByTestId(surface, "sign-in"));
      expect(await surface.read("url")).toContain("/login");
    });

    test("[doubleClick][rightClick] doubleClick and rightClick reach the element", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      const ref = await refByTestId(surface, "refresh-count");
      expect((await surface.act("doubleClick", ref)).ok).toBe(true);
      expect((await surface.act("rightClick", ref)).ok).toBe(true);
    });

    test("[hover][hoverAndClick] hover and hoverAndClick", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/");
      const ref = await refByTestId(surface, "sign-in");
      expect((await surface.act("hover", ref)).ok).toBe(true);
      await surface.act("hoverAndClick", ref);
      expect(await surface.read("url")).toContain("/login");
    });

    test("[pressAndHold][release] pressAndHold then release", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const source = await refByTestId(surface, "drag-source");
      expect((await surface.act("pressAndHold", source)).ok).toBe(true);
      expect((await surface.act("release", source)).ok).toBe(true);
    });

    test("[dragTo] dragTo moves the pointer from one element to another", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const source = await refByTestId(surface, "drag-source");
      const target = await refByTestId(surface, "drag-target");
      expect((await surface.act("dragTo", source, {}, target)).ok).toBe(true);
    });

    test("dragTo without a second reference is a LocateError", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const source = await refByTestId(surface, "drag-source");
      await expect(surface.act("dragTo", source)).rejects.toBeInstanceOf(LocateError);
    });

    /* ── keyboard and input ─────────────────────────────────────────────── */

    test("[type][clear][press] type, clear, press", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const username = await refByTestId(surface, "username");

      await surface.act("type", username, { value: "atul@example.com" });
      expect(await surface.read("value", username)).toBe("atul@example.com");

      await surface.act("clear", username);
      expect(await surface.read("value", username)).toBe("");

      await surface.act("type", username, { value: "abc" });
      await surface.act("press", username, { key: "Backspace" });
      expect(await surface.read("value", username)).toBe("ab");
    });

    test("[keyDown][keyUp] keyDown and keyUp", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const username = await refByTestId(surface, "username");
      // `keyDown` with a reference focuses the element first, so the session-level
      // `press` that follows goes to it with the modifier still held. A `press`
      // *with* a reference is Playwright's element press, which does not see a
      // separately held modifier — that distinction is the point of having both.
      await surface.act("keyDown", username, { key: "Shift" });
      await surface.act("press", undefined, { key: "KeyA" });
      await surface.act("keyUp", username, { key: "Shift" });
      expect(await surface.read("value", username)).toBe("A");

      // Shift released: the same physical key now produces the lower case.
      await surface.act("press", undefined, { key: "KeyA" });
      expect(await surface.read("value", username)).toBe("Aa");
    });

    test("[submit] submit submits the enclosing form", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      await surface.act("type", await refByTestId(surface, "username"), { value: "a@b.c" });
      await surface.act("type", await refByTestId(surface, "password"), { value: "secret" });
      await surface.act("submit", await refByTestId(surface, "username"));
      /*
       * Polled, not slept (LLD §16's timing rule).
       *
       * A fixed 300 ms after a form submission is a race with a navigation, and
       * it lost one on a loaded machine: the assertion read
       * `http://127.0.0.1:…/login` because the browser had not got there yet.
       * "A timing test that fails only under parallel load is a defect in the
       * test, not in the code." What the case is about is that `submit`
       * submits, so it waits for the navigation and gives up after a budget far
       * larger than the thing it measures.
       */
      const deadline = Date.now() + 15_000;
      let url = await surface.read("url");
      while (!String(url).includes("/dashboard") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        url = await surface.read("url");
      }
      expect(url).toContain("/dashboard");
    });

    test("[upload] upload sets an input's files", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const upload = await refByTestId(surface, "upload");
      await surface.act("upload", upload, { files: [new URL(import.meta.url).pathname] });
      const name = await surface.read("value", upload);
      expect(String(name)).toContain("actions.spec.ts");
    });

    /* ── selection ──────────────────────────────────────────────────────── */

    test("[selectOption] selectOption by value, label and index", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const select = await refByTestId(surface, "single-select");

      await surface.act("selectOption", select, { value: "staging" });
      expect(await surface.read("value", select)).toBe("staging");

      await surface.act("selectOption", select, { value: "Production", by: "label" });
      expect(await surface.read("value", select)).toBe("production");

      await surface.act("selectOption", select, { value: "0", by: "index" });
      expect(await surface.read("value", select)).toBe("test");
    });

    test("[deselectOption][deselectAll] deselectOption and deselectAll on a multiple select", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const multi = await refByTestId(surface, "multi-select");

      await surface.act("selectOption", multi, { values: ["chromium", "firefox", "webkit"] });
      expect(await surface.read("value", multi)).toBe("chromium, firefox, webkit");

      await surface.act("deselectOption", multi, { values: ["firefox"] });
      expect(await surface.read("value", multi)).toBe("chromium, webkit");

      await surface.act("deselectAll", multi);
      expect(await surface.read("value", multi)).toBe("");
    });

    test("[setChecked] setChecked toggles a checkbox", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const remember = await refByTestId(surface, "remember");
      await surface.act("setChecked", remember, { checked: true });
      expect((await surface.check({ kind: "checked" }, "ref", remember)).ok).toBe(true);
      await surface.act("setChecked", remember, { checked: false });
      expect((await surface.check({ kind: "unchecked" }, "ref", remember)).ok).toBe(true);
    });

    /* ── scrolling ──────────────────────────────────────────────────────── */

    test("[scrollIntoView][scrollToBottom][scrollToTop] scrollIntoView, scrollToBottom, scrollToTop", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const canvas = await refByTestId(surface, "canvas-control");
      expect((await surface.act("scrollIntoView", canvas)).ok).toBe(true);
      expect((await surface.act("scrollToBottom")).ok).toBe(true);
      expect((await surface.act("scrollToTop")).ok).toBe(true);
      expect(await surface.act("evaluate", undefined, { expression: "window.scrollY" })).toMatchObject(
        { value: 0 },
      );
    });

    /* ── waiting ────────────────────────────────────────────────────────── */

    test("[sleep][waitFor] sleep waits and waitFor waits for a state", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const started = Date.now();
      await surface.act("sleep", undefined, { ms: 150 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(120);

      const heading = await refByTestId(surface, "widgets-heading");
      expect((await surface.act("waitFor", heading, { state: "visible" })).ok).toBe(true);
    });

    /* ── windows and frames ─────────────────────────────────────────────── */

    test("[switchWindow][closeOtherWindows] switchWindow and closeOtherWindows", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      await surface.act("click", await refByTestId(surface, "open-new-tab"));

      /*
       * Polled, not slept (LLD §16's timing rule), for the same reason as
       * `[submit]` above: half a second is a race with a browser opening a tab,
       * and a race decided by how loaded the machine is is a test that will
       * fail for a reason that has nothing to do with the adapter.
       */
      const deadline = Date.now() + 15_000;
      let second = "";
      while (!second.includes("/docs") && Date.now() < deadline) {
        try {
          await surface.act("switchWindow", undefined, { index: 1 });
          second = String(await surface.read("url"));
        } catch {
          // The second window is not there yet.
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      expect(second).toContain("/docs");

      await surface.act("switchWindow", undefined, { index: 0 });
      expect(await surface.read("url")).toContain("/widgets");

      await surface.act("closeOtherWindows");
      expect(await surface.read("url")).toContain("/widgets");
      await expect(surface.act("switchWindow", undefined, { index: 1 })).rejects.toBeInstanceOf(
        SessionError,
      );
    });

    /*
     * `Resize the window to <w> by <h>` (pattern 33, T12.7, LLD §13.9).
     *
     * Three of the parity gate's one-sided checks were toolbar rules measured
     * at several widths, and the reason Svatah could not reach them was that a
     * flow could not change the width. Asserted through the page's own view of
     * itself rather than through what was asked for: a viewport that the
     * browser rounded or refused is a resize that did not happen.
     */
    test("[resizeWindow] resizeWindow gives the page a viewport", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");

      await surface.act("resizeWindow", undefined, { width: 1100, height: 800 });
      expect(
        await surface.act("evaluate", undefined, { expression: "window.innerWidth" }),
      ).toEqual(expect.objectContaining({ value: 1100 }));

      await surface.act("resizeWindow", undefined, { width: 640, height: 480 });
      expect(
        await surface.act("evaluate", undefined, { expression: "window.innerWidth" }),
      ).toEqual(expect.objectContaining({ value: 640 }));

      // A size that is not a size is a script error, not a silent no-op.
      await expect(
        surface.act("resizeWindow", undefined, { width: "wide", height: 480 }),
      ).rejects.toBeInstanceOf(ScriptError);
    });

    test("[switchFrame] switchFrame enters an iframe and returns to the main frame", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");

      await surface.act("switchFrame", undefined, { url: "/widgets/frame" });
      const inside = await surface.locate({ by: "testid", value: "frame-input", score: 1 });
      expect(inside).toHaveLength(1);
      await surface.act("type", inside[0]!, { value: "in the frame" });
      expect(await surface.read("value", inside[0]!)).toBe("in the frame");

      await surface.act("switchFrame", undefined, { name: "main" });
      expect(await surface.locate({ by: "testid", value: "widgets-heading", score: 1 })).toHaveLength(
        1,
      );
    });

    /* ── dialogs ────────────────────────────────────────────────────────── */

    test("[dialog] dialog accepts and dismisses a confirm", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const result = await refByTestId(surface, "dialog-result");

      await surface.act("dialog", undefined, { action: "accept" });
      await surface.act("click", await refByTestId(surface, "show-confirm"));
      expect(await surface.read("text", result)).toBe("confirmed");

      await surface.act("dialog", undefined, { action: "dismiss" });
      await surface.act("click", await refByTestId(surface, "show-confirm"));
      expect(await surface.read("text", result)).toBe("dismissed");
    });

    test("dialog supplies prompt text", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      await surface.act("dialog", undefined, { action: "accept", text: "Atul" });
      await surface.act("click", await refByTestId(surface, "show-prompt"));
      expect(await surface.read("text", await refByTestId(surface, "dialog-result"))).toBe("Atul");
    });

    /* ── reading, scripting, screenshots ────────────────────────────────── */

    test("[read] read every kind", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      const heading = await refByTestId(surface, "dashboard-heading");
      const link = await refByTestId(surface, "docs-link");

      expect(await surface.read("text", heading)).toBe("Welcome back, Enterprise");
      expect(await surface.read("title")).toContain("Dashboard");
      expect(await surface.read("url")).toContain("/dashboard");
      expect(await surface.read("attribute", link, "target")).toBe("_blank");
      expect(await surface.read("result", await refByTestId(surface, "active-count"))).toBe("3");

      const act = await surface.act("read", heading, { kind: "text" });
      expect(act.value).toBe("Welcome back, Enterprise");
    });

    test("[evaluate] evaluate runs against the page and against an element", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      const page = await surface.act("evaluate", undefined, { expression: "document.title" });
      expect(String(page.value)).toContain("Dashboard");

      const heading = await refByTestId(surface, "dashboard-heading");
      const element = await surface.act("evaluate", heading, {
        expression: "return element.tagName.toLowerCase();",
      });
      expect(element.value).toBe("h1");
    });

    test("[screenshot] screenshot writes a file", async ({ openSurface }, testInfo) => {
      const surface = await openSurface(mechanism, "/login");
      const path = testInfo.outputPath(`shot-${mechanism}.png`);
      await surface.act("screenshot", undefined, { path });
      const { statSync } = await import("node:fs");
      expect(statSync(path).size).toBeGreaterThan(0);
    });
  });
}

/**
 * `[quit]` — the desktop step this adapter refuses (pattern 31, T11.2).
 *
 * Its "implementation" is a refusal, and a refusal is a behaviour worth a test:
 * a web adapter that quietly did nothing would let a desktop flow "pass"
 * against a browser it never quit. The boundary is the one REQ-SURF-5 draws
 * from the other side, where a desktop adapter refuses `navigate`.
 */
test("[quit] quit is a desktop step and this adapter says so", async ({ openSurface }) => {
  const surface = await openSurface("own", "/");
  await expect(surface.act("quit", undefined)).rejects.toThrow(/desktop step/);
});

test("every surface action has a test (REQ-RUN-10)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const tagged = new Set<string>();
  for (const match of source.matchAll(/test\("((?:\[[a-zA-Z]+\])+)/g)) {
    for (const tag of match[1]!.matchAll(/\[([a-zA-Z]+)\]/g)) tagged.add(tag[1]!);
  }

  // Every tag must be a real action, so a typo cannot pass as coverage.
  const known = new Set<string>(SURFACE_ACTIONS);
  for (const tag of tagged) {
    expect(known, `"[${tag}]" in a test title is not a surface action`).toContain(tag);
  }

  // `invoke` is an executor concern that never reaches an adapter (LLD §8.2);
  // the test below asserts the adapter refuses it rather than implementing it.
  const missing = SURFACE_ACTIONS.filter(
    (action: SurfaceAction) => !tagged.has(action) && action !== "invoke",
  );
  expect(
    missing,
    `these surface actions have no tagged test in actions.spec.ts: ${missing.join(", ")}`,
  ).toEqual([]);
});

test('"invoke" is refused by the adapter, being an executor concern', async ({ openSurface }) => {
  const surface = await openSurface("own", "/");
  await expect(surface.act("invoke")).rejects.toThrow(/executor concern/);
});
