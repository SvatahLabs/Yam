/**
 * A golden frame with the colour left in (E0.4, `CX-02`, `EX-N3`).
 *
 * The existing golden frames are rendered by a test runner, whose stdout is not
 * a terminal — so `depthFor` answers `none`, every entry of `CHROME` is
 * `undefined`, and thirty-four committed frames contain no escape sequence at
 * all. They are a check of the *layout*, and they could not have caught
 * `borderColor="magenta"`: they did not, for two phases.
 *
 * So this one states a terminal instead of being run in one. It forces 24-bit
 * and re-imports the module graph, which is the only way to move `CHROME` — it
 * is resolved once at import, deliberately, because a per-render capability
 * check would be a syscall per frame.
 *
 * What is committed is the escape sequences, because those are the thing that
 * was wrong. `UPDATE_GOLDEN=1` rewrites it; read the diff, or it has stopped
 * checking anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DARK } from "@svatah/yam-ui-tokens";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "golden", "chrome-truecolor.txt");
const ESC = "\u001b";

/** The 24-bit foreground escape a token comes out as. */
const fg = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return `${ESC}[38;2;${String(r)};${String(g)};${String(b)}m`;
};

let tty: PropertyDescriptor | undefined;

beforeEach(() => {
  tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  /* chalk decides the level itself, from the environment, at its own import. */
  vi.stubEnv("FORCE_COLOR", "3");
  vi.stubEnv("COLORTERM", "truecolor");
  vi.stubEnv("TERM", "xterm-256color");
  vi.stubEnv("YAM_THEME", "dark");
  vi.resetModules();
});

afterEach(() => {
  if (tty === undefined) delete (process.stdout as { isTTY?: boolean }).isTTY;
  else Object.defineProperty(process.stdout, "isTTY", tty);
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Render the two widgets that carry the chrome, at a stated terminal. */
async function frame(): Promise<string> {
  const { render } = await import("ink-testing-library");
  const { RailStrip, StatusBar } = await import("../src/widgets.js");
  const React = (await import("react")).default;

  const rail = render(
    React.createElement(RailStrip, {
      width: 60,
      more: { left: false, right: true },
      entries: [
        { screen: "session", key: "s", label: "Session", current: true },
        { screen: "flows", key: "f", label: "Flows", current: false },
      ],
    } as never),
  ).lastFrame();

  const bar = render(
    React.createElement(StatusBar, {
      width: 60,
      left: ["yam", "connected"],
      right: ["do"],
    } as never),
  ).lastFrame();

  return `${rail ?? ""}\n${bar ?? ""}\n`;
}

describe("the cockpit draws the brand, and it is in the frame (CX-02)", () => {
  it("matches the committed frame, escapes and all", async () => {
    const drawn = await frame();
    if (process.env["UPDATE_GOLDEN"] === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, drawn, "utf8");
    }
    expect(drawn).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("sends the brand for where you are and the dim token for where you are not", async () => {
    const drawn = await frame();
    expect(drawn).toContain(fg(DARK.yam));
    expect(drawn).toContain(fg(DARK.dim));
    expect(drawn).toContain(fg(DARK.accent));
  });

  it("would have caught the magenta, which the layout goldens could not", async () => {
    /*
     * `EX-N3`. The old chrome drew `borderColor="magenta"` and `color="gray"`,
     * which come out as the three-digit SGR codes rather than 24-bit ones.
     * Their absence is the check.
     */
    const drawn = await frame();
    expect(drawn).not.toMatch(new RegExp(`${ESC}\\[3[0-7]m`));
    expect(drawn).not.toMatch(new RegExp(`${ESC}\\[9[0-7]m`));
  });
});
