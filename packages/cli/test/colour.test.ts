/**
 * One presentation (TV-C03, TV-17).
 *
 * `yam run` printing one green and `yam ui` printing another would be two
 * products wearing one name. Both read `@svatah/yam-ui-tokens`, so what is
 * asserted here is that the command line asks the same question of the terminal
 * and gets the same answer — and that a tone never arrives without its word.
 */
import { describe, expect, it } from "vitest";
import { STATUS, tone as tokenTone } from "@svatah/yam-ui-tokens";
import { depthOf, paint, withDepth } from "../src/colour.js";

const tty = { isTTY: true };
const pipe = { isTTY: false };

describe("how much colour a command sends", () => {
  it("takes the terminal's word for it", () => {
    expect(depthOf(tty, { COLORTERM: "truecolor", TERM: "xterm" })).toBe("truecolor");
    expect(depthOf(tty, { TERM: "xterm-256color" })).toBe("ansi256");
    expect(depthOf(tty, { TERM: "dumb" })).toBe("none");
  });

  it("sends none into a pipe, which is what a script is reading", () => {
    expect(depthOf(pipe, { COLORTERM: "truecolor" })).toBe("none");
  });

  it("obeys NO_COLOR, and lets --color override the terminal", () => {
    expect(depthOf(tty, { NO_COLOR: "1", COLORTERM: "truecolor" })).toBe("none");
    expect(depthOf(pipe, {}, "24bit")).toBe("truecolor");
  });
});

describe("the same tone is the same colour as the cockpit's", () => {
  it("paints what the token table says, and nothing else", () => {
    withDepth("truecolor");
    try {
      for (const name of Object.keys(STATUS) as Array<keyof typeof STATUS>) {
        expect(paint(name, "passed")).toBe(tokenTone(name, "passed", "truecolor"));
      }
    } finally {
      withDepth(undefined);
    }
  });

  it("never sends a colour without the word inside it", () => {
    withDepth("truecolor");
    try {
      const drawn = paint("fail", "failed");
      expect(drawn).toContain("failed");
      /* And with no colour at all, the word is the whole of it. */
      withDepth("none");
      expect(paint("fail", "failed")).toBe("failed");
    } finally {
      withDepth(undefined);
    }
  });
});
