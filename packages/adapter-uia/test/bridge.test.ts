/**
 * The PowerShell bridge (T6.1, LLD §7.5).
 *
 * The runner is injected, so what is tested here is everything except Windows:
 * which script is sent, how a timeout is read, how a refusal is classified, and
 * what `yam surface doctor` is told.
 */
import { describe, expect, it, vi } from "vitest";
import {
  encodePowershell,
  powershellBridge,
  readablePowershellError,
  UiaBridgeError,
  type runPowershell,
} from "../src/index.js";

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

describe("availability (`yam surface doctor`)", () => {
  it("is available when UIAutomationClient loads", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const { run, calls } = answering('{"ok":true,"root":"Desktop"}');
      const availability = await powershellBridge({ process: "Yam ADE", run }).availability();
      expect(availability.state).toBe("available");
      // The smallest call: load the assembly and read the root. It touches no
      // application, so a failure is about the host rather than about the target.
      expect(calls[0]!.script).toContain("UIAutomationClient");
      expect(calls[0]!.script).not.toContain("Yam ADE");
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
        process: "Yam ADE",
        title: "Yam ADE",
        truncated: false,
        nodes: [{ parent: -1, controlType: "Window", name: "Yam ADE" }],
      }),
    );
    const window = await powershellBridge({ process: "Yam ADE", run }).window({
      process: "Yam ADE",
      maxNodes: 500,
    });
    expect(window.nodes).toHaveLength(1);
    expect(calls[0]!.argument).toEqual({ process: "Yam ADE", maxNodes: 500 });
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
      powershellBridge({ process: "Yam ADE", run }).window({
        process: "Yam ADE",
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
    await powershellBridge({ process: "Yam ADE", run }).perform({
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
      process: "Yam ADE",
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

/*
 * ────────────────────────────────────────────────────────────────────────────
 * What running these scripts against a real PowerShell found (T7.2)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every test above injects its own runner, so nothing here had ever spawned
 * PowerShell, and the live Windows gate has never run (Phase 6 verification,
 * F8/K10). Driving the scripts through PowerShell 7.4.6 — which cannot do UI
 * Automation, but is the same language — found three defects that would have
 * failed every call on every Windows machine.
 */
describe("how the request reaches the script (T7.2)", () => {
  it("assigns the request instead of passing it as an argument", () => {
    /*
     * The first defect. `powershell.exe -Command <script> -Request <json>`
     * binds nothing: PowerShell's own documentation says that when `-Command`
     * is a string it "must be the last parameter in the command, because any
     * characters typed after the command are interpreted as the command
     * arguments". The JSON was appended to the script as *text* and parsed:
     *
     *   ParserError:
     *      6 |  -Request {"process":"Yam ADE","maxNodes":1500}
     *        | Unexpected token ':"Yam ADE"' in expression or statement.
     */
    const decoded = Buffer.from(
      encodePowershell("$req = $Request | ConvertFrom-Json", { process: "Yam ADE" }),
      "base64",
    ).toString("utf16le");
    expect(decoded).toContain(`$Request = '{"process":"Yam ADE"}'`);
    expect(decoded).toContain("$req = $Request | ConvertFrom-Json");
  });

  it("escapes a quote the way a PowerShell literal string does", () => {
    const decoded = Buffer.from(
      encodePowershell("", { name: "it's" }),
      "base64",
    ).toString("utf16le");
    // Doubling is the escape inside '…', and it is the only one that matters.
    expect(decoded).toContain(`$Request = '{"name":"it''s"}'`);
  });

  it("sets the console to UTF-8 before anything writes", () => {
    /*
     * The second defect. A redirected `powershell.exe` writes stdout in the
     * console code page, and Node reads UTF-8 — so every name in the ADE
     * containing "…" or "—" would have arrived mangled, and the conformance
     * target's buttons are called "Open a project…" and "Import prototype
     * database…".
     */
    const decoded = Buffer.from(encodePowershell("x", {}), "base64").toString("utf16le");
    expect(decoded.split("\n")[0]).toBe(
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    );
  });

  it("keeps a one-element pattern list a list", async () => {
    /*
     * The third defect, and the one that would have been hardest to see.
     * PowerShell unrolls a single-element array on return, so an element
     * supporting exactly one control pattern answered `"Invoke"` rather than
     * `["Invoke"]` and `ConvertTo-Json` wrote a string. The adapter then calls
     * `patterns.includes("Value")` on it — which on a string is a *substring*
     * test.
     */
    const source = (await import("node:fs")).readFileSync(
      new URL("../src/bridge.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("return ,@($names)");
    expect(source).toContain("$patterns = @(Get-PatternNames $element)");
  });

  it("answers rather than dying on a host with no UI Automation", async () => {
    /*
     * The fourth. `Add-Type -AssemblyName UIAutomationClient` under
     * `$ErrorActionPreference = "Stop"` killed the script before it wrote
     * anything, and the bridge reported "PowerShell answered something that is
     * not JSON" — a diagnostic that sends the reader to look at the adapter
     * rather than at the host.
     */
    const source = (await import("node:fs")).readFileSync(
      new URL("../src/bridge.ts", import.meta.url),
      "utf8",
    );
    expect([...source.matchAll(/no-uiautomation/g)]).toHaveLength(2);
    expect(source).toContain("no-drawing");
  });
});

describe("PowerShell's stderr, made readable (T7.2)", () => {
  it("decodes the CLIXML a redirected powershell.exe writes", () => {
    const clixml =
      '#< CLIXML\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
      '<S S="Error">_x001B_[31;1mAdd-Type: _x001B_[0m_x000A_</S>' +
      '<S S="Error">Cannot find path &lt;UIAutomationClient.dll&gt;</S></Objs>';
    const readable = readablePowershellError(clixml);
    expect(readable).toContain("Add-Type:");
    expect(readable).toContain("Cannot find path <UIAutomationClient.dll>");
    // No escapes, no colour codes, no XML.
    expect(readable).not.toContain("_x001B_");
    expect(readable).not.toContain("<S S=");
    expect(readable).not.toContain("\u001b");
  });

  it("leaves plain text alone but strips its colours", () => {
    expect(readablePowershellError("\u001b[31;1mplain\u001b[0m")).toBe("plain");
    expect(readablePowershellError("  plain  ")).toBe("plain");
  });
});
