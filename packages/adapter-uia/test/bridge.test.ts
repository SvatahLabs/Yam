/**
 * The PowerShell bridge (T6.1, LLD §7.5).
 *
 * The runner is injected, so what is tested here is everything except Windows:
 * which script is sent, how a timeout is read, how a refusal is classified, and
 * what `svatah surface doctor` is told.
 */
import { describe, expect, it, vi } from "vitest";
import { powershellBridge, UiaBridgeError, type runPowershell } from "../src/index.js";

type Run = typeof runPowershell;

const answering = (
  stdout: string,
  extra: Partial<Awaited<ReturnType<Run>>> = {},
): { run: Run; calls: Array<{ script: string; argument: unknown; timeoutMs: number }> } => {
  const calls: Array<{ script: string; argument: unknown; timeoutMs: number }> = [];
  const run: Run = async (script, argument, timeoutMs) => {
    calls.push({ script, argument, timeoutMs });
    return { code: 0, stdout, stderr: "", timedOut: false, ...extra };
  };
  return { run, calls };
};

describe("availability (`svatah surface doctor`)", () => {
  it("is available when UIAutomationClient loads", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const { run, calls } = answering('{"ok":true,"root":"Desktop"}');
      const availability = await powershellBridge({ process: "Svatah ADE", run }).availability();
      expect(availability.state).toBe("available");
      // The smallest call: load the assembly and read the root. It touches no
      // application, so a failure is about the host rather than about the target.
      expect(calls[0]!.script).toContain("UIAutomationClient");
      expect(calls[0]!.script).not.toContain("Svatah ADE");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("says a machine that is not Windows is unsupported, without spawning anything", async () => {
    const run = vi.fn<Run>();
    const availability = await powershellBridge({ process: "x", run }).availability();
    expect(availability.state).toBe("unsupported");
    expect(availability.advice).toContain("--adapter ax");
    expect(run).not.toHaveBeenCalled();
  });

  it("explains the two things that actually go wrong on Windows", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const run: Run = async () => ({
        code: 1,
        stdout: "",
        stderr: "Cannot load assembly",
        timedOut: false,
      });
      const availability = await powershellBridge({ process: "x", run }).availability();
      expect(availability.state).toBe("unavailable");
      // Constrained Language Mode, and integrity level. Not "permission",
      // because UI Automation has none — which is the thing someone coming from
      // the macOS adapter will assume.
      expect(availability.advice).toContain("Constrained Language Mode");
      expect(availability.advice).toContain("integrity level");
      expect(availability.advice).toContain("needs no permission grant");
      expect(availability.detail).toContain("Cannot load assembly");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});

describe("reading a window", () => {
  it("sends the process and the node budget, and parses the tree", async () => {
    const { run, calls } = answering(
      JSON.stringify({
        ok: true,
        process: "Svatah ADE",
        title: "Svatah ADE",
        truncated: false,
        nodes: [{ parent: -1, controlType: "Window", name: "Svatah ADE" }],
      }),
    );
    const window = await powershellBridge({ process: "Svatah ADE", run }).window({
      process: "Svatah ADE",
      maxNodes: 500,
    });
    expect(window.nodes).toHaveLength(1);
    expect(calls[0]!.argument).toEqual({ process: "Svatah ADE", maxNodes: 500 });
    // Breadth-first with a budget, and the ControlView walker — not the raw
    // tree, which is full of nodes no user can see.
    expect(calls[0]!.script).toContain("ControlViewWalker");
    expect(calls[0]!.script).toContain("$queue.Dequeue()");
  });

  it("names the integrity-level trap when there is no window", async () => {
    /*
     * The failure that wastes the most time on Windows: an application started
     * as administrator is invisible to a UI Automation client that was not.
     */
    const { run } = answering(JSON.stringify({ ok: false, error: "no-window" }));
    await expect(
      powershellBridge({ process: "Svatah ADE", run }).window({
        process: "Svatah ADE",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/higher integrity level/);
  });

  it("does not lose a whole tree over one element that vanished", async () => {
    // An element that disappears between the walk finding it and the walk
    // reading it throws `ElementNotAvailableException` — ordinary in a live
    // application, and not a reason to lose everything.
    const { run, calls } = answering(JSON.stringify({ ok: true, nodes: [] }));
    await powershellBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 });
    expect(calls[0]!.script).toContain("function Get-Prop");
    expect(calls[0]!.script).toMatch(/try \{ return \$element\.GetCurrentPropertyValue/);
  });

  it("reports something that is not JSON as such", async () => {
    const { run } = answering("At line:1 char:1 …");
    await expect(
      powershellBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 }),
    ).rejects.toThrow(UiaBridgeError);
  });
});

describe("performing a command", () => {
  it("addresses an element by its path, because a COM object does not survive", async () => {
    const { run, calls } = answering('{"ok":true}');
    await powershellBridge({ process: "Svatah ADE", run }).perform({
      kind: "pattern",
      path: [0, 3, 1],
      pattern: "Invoke",
      method: "Invoke",
    });
    expect(calls[0]!.argument).toEqual({
      kind: "pattern",
      path: [0, 3, 1],
      pattern: "Invoke",
      method: "Invoke",
      process: "Svatah ADE",
    });
  });

  it("reports a stale path rather than acting on whatever is there now", async () => {
    const { run } = answering(JSON.stringify({ ok: false, error: "stale-path" }));
    await expect(
      powershellBridge({ process: "x", run }).perform({ kind: "focus", path: [9] }),
    ).rejects.toThrow(/stale-path/);
  });

  it("runs PowerShell without a profile and without waiting for a prompt", async () => {
    /*
     * A profile can print, and printed output lands in the JSON; nobody is
     * there to answer a prompt. Both are asserted because both have silently
     * broken scripts like this one before.
     */
    const { runPowershell: real } = await import("../src/bridge.js");
    expect(real).toBeTypeOf("function");
    const source = (await import("node:fs")).readFileSync(
      new URL("../src/bridge.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain('"-NoProfile"');
    expect(source).toContain('"-NonInteractive"');
  });
});
