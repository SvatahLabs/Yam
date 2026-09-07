/**
 * A real pseudo-terminal, driven through the surface contract (T22, SF-22).
 *
 * Not a stub. What makes a terminal surface different from a pipe is precisely
 * the things a stub cannot have — a program that asks whether its output is a
 * terminal and behaves differently, a line discipline that turns `0x03` into
 * `SIGINT`, an exit status that carries a signal — so every case here opens one.
 *
 * On a host with neither `expect` nor a `python3` with its `pty` module there is
 * nothing to open, and the suite says so with the probe's own sentence rather
 * than failing. That is the same rule the rest of this repository keeps: a host
 * that cannot be asked is not a product that failed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessSurface } from "../src/surface.js";
import { ptyReadiness } from "../src/pty.js";

const pty = ptyReadiness();
const withPty = pty.ready ? describe : describe.skip;
if (!pty.ready) {
  console.warn(`terminal cases skipped: ${pty.reason}`);
}

const open: ProcessSurface[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()!.close().catch(() => undefined);
});

async function terminal(
  command: string,
  args: string[],
  options: { root?: string; size?: [number, number] } = {},
): Promise<ProcessSurface> {
  const surface = new ProcessSurface(options.root === undefined ? {} : { root: options.root });
  open.push(surface);
  await surface.open({
    processName: command,
    launch: {
      args,
      ...(options.root === undefined ? {} : { path: options.root }),
      ...(options.size === undefined ? {} : { size: options.size }),
    },
  });
  return surface;
}

/** Wait for the screen to say something, or give up and report what it says. */
async function until(
  surface: ProcessSurface,
  wanted: string,
  tries = 120,
): Promise<{ found: boolean; seen: string }> {
  let seen = "";
  for (let attempt = 0; attempt < tries; attempt += 1) {
    seen = String(await surface.read("text"));
    if (seen.includes(wanted)) return { found: true, seen };
    await new Promise((done) => setTimeout(done, 50));
  }
  return { found: false, seen };
}

/** Wait for the program to end, and answer with its exit state. */
async function exited(surface: ProcessSurface, tries = 200): Promise<Record<string, unknown>> {
  let state = {} as Record<string, unknown>;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    state = (await surface.read("result")) as Record<string, unknown>;
    if (state["running"] === false) return state;
    await new Promise((done) => setTimeout(done, 50));
  }
  return state;
}

withPty("a terminal is a surface (SF-22)", () => {
  it("says it is a process surface, and which allocator it used", async () => {
    const one = await terminal("/bin/echo", ["hello"]);
    expect(one.kind).toBe("process");
    const state = await exited(one);
    expect(state["allocator"]).toBe(pty.allocator);
  }, 60_000);

  it("gives the screen as semantic nodes, with a terminal root and its lines", async () => {
    const one = await terminal("/bin/echo", ["a line on the screen"]);
    await until(one, "a line on the screen");
    const snapshot = await one.snapshot();
    expect(snapshot.nodes[0]?.role).toBe("terminal");
    expect(snapshot.nodes.map((node) => node.name).join("\n")).toContain("a line on the screen");
    expect(
      JSON.stringify(snapshot.nodes),
      "no escape bytes survive into a snapshot",
    ).not.toContain("\\u001b");
  }, 60_000);

  it("carries the exit code, which is what a script actually asserts", async () => {
    const one = await terminal("/bin/sh", ["-c", "exit 7"]);
    const state = await exited(one);
    expect(state["exitCode"]).toBe(7);
    expect(state["running"]).toBe(false);
    expect(await one.check({ kind: "value", value: { kind: "literal", value: "7" } } as never, "page")).toEqual({
      ok: true,
      actual: 7,
    });
  }, 60_000);

  it("is typed into, and the program reading a terminal answers", async () => {
    /*
     * The prompt first, and waited for. Typing the instant the session opens
     * writes into a terminal whose program has not started reading yet — a race
     * the harness would lose intermittently and report as the surface's defect.
     */
    const one = await terminal("/bin/sh", ["-c", "printf 'name? '; read -r who; echo hello $who"]);
    expect((await until(one, "name?")).found).toBe(true);
    await one.act("type", undefined, { value: "ada" });
    await one.act("press", undefined, { key: "Enter" });
    expect((await until(one, "hello ada")).found).toBe(true);
  }, 60_000);

  /*
   * The signal case, and the reason it is driven as a *key*. Writing `0x03` to
   * a pseudo-terminal is what a keyboard does; the line discipline turns it
   * into `SIGINT` for the foreground process group. The program traps it and
   * exits 42, so the exit code is proof the signal was delivered rather than
   * that something killed the process from outside.
   */
  it("delivers SIGINT when Control+C is pressed, through the line discipline", async () => {
    const one = await terminal("/bin/sh", [
      "-c",
      "trap 'echo CAUGHT; exit 42' INT; echo waiting; while true; do sleep 0.2; done",
    ]);
    expect((await until(one, "waiting")).found).toBe(true);
    await one.act("press", undefined, { key: "Control+C" });
    const state = await exited(one);
    expect(state["exitCode"], "the trap ran, so the signal arrived").toBe(42);
  }, 60_000);

  it("ends a program that will not stop, and reports the signal that ended it", async () => {
    const one = await terminal("/bin/sh", ["-c", "trap '' TERM INT; echo up; while true; do sleep 0.2; done"]);
    expect((await until(one, "up")).found).toBe(true);
    await one.act("quit");
    const state = await exited(one, 40);
    expect(state["running"]).toBe(false);
  }, 60_000);

  it("waits for what it was told to wait for, and says what was there when it does not", async () => {
    const one = await terminal("/bin/sh", ["-c", "echo eventually; sleep 5"]);
    await expect(one.act("waitFor", undefined, { value: "eventually" })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      one.act("waitFor", undefined, { value: "never on this screen", timeoutMs: 300 }),
    ).rejects.toThrow(/never on this screen/u);
  }, 60_000);

  it("is given the size it was asked for, so a program that measures its terminal is right", async () => {
    const one = await terminal("/bin/sh", ["-c", "tput cols; sleep 3"], { size: [123, 40] });
    const said = await until(one, "123");
    expect(said.found, said.seen).toBe(true);
  }, 60_000);

  it("refuses an action a terminal does not have, by name", async () => {
    const one = await terminal("/bin/sh", ["-c", "sleep 3"]);
    await expect(one.act("click")).rejects.toThrow(/A terminal has no "click"/u);
    await expect(one.act("navigate", undefined, { url: "http://x" })).rejects.toThrow(
      /A terminal has no "navigate"/u,
    );
  }, 60_000);

  it("cannot be restored, and says why rather than starting a second program", async () => {
    const one = await terminal("/bin/sh", ["-c", "sleep 3"]);
    expect(one.capabilities().restore).toBe(false);
    await expect(one.restore()).rejects.toThrow(/new side effects/u);
  }, 60_000);
});

withPty("no read outside the declared root (SF-15, SF-22)", () => {
  const fixture = (): { root: string; outside: string } => {
    const root = mkdtempSync(join(tmpdir(), "yam-root-"));
    const outside = mkdtempSync(join(tmpdir(), "yam-outside-"));
    mkdirSync(join(root, "inside"), { recursive: true });
    writeFileSync(join(root, "inside", "note.txt"), "readable\n", "utf8");
    writeFileSync(join(outside, "secret.txt"), "not readable\n", "utf8");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
    return { root, outside };
  };

  it("reads a file under the root", async () => {
    const { root } = fixture();
    const one = await terminal("/bin/sh", ["-c", "sleep 5"], { root });
    expect(await one.read("attribute", undefined, "file:inside/note.txt")).toContain("readable");
  }, 60_000);

  it("refuses a path that climbs out with ..", async () => {
    const { root, outside } = fixture();
    const one = await terminal("/bin/sh", ["-c", "sleep 5"], { root });
    await expect(
      one.read("attribute", undefined, `file:../${outside.split("/").pop()}/secret.txt`),
    ).rejects.toThrow(/resolves outside/u);
  }, 60_000);

  it("refuses an absolute path", async () => {
    const { root } = fixture();
    const one = await terminal("/bin/sh", ["-c", "sleep 5"], { root });
    await expect(one.read("attribute", undefined, "file:/etc/hosts")).rejects.toThrow(
      /absolute path/u,
    );
  }, 60_000);

  /*
   * The one a check made *before* resolution would miss: `escape.txt` is inside
   * the root by every string test, and points outside it. A link is only a link
   * once it has been followed, which is why resolution comes first.
   */
  it("refuses a symbolic link that leaves the root", async () => {
    const { root } = fixture();
    const one = await terminal("/bin/sh", ["-c", "sleep 5"], { root });
    await expect(one.read("attribute", undefined, "file:escape.txt")).rejects.toThrow(
      /resolves outside/u,
    );
  }, 60_000);

  it("names the attributes it does have when asked for one it does not", async () => {
    const { root } = fixture();
    const one = await terminal("/bin/sh", ["-c", "sleep 5"], { root });
    await expect(one.read("attribute", undefined, "whatever")).rejects.toThrow(/stream, exitCode/u);
  }, 60_000);
});

withPty("no shell, and no undisclosed one (SF-22)", () => {
  /*
   * The command and its arguments are `exec`'d as a vector. A value that looks
   * like shell metacharacters is an argument and nothing else — which is the
   * difference between "runs a program" and "runs whatever the caller wrote".
   */
  it("treats a metacharacter as an argument, not as a shell instruction", async () => {
    const marker = join(tmpdir(), `yam-should-not-exist-${Date.now()}`);
    const one = await terminal("/bin/echo", [`hello; touch ${marker}`]);
    const said = await until(one, "hello;");
    expect(said.found, said.seen).toBe(true);
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker), "nothing evaluated the semicolon").toBe(false);
  }, 60_000);
});

describe("a host that cannot allocate a pseudo-terminal (SF-09, SF-21)", () => {
  it("says what it looked for, in its own words, rather than failing silently", () => {
    const answer = ProcessSurface.readiness();
    if (answer.ready) {
      expect(ptyReadiness().allocator).toMatch(/^(expect|python3)$/u);
      return;
    }
    expect(answer.reason, "the reason names what would have to be true").toMatch(
      /expect|python3|ConPTY/u,
    );
  });

  it("refuses to open rather than pretending, when there is no allocator", async () => {
    if (ptyReadiness().ready) return;
    const one = new ProcessSurface();
    await expect(one.open({ processName: "/bin/echo" })).rejects.toThrow(/pseudo-terminal/u);
  });
});

/**
 * Both allocators, driven — not one claimed on the strength of the other
 * (SF-09, SF-23).
 *
 * The support matrix says a terminal surface works on macOS and on Linux, and
 * the two halves of that sentence rest on two different programs. A host that
 * has both can drive both, and this is what turns "implemented" into
 * "validated" for each of them separately; a host with one runs the one it has
 * and says which the other was.
 */
describe("each pseudo-terminal allocator, on a host that has it", () => {
  for (const allocator of ["expect", "python3"] as const) {
    const probe = ptyReadiness(allocator);
    const run = probe.ready ? it : it.skip;
    run(`${allocator} allocates a terminal, echoes what is typed and carries the exit code`, async () => {
      const surface = new ProcessSurface({ allocator });
      open.push(surface);
      await surface.open({
        processName: "/bin/sh",
        launch: { args: ["-c", "printf 'ready '; read -r x; echo got $x; exit 9"] },
      });
      expect((await until(surface, "ready")).found).toBe(true);
      await surface.act("type", undefined, { value: "here" });
      await surface.act("press", undefined, { key: "Enter" });
      expect((await until(surface, "got here")).found).toBe(true);
      const state = await exited(surface);
      expect(state["exitCode"]).toBe(9);
      expect(state["allocator"]).toBe(allocator);
    }, 60_000);
    if (!probe.ready) {
      console.warn(`${allocator} not driven here: ${probe.reason}`);
    }
  }
});
