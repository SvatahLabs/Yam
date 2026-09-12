/**
 * The terminal the cockpit borrows (TV-T02, TV-03).
 *
 * Against a fake stream, so the bytes can be asserted. What the TV-T00 spike
 * proved in a real pseudo-terminal is that these sequences work; what is checked
 * here is that they are written once, in the right order, and undone.
 */
import { describe, expect, it } from "vitest";
import { capabilitiesOf, own } from "../src/terminal.js";

class FakeTty {
  isTTY = true;
  written = "";
  write = (text: string): boolean => {
    this.written += text;
    return true;
  };
}

const stream = (one: FakeTty): NodeJS.WriteStream => one as unknown as NodeJS.WriteStream;
const tty = (): NodeJS.WriteStream => stream(new FakeTty());

describe("what a terminal will admit to (TV-05)", () => {
  it("believes COLORTERM about 24-bit colour, and nothing else", () => {
    expect(capabilitiesOf(tty(), { COLORTERM: "truecolor", TERM: "xterm" }).truecolor).toBe(true);
    expect(capabilitiesOf(tty(), { TERM: "xterm-256color" }).truecolor).toBe(false);
    expect(capabilitiesOf(tty(), { TERM: "xterm-256color" }).ansi256).toBe(true);
  });

  it("obeys NO_COLOR, which is a person speaking rather than a terminal", () => {
    const caps = capabilitiesOf(tty(), { NO_COLOR: "1", COLORTERM: "truecolor" });
    expect(caps.truecolor).toBe(false);
    expect(caps.colour).toBe(false);
  });

  it("claims nothing of a pipe", () => {
    const pipe = new FakeTty();
    pipe.isTTY = false;
    const caps = capabilitiesOf(stream(pipe), { COLORTERM: "truecolor" });
    expect(caps.colour).toBe(false);
    expect(caps.mouse).toBe(false);
  });

  it("draws nothing for a dumb terminal", () => {
    expect(capabilitiesOf(tty(), { TERM: "dumb" }).colour).toBe(false);
    expect(capabilitiesOf(tty(), { TERM: "dumb" }).mouse).toBe(false);
  });
});

describe("taking the terminal, and giving it back (TV-03)", () => {
  const open = (mouse?: boolean): { out: FakeTty; owned: ReturnType<typeof own> } => {
    const out = new FakeTty();
    const owned = own({
      stdout: stream(out),
      env: { TERM: "xterm-256color" },
      ...(mouse === undefined ? {} : { mouse }),
    });
    return { out, owned };
  };

  it("enters the alternate screen, hides the cursor and turns the mouse on", () => {
    const { out, owned } = open();
    expect(out.written).toContain("\u001b[?1049h");
    expect(out.written).toContain("\u001b[?25l");
    expect(out.written).toContain("\u001b[?1006h");
    owned.restore();
  });

  it("puts every one of them back, in the reverse order", () => {
    const { out, owned } = open();
    out.written = "";
    owned.restore();
    expect(out.written).toBe("\u001b[?1006l\u001b[?1000l\u001b[?25h\u001b[?1049l");
  });

  it("restores once, however many times it is asked", () => {
    /*
     * The spike wrote the restore twice, from `exit` and from the line after the
     * render. Two resets are invisible on a good day, and a second escape
     * sequence arriving after the shell has drawn its prompt on a bad one.
     */
    const { out, owned } = open();
    out.written = "";
    owned.restore();
    const once = out.written;
    owned.restore();
    owned.restore();
    expect(out.written).toBe(once);
  });

  it("writes nothing at all into a pipe", () => {
    const pipe = new FakeTty();
    pipe.isTTY = false;
    const owned = own({ stdout: stream(pipe), env: {} });
    expect(pipe.written).toBe("");
    owned.restore();
    expect(pipe.written).toBe("");
  });

  it("leaves the mouse alone when it was never asked for", () => {
    const { out, owned } = open(false);
    expect(out.written).not.toContain("\u001b[?1000h");
    out.written = "";
    owned.restore();
    expect(out.written).not.toContain("\u001b[?1000l");
  });

  it("registers its handlers and takes them off again", () => {
    const before = process.listenerCount("SIGINT");
    const { owned } = open();
    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    owned.restore();
    expect(process.listenerCount("SIGINT"), "a restored terminal left a handler behind").toBe(before);
  });
});
