// @vitest-environment jsdom
/**
 * Every screen is inside the themed root (TV-18, TV-A06).
 *
 * The theme lived on `Shell`'s own `<div>`, so the two screens rendered outside
 * Shell — `Starting` and `Welcome`, which are the first two anybody sees — had
 * no `data-theme` and no `.sv-root` on any ancestor. `shell.css` scopes both
 * `font-family: var(--sans)` and `--brand-mark` to `.sv-root`, so those screens
 * drew in Chromium's default serif with a blank square for the mark. A packaged
 * build showed exactly that on first launch.
 *
 * The existing theme check asserts the *tokens* exist in the stylesheet, which
 * they did throughout. What was missing was a check that anything renders inside
 * them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "../src/renderer/App.js";
import type { AppBridge } from "../src/renderer/bridge.js";

/**
 * The preload bridge, as Electron supplies it.
 *
 * `serviceInfo` answers null and nothing announces a service, which is the state
 * the app is in for the first moment of every launch — and the moment `Starting`
 * is on screen. That is the frame this file is about.
 */
function stubBridge(theme: "light" | "dark" = "dark", stored?: "system" | "light" | "dark"): void {
  const never = () => (): void => undefined;
  const bridge = {
    openProject: async () => ({ url: "", project: "", token: "" }),
    serviceInfo: async () => null,
    pickFile: async () => null,
    preferences: async () => ({
      recentProjects: [],
      ...(stored === undefined ? {} : { theme: stored }),
    }),
    onServiceLog: never,
    onTheme: (listener: (next: "light" | "dark") => void) => {
      listener(theme);
      return () => undefined;
    },
    onServiceOpened: never,
  } as unknown as AppBridge;
  Object.defineProperty(window, "yam", { value: bridge, configurable: true, writable: true });
}

/** jsdom answers no media query at all unless one is installed. */
function stubMedia(dark: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("dark") ? dark : !dark,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SHELL_CSS = readFileSync(join(HERE, "..", "src", "renderer", "shell", "shell.css"), "utf8");

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.classList.remove("sv-root");
  vi.restoreAllMocks();
});

describe("the appearance is on the document root", () => {
  /*
   * With no preload bridge — the state a browser harness is in, and the state
   * the app is in for the first moment of every launch — `App` renders
   * `Starting`. That is the frame this is about.
   */
  it("themes the root before any screen has rendered", async () => {
    stubBridge();
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.classList.contains("sv-root")).toBe(true);
    });
  });

  /*
   * `EX-02`. This assertion used to read `toBe("dark")`, and that was the
   * defect written down: with nothing stored, the app declared itself dark on
   * every machine. `system` is the *absence* of the attribute, because
   * `tokens.css` decides it with `prefers-color-scheme` and a stylesheet cannot
   * ask the machine on an attribute's behalf.
   */
  it("leaves the root unmarked when nobody has chosen, so the machine decides", async () => {
    stubBridge();
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.classList.contains("sv-root")).toBe(true);
    });
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("writes a stated choice to the root, where it overrides the machine", async () => {
    stubMedia(true);
    stubBridge("dark", "light");
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    });
  });

  it("goes back to unmarked when the choice returns to system", async () => {
    stubBridge("dark", "dark");
    const { unmount } = render(<App />);
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    });
    unmount();
    stubBridge("dark", "system");
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });
  });

  it("puts the starting screen inside it", async () => {
    stubBridge();
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector("#screen-starting")).not.toBeNull();
    });
    /* `closest` walks to `<html>`, which is where the class now is. */
    expect(container.querySelector("#screen-starting")?.closest(".sv-root")).not.toBeNull();
  });

  /*
   * The mark is what the defect was visible as: a blank accent square where the
   * logo goes. It is declared inside `.sv-root`, so it is only ever drawn where
   * that class is — asserted of the stylesheet because jsdom loads no CSS, and
   * because what went wrong was the selector rather than the value.
   */
  it("declares the brand mark inside the root's own block", () => {
    const at = SHELL_CSS.indexOf("--brand-mark:");
    expect(at).toBeGreaterThan(-1);
    const block = SHELL_CSS.lastIndexOf("{", at);
    const selector = SHELL_CSS.slice(0, block).split("}").pop() ?? "";
    expect(selector.replace(/\/\*[\s\S]*?\*\//g, "").trim()).toBe(".sv-root");
  });

  /*
   * No component may take the theme back onto a `<div>`: that is the exact shape
   * of the defect, and it would pass every other check in this suite.
   */
  it("is claimed by no component's own element", () => {
    const sources = ["Shell.tsx", "Welcome.tsx"].map((one) =>
      readFileSync(join(HERE, "..", "src", "renderer", "shell", one), "utf8"),
    );
    for (const source of sources) expect(source).not.toContain("data-theme=");
  });
});
