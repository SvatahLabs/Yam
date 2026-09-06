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

type Call = { script: string; argument: unknown; timeoutMs: number; language?: string };

const answering = (
  stdout: string,
  extra: Partial<Awaited<ReturnType<Run>>> = {},
): { run: Run; calls: Call[] } => {
  const calls: Call[] = [];
  const run: Run = async (script, argument, timeoutMs, language) => {
    calls.push({ script, argument, timeoutMs, ...(language === undefined ? {} : { language }) });
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

/**
 * The delimited answer `WINDOW_SCRIPT` writes: ASCII 30 between records, ASCII
 * 31 between fields, a header record first. Built here rather than pasted so a
 * test reads as the tree it means.
 */
const RS = "\u001e";
const US = "\u001f";
const node = (fields: Record<number, string>): string => {
  const row = new Array<string>(19).fill("");
  for (const [at, value] of Object.entries(fields)) row[Number(at)] = value;
  return row.join(US);
};

/** `AXFrame` as the script sends it: base64 of four little-endian doubles. */
const frame = (x: number, y: number, width: number, height: number): string => {
  const bytes = Buffer.alloc(32);
  [x, y, width, height].forEach((one, at) => bytes.writeDoubleLE(one, at * 8));
  return bytes.toString("base64");
};
const answer = (
  header: { title?: string; flags?: string; calls?: number },
  nodes: readonly string[],
): string =>
  [
    ["OK", header.title ?? "", header.flags ?? "", String(header.calls ?? 0), String(nodes.length)].join(US),
    ...nodes,
  ].join(RS);

describe("reading a window", () => {
  it("sends the process, the node budget and its own deadline, as JXA", async () => {
    const { run, calls } = answering(
      answer({ title: "Svatah ADE", calls: 40 }, [
        node({ 0: "-1", 1: "AXWindow", 3: "Svatah ADE" }),
        node({ 0: "0", 1: "AXButton", 3: "Run", 8: "1", 17: "AXPress", 18: frame(10, 20, 80, 24) }),
      ]),
    );
    const window = await osascriptBridge({ process: "Svatah ADE", run }).window({
      process: "Svatah ADE",
      maxNodes: 500,
    });

    expect(window.title).toBe("Svatah ADE");
    expect(window.nodes).toHaveLength(2);
    expect(window.nodes[1]).toMatchObject({
      parent: 0,
      role: "AXButton",
      title: "Run",
      enabled: true,
      box: [10, 20, 80, 24],
      actions: ["AXPress"],
    });

    /*
     * The script's own deadline is inside the caller's, so a window it cannot
     * finish answers with numbers rather than being killed with none (§7.5).
     * The margin is the `osascript` process itself: spawning it and loading the
     * Objective-C bridge metadata happens before the script's clock starts.
     */
    expect(calls[0]!.argument).toEqual({
      process: "Svatah ADE",
      maxNodes: 500,
      deadlineMs: 9_000,
    });
    expect(calls[0]!.timeoutMs).toBe(10_000);
    expect(calls[0]!.language).toBe("JavaScript");
  });

  it("honours the caller's deadline rather than its own (P7-F5, Draft 2.9 §7.5)", async () => {
    /*
     * `osascriptBridge({ timeoutMs: 180000 }).window(…)` stopped at ten seconds:
     * `window` read only `windowDeadlineMs`, and the caller's number reached
     * the perform script and nothing else.
     */
    const session = answering(answer({}, [node({ 0: "-1", 1: "AXWindow" })]));
    await osascriptBridge({ process: "x", timeoutMs: 60_000, run: session.run }).window({
      process: "x",
      maxNodes: 10,
    });
    expect(session.calls[0]!.timeoutMs).toBe(60_000);
    expect((session.calls[0]!.argument as { deadlineMs: number }).deadlineMs).toBe(59_000);

    // And a per-call deadline beats the session's, because it is more specific.
    const perCall = answering(answer({}, [node({ 0: "-1", 1: "AXWindow" })]));
    await osascriptBridge({ process: "x", timeoutMs: 60_000, run: perCall.run }).window({
      process: "x",
      maxNodes: 10,
      deadlineMs: 20_000,
    });
    expect(perCall.calls[0]!.timeoutMs).toBe(20_000);
  });

  it("publishes what the read cost, which is what the report has to say", async () => {
    const { run } = answering(
      answer({ calls: 103 }, [node({ 0: "-1", 1: "AXWindow" }), node({ 0: "0", 1: "AXGroup" })]),
    );
    const window = await osascriptBridge({ process: "Svatah ADE", run }).window({
      process: "Svatah ADE",
      maxNodes: 500,
    });
    // §7.5: "The desktop conformance report records nodes read, wall time, and
    // milliseconds per node."
    expect(window.cost.nodes).toBe(2);
    expect(window.cost.axCalls).toBe(103);
    // And one process per snapshot, which is the "bounded number of process
    // invocations" the section asks for.
    expect(window.cost.invocations).toBe(1);
    expect(window.cost.msPerNode).toBeCloseTo(window.cost.wallMs / 2, 1);
  });

  it("reads the window through the accessibility API, not through Apple events", async () => {
    const { run, calls } = answering(answer({}, [node({ 0: "-1", 1: "AXWindow" })]));
    await osascriptBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 });
    const script = calls[0]!.script;

    /*
     * Draft 2.9 §7.5's native helper, stated as a test. Phase 7's bulk reads
     * over System Events measured 51–55 ms per node on the ADE's project screen
     * — 25 s for one snapshot — because a Chromium tree is mostly containers
     * and the walk cost one to four Apple events each. This reads
     * `AXUIElement` directly, at about 1.5 ms per node.
     */
    expect(script).toContain("ObjC.import('ApplicationServices')");
    expect(script).toContain("$.AXUIElementCopyAttributeValue(element, $(name), out)");
    expect(script).toContain("$.AXUIElementCreateApplication(pid)");
    // No System Events anywhere in the read: that is the whole change.
    expect(script).not.toContain("System Events");
    expect(script).not.toContain("every UI element");
  });

  it("takes the window it verified, and refuses an element that is not one", async () => {
    /*
     * `AXChildren` is not guaranteed acyclic, and an application element whose
     * children are itself and its menu bar fills the budget with menu items and
     * no window. The role is asserted before the walk, and the walk has a depth
     * cap for whatever the assertion does not catch.
     */
    const { run, calls } = answering(answer({}, [node({ 0: "-1", 1: "AXWindow" })]));
    await osascriptBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 });
    expect(calls[0]!.script).toContain("=== 'AXWindow'");
    expect(calls[0]!.script).toContain("job.depth >= 60");
  });

  it("says which application had no window, and which had no process", async () => {
    const noWindow = answering(["ERR", "no-window"].join(US));
    await expect(
      osascriptBridge({ process: "Svatah ADE", run: noWindow.run }).window({
        process: "Svatah ADE",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/"Svatah ADE" has no window/);

    const noProcess = answering(["ERR", "no-process"].join(US));
    await expect(
      osascriptBridge({ process: "Svatah ADE", run: noProcess.run }).window({
        process: "Svatah ADE",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/No application process is named "Svatah ADE"/);
  });

  it("reports a blown budget as a bridge timeout with the numbers, once granted", async () => {
    /*
     * F1, and the sentence Draft 2.8 §7.5 added for it: "A deadline exceeded
     * after `doctor` reported `granted` is reported as a bridge timeout with
     * those numbers, never as a permission prompt." Phase 6's message said the
     * opposite and sent the verifier to System Settings for a defect that was
     * in the bridge.
     */
    const run: Run = async (script) => {
      if (script.includes("uiElements()")) {
        return { code: 0, stdout: '{"ok":true}', stderr: "", timedOut: false };
      }
      return {
        code: 0,
        stdout: answer({ flags: "D", calls: 260 }, [
          node({ 0: "-1", 1: "AXWindow" }),
          node({ 0: "0", 1: "AXGroup" }),
        ]),
        stderr: "",
        timedOut: false,
      };
    };
    const bridge = osascriptBridge({ process: "Svatah ADE", run });
    expect((await bridge.permission()).state).toBe("granted");

    await expect(
      bridge.window({ process: "Svatah ADE", maxNodes: 500 }),
    ).rejects.toThrow(/did not finish reading the window of "Svatah ADE" within 10000 ms: 2 nodes/);
    await expect(bridge.window({ process: "Svatah ADE", maxNodes: 500 })).rejects.toThrow(
      /not a permission prompt/,
    );
  });

  it("still reads a killed process as the prompt when the permission is unknown", async () => {
    const run: Run = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    await expect(
      osascriptBridge({ process: "Svatah ADE", run }).window({
        process: "Svatah ADE",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/svatah surface doctor/);
  });

  it("does not lose a node over one missing attribute", async () => {
    // Asking a macOS element for an attribute it does not have answers a
    // non-zero `AXError` rather than a value. Every read goes through `attr`,
    // which turns that into `undefined` and an empty field — so an element
    // without `AXDOMIdentifier` costs that field and nothing else. The bulk
    // read this replaces was all-or-nothing over a whole set of children.
    const { run, calls } = answering(answer({}, []));
    await osascriptBridge({ process: "x", run }).window({ process: "x", maxNodes: 1 });
    expect(calls[0]!.script).toContain("!== 0) return undefined");
    expect(calls[0]!.script).toContain("AXDOMIdentifier");
  });

  it("reads AXFrame out of its base64, because JXA cannot take a struct from an AXValue", async () => {
    const { run } = answering(
      answer({}, [node({ 0: "-1", 1: "AXWindow", 18: frame(12.5, -3, 1280, 852) })]),
    );
    const window = await osascriptBridge({ process: "x", run }).window({
      process: "x",
      maxNodes: 1,
    });
    expect(window.nodes[0]!.box).toEqual([12.5, -3, 1280, 852]);
  });

  it("reports an answer in no known shape as such", async () => {
    const { run } = answering("not the format at all");
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
