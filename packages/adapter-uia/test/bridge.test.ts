/**
 * The PowerShell bridge (T6.1, LLD §7.5).
 *
 * The runner is injected, so what is tested here is everything except Windows:
 * which script is sent, how a timeout is read, how a refusal is classified, and
 * what `yam surface doctor` is told.
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const { run, calls } = answering('{"ok":true,"root":"Desktop"}');
    const availability = await powershellBridge({ process: "Yam", run, platform: "win32" }).availability();
    expect(availability.state).toBe("available");
    // The smallest call: load the assembly and read the root. It touches no
    // application, so a failure is about the host rather than about the target.
    expect(calls[0]!.script).toContain("UIAutomationClient");
    expect(calls[0]!.script).not.toContain("Yam");
  });

  it("says a machine that is not Windows is unsupported, without spawning anything", async () => {
    const run = vi.fn<Run>();
    for (const platform of ["darwin", "linux"] as const) {
      const availability = await powershellBridge({ process: "x", run, platform }).availability();
      expect(availability.state).toBe("unsupported");
      expect(availability.advice).toContain("--adapter ax");
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("explains the two things that actually go wrong on Windows", async () => {
    const run: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "Cannot load assembly",
      timedOut: false,
    });
    const availability = await powershellBridge({ process: "x", run, platform: "win32" }).availability();
    expect(availability.state).toBe("unavailable");
    // Constrained Language Mode, and integrity level. Not "permission",
    // because UI Automation has none — which is the thing someone coming from
    // the macOS adapter will assume.
    expect(availability.advice).toContain("Constrained Language Mode");
    expect(availability.advice).toContain("integrity level");
    expect(availability.advice).toContain("needs no permission grant");
    expect(availability.detail).toContain("Cannot load assembly");
  });
});

describe("reading a window", () => {
  it("sends the process and the node budget, and parses the tree", async () => {
    const { run, calls } = answering(
      JSON.stringify({
        ok: true,
        process: "Yam",
        title: "Yam",
        truncated: false,
        nodes: [{ parent: -1, controlType: "Window", name: "Yam" }],
      }),
    );
    const window = await powershellBridge({ process: "Yam", run }).window({
      process: "Yam",
      maxNodes: 500,
    });
    expect(window.nodes).toHaveLength(1);
    expect(calls[0]!.argument).toEqual({ process: "Yam", maxNodes: 500 });
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
      powershellBridge({ process: "Yam", run }).window({
        process: "Yam",
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

  it("hands the adapter a flat pattern list, whatever PowerShell wrapped it in", async () => {
    /*
     * On the Windows runner every node answered `[["Invoke","ScrollItem"]]`:
     * the script wrapped a list its function had already kept a list. Nothing
     * matched `includes("Invoke")`, and every click became a mouse click at a
     * box's centre — off the screen, for a palette row scrolled out of view.
     */
    const { run, calls } = answering(
      JSON.stringify({
        ok: true,
        nodes: [
          { parent: -1, controlType: "Window", patterns: [["Window", "Transform"]] },
          { parent: 0, controlType: "Button", patterns: "Invoke" },
          { parent: 0, controlType: "ListItem", patterns: ["SelectionItem", "ScrollItem"] },
          { parent: 0, controlType: "Text" },
        ],
      }),
    );
    const window = await powershellBridge({ process: "Yam", run }).window({ process: "Yam", maxNodes: 10 });
    expect(window.nodes.map((node) => node.patterns)).toEqual([
      ["Window", "Transform"],
      ["Invoke"],
      ["SelectionItem", "ScrollItem"],
      undefined,
    ]);
    expect(calls[0]!.script).not.toContain("@(Get-PatternNames");
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
    await powershellBridge({ process: "Yam", run }).perform({
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
      process: "Yam",
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

describe("the trace (YAM_UIA_TRACE)", () => {
  /*
   * The recorded trees are Chromium's, mapped on a Mac; the Windows gate runs
   * where nobody can look. The trace is what that machine saw: each tree, each
   * action, and the control the action's path arrived at.
   */
  it("appends each window read and each action, with the control the action reached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-uia-trace-"));
    const file = join(dir, "trace.jsonl");
    try {
      const run: Run = async (script) => ({
        code: 0,
        stdout: script.includes("$cmd = $Request")
          ? JSON.stringify({ ok: true, target: { controlType: "ListItem", name: "Go to Run", automationId: "palette-go-run" } })
          : JSON.stringify({ ok: true, title: "Yam", nodes: [{ parent: -1, controlType: "Window", name: "Yam" }], truncated: false }),
        stderr: "",
        timedOut: false,
      });
      const bridge = powershellBridge({ process: "Yam", run, platform: "win32", trace: file });
      await bridge.window({ process: "Yam", maxNodes: 10 });
      await bridge.perform({ kind: "pattern", path: [0, 2], pattern: "SelectionItem", method: "Select" });

      const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.map((one) => one["kind"])).toEqual(["window", "perform"]);
      expect(lines[0]!["nodes"]).toEqual([{ parent: -1, controlType: "Window", name: "Yam" }]);
      expect(lines[1]!["command"]).toMatchObject({ path: [0, 2], pattern: "SelectionItem" });
      expect(lines[1]!["target"]).toMatchObject({ automationId: "palette-go-run" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps named keys and never what was typed (REQ-NFR-6)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-uia-trace-"));
    const file = join(dir, "trace.jsonl");
    try {
      const run: Run = async (script) => ({
        code: 0,
        stdout: script.includes("$cmd = $Request")
          ? '{"ok":true}'
          : JSON.stringify({
              ok: true,
              nodes: [
                { parent: -1, controlType: "Window", name: "Yam" },
                { parent: 0, controlType: "Edit", name: "Password", value: "qwerty123" },
              ],
            }),
        stderr: "",
        timedOut: false,
      });
      const bridge = powershellBridge({ process: "Yam", run, platform: "win32", trace: file });
      await bridge.perform({ kind: "keys", text: "{ESC}" });
      await bridge.perform({ kind: "keys", text: "+{F10}" });
      await bridge.perform({ kind: "keys", text: "qwerty123" });
      await bridge.perform({ kind: "keys", text: "{{}ESC{}}" });
      await bridge.perform({ kind: "pattern", path: [1], pattern: "Value", method: "SetValue", argument: "qwerty123" });
      await bridge.window({ process: "Yam", maxNodes: 10 });

      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("qwerty123");
      const lines = text.trim().split("\n").map((line) => JSON.parse(line) as { command?: { text?: string; argument?: string } });
      expect(lines.slice(0, 4).map((one) => one.command?.text)).toEqual([
        "{ESC}",
        "+{F10}",
        "<9 characters>",
        // A typed "{ESC}", escaped by `escapeSendKeys`, is text and not a key.
        "<9 characters>",
      ]);
      expect(lines[4]!.command?.argument).toBe("<9 characters>");
      expect(text).toContain('"value":"<9 characters>"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not fail a read because its trace could not be written", async () => {
    const { run } = answering(JSON.stringify({ ok: true, nodes: [] }));
    const nowhere = join(tmpdir(), "yam-no-such-directory", "trace.jsonl");
    const window = await powershellBridge({ process: "x", run, trace: nowhere }).window({ process: "x", maxNodes: 1 });
    expect(window.nodes).toEqual([]);
  });

  it("says what had the keyboard when keys were sent, and what was under a click", () => {
    // SendKeys types into whatever is focused, and a click lands on whatever is
    // drawn at the point; the script reports both rather than assuming them.
    const source = readFileSync(new URL("../src/bridge.ts", import.meta.url), "utf8");
    expect(source).toContain("AutomationElement]::FocusedElement");
    expect(source).toContain("AutomationElement]::FromPoint");
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
     *      6 |  -Request {"process":"Yam","maxNodes":1500}
     *        | Unexpected token ':"Yam"' in expression or statement.
     */
    const decoded = Buffer.from(
      encodePowershell("$req = $Request | ConvertFrom-Json", { process: "Yam" }),
      "base64",
    ).toString("utf16le");
    expect(decoded).toContain(`$Request = '{"process":"Yam"}'`);
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
     * console code page, and Node reads UTF-8 — so every name in the app
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
     *
     * And only once. The call site used to wrap the result in `@()` as well,
     * which made every list a list inside a list on a real Windows host (see
     * "hands the adapter a flat pattern list").
     */
    const source = (await import("node:fs")).readFileSync(
      new URL("../src/bridge.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("return ,@($names)");
    expect(source).toContain("$patterns = Get-PatternNames $element");
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
