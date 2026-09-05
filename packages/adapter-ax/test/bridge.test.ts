/**
 * The `osascript` bridge (T6.2, LLD §7.5).
 *
 * The runner is injected, so what is tested here is everything except macOS
 * itself: which script is sent, how a timeout is read, how a refusal is
 * classified, and what `svatah surface doctor` is told.
 *
 * The timeout behaviour is the part that matters most and is the part hardest to
 * see. An `osascript` that trips the Accessibility prompt blocks on a dialog
 * nobody may be there to answer and fails with `-1712` after about two minutes.
 * A `doctor` that inherited that wait would be useless exactly when it is
 * needed, so the deadline is short and a timeout is *an answer about the
 * permission* rather than an error.
 */
import { describe, expect, it, vi } from "vitest";
import { AxBridgeError, osascriptBridge, type runOsascript } from "../src/index.js";

type Run = typeof runOsascript;

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

describe("the permission check (REQ-ADP-7, `svatah surface doctor`)", () => {
  it("is granted only when an assistive-access call answers", async () => {
    const { run, calls } = answering('{"ok":true,"processes":42,"elements":7}');
    const permission = await osascriptBridge({ process: "Svatah ADE", run }).permission();
    expect(permission.state).toBe("granted");

    /*
     * The check has to read **UI elements**, not count processes.
     *
     * Counting `applicationProcesses` needs only Automation permission for
     * System Events and succeeds on a machine where the accessibility API is
     * refused — so a `doctor` built on it reported `granted` while every
     * `snapshot` failed with `-25211`. That is the worst kind of diagnostic:
     * confidently wrong, and it sends the reader to look at the adapter.
     */
    expect(calls[0]!.script).toContain("uiElements()");
    // And it touches no application under test.
    expect(calls[0]!.script).not.toContain("Svatah ADE");
  });

  it("reads `not allowed assistive access` as denied, which is what it is", async () => {
    const refused: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Error: Error: osascript is not allowed assistive access. (-25211)",
      timedOut: false,
    });
    const permission = await osascriptBridge({ process: "Svatah ADE", run: refused }).permission();
    expect(permission.state).toBe("denied");
    expect(permission.advice).toContain("restart it");
  });

  it("reads a timeout as the unanswered prompt, and says where to grant it", async () => {
    const run: Run = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    const permission = await osascriptBridge({ process: "Svatah ADE", run }).permission();
    expect(permission.state).toBe("prompt-pending");
    expect(permission.advice).toContain("System Settings → Privacy & Security → Accessibility");
    // The part people get wrong: the grant is per program, so one granted to
    // Terminal does not carry to a test runner or a CI agent.
    expect(permission.advice).toContain("per program");
  });

  it("uses a short deadline, because a blocked prompt takes two minutes", async () => {
    const { run, calls } = answering('{"ok":true}');
    await osascriptBridge({ process: "Svatah ADE", run, timeoutMs: 60_000 }).permission();
    expect(calls[0]!.timeoutMs).toBe(5_000);
  });

  it("distinguishes a refusal from a prompt nobody has answered", async () => {
    const denied: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Not authorised to send Apple events (-1743)",
      timedOut: false,
    });
    const permission = await osascriptBridge({ process: "Svatah ADE", run: denied }).permission();
    expect(permission.state).toBe("denied");
    // The other thing people get wrong: macOS does not re-read the setting for
    // a process that is already running.
    expect(permission.advice).toContain("restart it");
    expect(permission.detail).toContain("-1743");
  });

  it("says a machine that is not macOS is unsupported, without spawning anything", async () => {
    const run = vi.fn<Run>();
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const permission = await osascriptBridge({ process: "x", run }).permission();
      expect(permission.state).toBe("unsupported");
      expect(permission.advice).toContain("--adapter uia");
      expect(run).not.toHaveBeenCalled();
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
        nodes: [{ parent: -1, role: "AXWindow", title: "Svatah ADE" }],
      }),
    );
    const window = await osascriptBridge({ process: "Svatah ADE", run }).window({
      process: "Svatah ADE",
      maxNodes: 500,
    });
    expect(window.nodes).toHaveLength(1);
    expect(calls[0]!.argument).toEqual({ process: "Svatah ADE", maxNodes: 500 });
    // Breadth-first with a budget, so a truncated tree is the top of the window
    // rather than one deep branch of it.
    expect(calls[0]!.script).toContain("queue.shift()");
  });

  it("says which application had no window", async () => {
    const { run } = answering(JSON.stringify({ ok: false, error: "no-window" }));
    await expect(
      osascriptBridge({ process: "Svatah ADE", run }).window({
        process: "Svatah ADE",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/"Svatah ADE" has no window/);
  });

  it("reads a timeout as the permission prompt, and names the way to check", async () => {
    const run: Run = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    await expect(
      osascriptBridge({ process: "Svatah ADE", run }).window({
        process: "Svatah ADE",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/svatah surface doctor/);
  });

  it("does not lose a whole tree over one missing attribute", async () => {
    // Asking a macOS element for an attribute it does not have *throws* rather
    // than answering null, so every read in the script is wrapped.
    const { run, calls } = answering(JSON.stringify({ ok: true, nodes: [] }));
    await osascriptBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 });
    expect(calls[0]!.script).toMatch(/function attr\(element, name\) \{\s*try \{/);
  });

  it("reports something that is not JSON as such", async () => {
    const { run } = answering("not json at all");
    await expect(
      osascriptBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 }),
    ).rejects.toThrow(AxBridgeError);
  });
});

describe("performing a command", () => {
  it("addresses an element by its path, because a specifier does not survive", async () => {
    const { run, calls } = answering('{"ok":true}');
    await osascriptBridge({ process: "Svatah ADE", run }).perform({
      kind: "action",
      path: [0, 3, 1],
      action: "AXPress",
    });
    expect(calls[0]!.argument).toEqual({
      kind: "action",
      path: [0, 3, 1],
      action: "AXPress",
      process: "Svatah ADE",
    });
  });

  it("reports a stale path rather than acting on whatever is there now", async () => {
    const { run } = answering(JSON.stringify({ ok: false, error: "stale-path" }));
    await expect(
      osascriptBridge({ process: "x", run }).perform({ kind: "focus", path: [9] }),
    ).rejects.toThrow(/stale-path/);
  });

  it("carries modifiers on a keystroke", async () => {
    const { run, calls } = answering('{"ok":true}');
    await osascriptBridge({ process: "x", run }).perform({
      kind: "keycode",
      code: 36,
      using: ["command down"],
    });
    expect(calls[0]!.argument).toMatchObject({ code: 36, using: ["command down"] });
  });
});
