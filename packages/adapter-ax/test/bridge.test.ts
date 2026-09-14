/**
 * The `osascript` bridge (T6.2, LLD §7.5).
 *
 * The runner is injected, so what is tested here is everything except macOS
 * itself: which script is sent, how a timeout is read, how a refusal is
 * classified, and what `yam surface doctor` is told.
 *
 * The timeout behaviour is the part that matters most and is the part hardest to
 * see. An `osascript` that trips the Accessibility prompt blocks on a dialog
 * nobody may be there to answer and fails with `-1712` after about two minutes.
 * A `doctor` that inherited that wait would be useless exactly when it is
 * needed, so the deadline is short and a timeout is *an answer about the
 * permission* rather than an error.
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AxBridgeError,
  machineLoad,
  osascriptBridge,
  PERFORM_SCRIPT,
  type runOsascript,
} from "../src/index.js";
import { ambiguityAware, parseWindow } from "../src/bridge.js";

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

describe("the permission check (REQ-ADP-7, `yam surface doctor`)", () => {
  it("is granted only when an assistive-access call answers", async () => {
    const { run, calls } = answering('{"ok":true,"processes":42,"elements":7}');
    const permission = await osascriptBridge({ process: "Yam", run, platform: "darwin" }).permission();
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
    expect(calls[0]!.script).not.toContain("Yam");
  });

  it("reads `not allowed assistive access` as denied, which is what it is", async () => {
    const refused: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Error: Error: osascript is not allowed assistive access. (-25211)",
      timedOut: false,
    });
    const permission = await osascriptBridge({ process: "Yam", run: refused, platform: "darwin" }).permission();
    expect(permission.state).toBe("denied");
    expect(permission.advice).toContain("restart it");
  });

  it("reads a timeout as the unanswered prompt, and says where to grant it", async () => {
    const run: Run = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    const permission = await osascriptBridge({ process: "Yam", run, platform: "darwin" }).permission();
    expect(permission.state).toBe("prompt-pending");
    expect(permission.advice).toContain("System Settings → Privacy & Security → Accessibility");
    // The part people get wrong: the grant is per application, so one granted
    // to Terminal does not carry to a test runner or a CI agent — and it is the
    // program that *starts* Yam that is granted, never Yam.
    expect(permission.advice).toContain("per application");
    expect(permission.advice).toContain("never Yam itself");
    // And it names the way to be asked rather than only the settings pane.
    expect(permission.advice).toContain("yam surface grant");
  });

  it("uses a short deadline, because a blocked prompt takes two minutes", async () => {
    const { run, calls } = answering('{"ok":true}');
    await osascriptBridge({ process: "Yam", run, timeoutMs: 60_000, platform: "darwin" }).permission();
    expect(calls[0]!.timeoutMs).toBe(5_000);
  });

  it("distinguishes a refusal from a prompt nobody has answered", async () => {
    const denied: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Not authorised to send Apple events (-1743)",
      timedOut: false,
    });
    const permission = await osascriptBridge({ process: "Yam", run: denied, platform: "darwin" }).permission();
    expect(permission.state).toBe("denied");
    // The other thing people get wrong: macOS does not re-read the setting for
    // a process that is already running.
    expect(permission.advice).toContain("restart it");
    expect(permission.detail).toContain("-1743");
  });

  it("says a machine that is not macOS is unsupported, without spawning anything", async () => {
    const run = vi.fn<Run>();
    const permission = await osascriptBridge({ process: "x", run, platform: "linux" }).permission();
    expect(permission.state).toBe("unsupported");
    expect(permission.advice).toContain("--adapter uia");
    expect(run).not.toHaveBeenCalled();
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

/**
 * An ambiguous name is reported as ambiguity (`EX-07`, `B21`).
 *
 * Yam drove the packaged Yam and `--app Yam` failed with *"the application has
 * gone"*. It had not gone. Two processes were named "Yam" — the packaged
 * application and a copy started from a checkout — and the one the walk reached
 * first owned no window. An ambiguity reported as an absence sends a person
 * looking for a crash that did not happen, while the thing to do is to name the
 * target more precisely.
 *
 * The script's own walk cannot run here: it reads `NSWorkspace` through the
 * ObjC bridge, which exists only inside `osascript`. What is checked is the
 * contract between the two halves — the answer the script writes, and the
 * sentence the bridge makes of it.
 */
describe("an ambiguous process name (EX-07)", () => {
  it("carries the pids back out of the script's answer", () => {
    const parsed = parseWindow(["ERR", "ambiguous", "4312,4477"].join(US));
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("ambiguous");
    expect(parsed.detail).toBe("4312,4477");
  });

  it("says how many answered, and what to do about it", () => {
    const said = ambiguityAware("Yam", { error: "ambiguous", detail: "4312,4477" });
    expect(said).toContain("2 processes are named \"Yam\"");
    expect(said).toContain("4312,4477");
    /* The claim it must not make. */
    expect(said).not.toContain("Is it running?");
    /* And a way out, because a diagnosis with no next step is half of one. */
    expect(said).toMatch(/--attach|bundle identifier/);
  });

  it("still says the two things that were true before", () => {
    expect(ambiguityAware("Yam", { error: "no-window" })).toContain("has no window");
    expect(ambiguityAware("Yam", { error: "no-process" })).toContain("No application process");
  });

  it("says the same thing when only the count is known", () => {
    /*
     * The action path goes through System Events, which answers a count where
     * the read path's accessibility walk answers pids. Both must reach the same
     * sentence, or half the adapter still blames the wrong thing.
     */
    const said = ambiguityAware("Yam", { error: "ambiguous", detail: "2 of them" });
    expect(said).toContain("2 processes are named \"Yam\"");
    /* The count is all this path has; inventing a pid list would be worse. */
    expect(said).not.toContain("pids");
    /*
     * It does say "has gone" — in the clause that rules it out. What it must
     * not do is *offer* it as the diagnosis, which is what `B21` was.
     */
    expect(said).toContain("This is an ambiguity, not an application that has gone");
    expect(said).toMatch(/--attach|bundle identifier/);
  });

  it("does not call one process an ambiguity", () => {
    /*
     * Shown to bite in the other direction. The script only writes `ambiguous`
     * when more than one pid answered, and a rule that called every no-window a
     * possible ambiguity would be as wrong as the sentence it replaces.
     */
    expect(ambiguityAware("Yam", { error: "no-window" })).not.toContain("ambiguity");
  });
});

/*
 * P11 — two oracles for one question, and only a no from both is a cause.
 *
 * The action path asks System Events, which answers under its own permission
 * and its own load; the read path goes at the accessibility API directly. A
 * click against a window the API had read one step earlier came back
 * `no-window` beside a running eval, and the parity gate published it as a
 * disagreement with an external oracle that had just passed the same case. So
 * when System Events says there is no window, the API is asked, and the action
 * is re-sent while the API says otherwise.
 */
describe("an action System Events refused for no window (P11)", () => {
  /** A fake `osascript` that answers per script: perform, then window. */
  const oracles = (
    performs: readonly string[],
    windowStdout: string,
  ): { run: Run; sent: () => readonly string[] } => {
    const sent: string[] = [];
    let at = 0;
    const run: Run = async (script, argument, _timeoutMs, _language) => {
      if (script.includes("processWithWindow")) {
        const kind = (argument as { kind?: string }).kind ?? "?";
        sent.push(kind);
        if (kind === "activate") return { code: 0, stdout: '{"ok":true}', stderr: "", timedOut: false };
        const stdout = performs[Math.min(at, performs.length - 1)]!;
        at += 1;
        return { code: 0, stdout, stderr: "", timedOut: false };
      }
      return { code: 0, stdout: windowStdout, stderr: "", timedOut: false };
    };
    return { run, sent: () => sent };
  };

  const aWindow = (): string =>
    answer({ title: "Yam" }, [node({ 0: "-1", 1: "AXWindow", 3: "Yam" })]);

  it("shows the application and sends it again, while the API can see the window", async () => {
    const { run, sent } = oracles(['{"ok":false,"error":"no-window"}', '{"ok":true}'], aWindow());
    await osascriptBridge({ process: "Yam", run }).perform({
      kind: "action",
      path: [0],
      action: "AXPress",
    });
    // The action, then the activate that un-hides a hidden application, then
    // the action again — which is what a hidden window needs and what a busy
    // System Events needs too.
    expect(sent()).toEqual(["action", "activate", "action"]);
  });

  it("is a cause when both oracles say there is no window", async () => {
    const { run } = oracles(['{"ok":false,"error":"no-window"}'], "ERR\u001fno-window");
    await expect(
      osascriptBridge({ process: "Yam", run }).perform({
        kind: "action",
        path: [0],
        action: "AXPress",
      }),
    ).rejects.toThrow(/no window for "Yam"/);
  });

  it("does not ask the API at all when the action worked", async () => {
    let windowReads = 0;
    const run: Run = async (script) => {
      if (!script.includes("processWithWindow")) windowReads += 1;
      return { code: 0, stdout: '{"ok":true}', stderr: "", timedOut: false };
    };
    await osascriptBridge({ process: "Yam", run }).perform({
      kind: "action",
      path: [0],
      action: "AXPress",
    });
    expect(windowReads).toBe(0);
  });
});

describe("reading a window", () => {
  it("sends the process, the node budget and its own deadline, as JXA", async () => {
    const { run, calls } = answering(
      answer({ title: "Yam", calls: 40 }, [
        node({ 0: "-1", 1: "AXWindow", 3: "Yam" }),
        node({ 0: "0", 1: "AXButton", 3: "Run", 8: "1", 17: "AXPress", 18: frame(10, 20, 80, 24) }),
      ]),
    );
    const window = await osascriptBridge({ process: "Yam", run }).window({
      process: "Yam",
      maxNodes: 500,
    });

    expect(window.title).toBe("Yam");
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
      process: "Yam",
      maxNodes: 500,
      deadlineMs: 9_000,
    });
    expect(calls[0]!.timeoutMs).toBe(10_000);
    expect(calls[0]!.language).toBe("JavaScript");
  });

  it("reads the DOM classes Chromium publishes, for the fingerprint", async () => {
    /*
     * Without them a desktop fingerprint had no attributes at all, and the
     * macOS gate could not tell the renamed Flows rail row from the section
     * header above it: both buttons, both current, side by side.
     */
    const { run, calls } = answering(
      answer({ title: "Yam" }, [
        node({ 0: "-1", 1: "AXWindow", 3: "Yam" }),
        node({ 0: "0", 1: "AXButton", 3: "Flows", 19: "sv-rail-item sv-rail-active" }),
        node({ 0: "0", 1: "AXButton", 3: "Runs" }),
      ]),
    );
    const window = await osascriptBridge({ process: "Yam", run }).window({ process: "Yam", maxNodes: 10 });
    expect(window.nodes[1]!.domClassList).toBe("sv-rail-item sv-rail-active");
    expect(window.nodes[2]!.domClassList).toBeUndefined();
    expect(calls[0]!.script).toContain("words(attr(element, 'AXDOMClassList'))");
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
    const window = await osascriptBridge({ process: "Yam", run }).window({
      process: "Yam",
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
     * over System Events measured 51–55 ms per node on the app's project screen
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
      osascriptBridge({ process: "Yam", run: noWindow.run }).window({
        process: "Yam",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/"Yam" has no window/);

    const noProcess = answering(["ERR", "no-process"].join(US));
    await expect(
      osascriptBridge({ process: "Yam", run: noProcess.run }).window({
        process: "Yam",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/No application process is named "Yam"/);
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
    const bridge = osascriptBridge({ process: "Yam", run, platform: "darwin" });
    expect((await bridge.permission()).state).toBe("granted");

    await expect(
      bridge.window({ process: "Yam", maxNodes: 500 }),
    ).rejects.toThrow(/did not finish reading the window of "Yam" within 10000 ms: 2 nodes/);
    await expect(bridge.window({ process: "Yam", maxNodes: 500 })).rejects.toThrow(
      /not a permission prompt/,
    );
  });

  it("still reads a killed process as the prompt when the permission is unknown", async () => {
    const run: Run = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    await expect(
      osascriptBridge({ process: "Yam", run }).window({
        process: "Yam",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/yam surface doctor/);
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
    await osascriptBridge({ process: "Yam", run }).perform({
      kind: "action",
      path: [0, 3, 1],
      action: "AXPress",
    });
    expect(calls[0]!.argument).toEqual({
      kind: "action",
      path: [0, 3, 1],
      action: "AXPress",
      process: "Yam",
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

/**
 * P8-F1 — several processes share the target's name, and only one has a window.
 *
 * > When several processes share the name, the bridge addresses the one that
 * > owns a window. (Draft 2.10, LLD §7.5)
 *
 * `window()` already chose that way — `frontWindowOf` walks
 * `NSWorkspace.runningApplications` and skips anything with no `AXWindow`. The
 * *perform* script did not: it asked System Events for
 * `applicationProcesses.byName(…)`, which answers the first match, and for the
 * seconds after a `pkill` the first match is the instance that is still exiting.
 *
 * The script is macOS-only and never runs anywhere a test does, so it is
 * executed here against a fake System Events: three processes called "Yam
 * APP_DIR", the first two with no window, the third with the one the command must
 * reach.
 */
describe("the perform script chooses the process that owns a window (P8-F1)", () => {
  /** One fake System Events process: a name, and the windows it will admit to. */
  interface FakeProcess {
    readonly name: string;
    /** The window's children, or an empty list for "this instance has no window". */
    readonly children: readonly unknown[];
    /** A process that throws when asked for its windows, as a dying one can. */
    readonly refuses?: boolean;
    /**
     * How many times this process answers "no windows" before it answers with
     * the one it has had all along — System Events under load (P11).
     */
    readonly emptyFirst?: number;
  }

  /** Run `PERFORM_SCRIPT`'s `run(argv)` against a fake `Application(name)`. */
  function perform(
    command: Record<string, unknown>,
    processes: readonly FakeProcess[],
  ): { answer: { ok: boolean; error?: string }; frontmost: readonly string[] } {
    const frontmost: string[] = [];
    const asked = new Map<number, number>();
    const wrapped = processes.map((one, at) => ({
      name: one.name,
      windows: () => {
        if (one.refuses === true) throw new Error("the process refuses the question");
        const before = asked.get(at) ?? 0;
        asked.set(at, before + 1);
        if (before < (one.emptyFirst ?? 0)) return [];
        return one.children.length === 0 ? [] : [{ uiElements: () => one.children }];
      },
      set frontmost(_value: boolean) {
        frontmost.push(`${one.name}#${at}`);
      },
    }));
    const application = (): unknown => ({
      applicationProcesses: {
        whose:
          ({ name }: { name: string }) =>
          () =>
            wrapped.filter((one) => one.name === name),
        byName: (name: string) => wrapped.find((one) => one.name === name),
      },
      keystroke: () => undefined,
      keyCode: () => undefined,
      click: () => undefined,
    });

    const factory = new Function("Application", `${PERFORM_SCRIPT}\nreturn run;`) as (
      app: unknown,
    ) => (argv: string[]) => string;
    return {
      answer: JSON.parse(factory(application)([JSON.stringify(command)])) as {
        ok: boolean;
        error?: string;
      },
      frontmost,
    };
  }

  const noWindow: FakeProcess = { name: "Yam", children: [] };
  const withWindow = (mark: { pressed: boolean }): FakeProcess => ({
    name: "Yam",
    children: [
      {
        actions: {
          byName: () => ({
            perform: () => {
              mark.pressed = true;
            },
          }),
        },
      },
    ],
  });

  it("presses the element in the instance that has a window, not the first match", () => {
    const mark = { pressed: false };
    const { answer } = perform({ kind: "action", path: [0], action: "AXPress", process: "Yam" }, [
      noWindow,
      noWindow,
      withWindow(mark),
    ]);
    expect(answer.ok).toBe(true);
    expect(mark.pressed).toBe(true);
  });

  it("skips a process that refuses the question rather than failing on it", () => {
    const mark = { pressed: false };
    const { answer } = perform({ kind: "action", path: [0], action: "AXPress", process: "Yam" }, [
      { ...noWindow, refuses: true },
      withWindow(mark),
    ]);
    expect(answer.ok).toBe(true);
    expect(mark.pressed).toBe(true);
  });

  it("activates the windowed instance too", () => {
    const { answer, frontmost } = perform({ kind: "activate", process: "Yam" }, [
      noWindow,
      withWindow({ pressed: false }),
    ]);
    expect(answer.ok).toBe(true);
    expect(frontmost).toEqual(["Yam#1"]);
  });

  /*
   * P11 — a click against a window the app's own log showed open answered
   * `no-window` once in roughly fifty, and the parity gate published that as a
   * disagreement with an external oracle that had just passed the same case.
   * System Events answers under its own permission and its own load, and a busy
   * answer is an empty list rather than an error. An application does not lose
   * its window between two reads a fifth of a second apart, so the script asks
   * again — and only a run of empty answers is a cause.
   */
  it("asks again when System Events answers an empty list, and finds the window", () => {
    const mark = { pressed: false };
    const { answer } = perform({ kind: "action", path: [0], action: "AXPress", process: "Yam" }, [
      { ...withWindow(mark), emptyFirst: 3 },
    ]);
    expect(answer.ok).toBe(true);
    expect(mark.pressed).toBe(true);
  });

  it("gives up after ten empty answers, so a gone application is still a cause", () => {
    const mark = { pressed: false };
    const { answer } = perform({ kind: "action", path: [0], action: "AXPress", process: "Yam" }, [
      { ...withWindow(mark), emptyFirst: 500 },
    ]);
    expect(answer.ok).toBe(false);
    expect(answer.error).toBe("no-window");
    expect(mark.pressed).toBe(false);
  });

  it("still answers `no-window` when not one of them has a window", () => {
    const { answer } = perform({ kind: "focus", path: [0], process: "Yam" }, [
      noWindow,
      noWindow,
    ]);
    expect(answer.ok).toBe(false);
    expect(answer.error).toBe("no-window");
  });
});

/**
 * P8-F2 — the cost line carries the machine, not only the bridge.
 *
 * > The bridge cost line says nothing about load (1.6 ms per node at load
 * > average seven, 29.6 beside the test suite, on one machine). Record the
 * > one-minute load average and the CPU count beside the cost.
 */
describe("the snapshot cost records what the machine was doing (P8-F2, LLD §7.5)", () => {
  /** Record and field separators, as `WINDOW_SCRIPT` writes them. */
  const RS = "\u001e";
  const US = "\u001f";
  /** One window record in that wire format. */
  const window1 = (flags: string, calls: string): string =>
    ["OK", "Yam", flags, calls, "1"].join(US) +
    RS +
    ["-1", "AXWindow", "AXStandardWindow", "Yam", ...new Array(14).fill(""), "AXRaise", ""].join(
      US,
    );

  it("puts the one-minute load average and the CPU count on every read", async () => {
    const { run } = answering(window1("", "17"));
    const window = await osascriptBridge({ process: "Yam", run }).window({
      process: "Yam",
      maxNodes: 10,
    });

    expect(window.cost.loadAverage1m).toBe(machineLoad().loadAverage1m);
    expect(window.cost.cpus).toBe(machineLoad().cpus);
    expect(window.cost.cpus).toBeGreaterThan(0);
  });

  it("puts them in the timeout message too, which is where they are needed most", async () => {
    // The `D` flag: the script stopped itself at the deadline and reported what
    // it had, which is §7.5's "bridge timeout with those numbers".
    const { run } = answering(window1("D", "9000"));
    await expect(
      osascriptBridge({ process: "Yam", run }).window({
        process: "Yam",
        maxNodes: 10,
      }),
    ).rejects.toThrow(/load average [\d.]+ over \d+ CPUs/);
  });
});

/**
 * The login-session check (T10.4, P9-F7, Draft 2.12 §7.5).
 *
 * > `yam surface doctor --adapter ax` also reports `ax/session`: whether any
 * > process in the login session owns an on-screen window; when only
 * > `loginwindow` does, the display is locked or the session has no
 * > WindowServer, and the gate names that as the cause of its exit 2 rather than
 * > a launch failure.
 *
 * The Phase 9 live gate exited 2 on a locked display for both the implementer
 * and the verifier, reporting "showed no window within 60000 ms" — which is
 * true, and points at the app.
 *
 * Draft 2.13 (P10-F1, P10-F5) makes the answer a *state* rather than a boolean,
 * because Phase 10 was lost between two of them. The owner count cannot see a
 * locked screen: macOS keeps every application's windows while the screen is
 * locked and refuses them all to an accessibility client, answering `AXWindows`
 * with a one-element list holding the *application* — so eleven applications
 * "owned a window" on a machine where nothing could be read, and four launches
 * of an app whose window was on screen were reported as an app with no window.
 * `CGSSessionScreenIsLocked` is the question that was actually being asked.
 *
 * And a probe that did not answer is `unknown`, never a cause (P10-F5).
 */
describe("the login-session check (P9-F7, Draft 2.12 §7.5, Draft 2.13)", () => {
  const macOnly = process.platform === "darwin";

  it.runIf(macOnly)("names what owns a window when something does", async () => {
    const { run, calls } = answering(
      '{"ok":true,"asked":12,"owners":["loginwindow","Yam","Finder"],' +
        '"claimed":["loginwindow","Yam","Finder"],"lockKnown":true,"locked":false,' +
        '"onConsole":true}',
    );
    const session = await osascriptBridge({ process: "Yam", run }).session();
    expect(session.usable).toBe(true);
    expect(session.state).toBe("usable");
    expect(session.owners).toContain("Yam");
    expect(session.detail).toContain("Yam");

    // It reads AXWindows per application, in one invocation, like the window
    // read — never one osascript per process.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.script).toContain("AXUIElementCreateApplication");
    expect(calls[0]!.script).toContain("AXWindows");
    expect(calls[0]!.script).toContain("runningApplications");
    // And it asks the session dictionary, which is the only thing that can see
    // a lock (P10-F1).
    expect(calls[0]!.script).toContain("CGSessionCopyCurrentDictionary");
    expect(calls[0]!.script).toContain("CGSSessionScreenIsLocked");
    // The role is the test for "owns a window", not the count (P10-F1).
    expect(calls[0]!.script).toContain("'AXWindow'");
  });

  /**
   * The finding itself (P10-F1).
   *
   * Eleven applications claim a window, the accessibility API hands none of
   * them over, and the session dictionary says why. Before Draft 2.13 this
   * answered `usable: true` — because the claim was the test — and the gate
   * then blamed the app for having no window.
   */
  it.runIf(macOnly)("says the screen is locked, whatever the owner count claims", async () => {
    const { run } = answering(
      '{"ok":true,"asked":14,"owners":[],' +
        '"claimed":["Notes","Finder","TextEdit","Yam","System Settings","Passwords",' +
        '"Keychain Access","ChatGPT","Claude","Screen Sharing","loginwindow"],' +
        '"lockKnown":true,"locked":true,"onConsole":true}',
    );
    const session = await osascriptBridge({ process: "Yam", run }).session();
    expect(session.usable).toBe(false);
    expect(session.state).toBe("locked");
    expect(session.detail).toContain("the screen is locked");
    expect(session.detail).toContain("CGSSessionScreenIsLocked");
    expect(session.detail).toContain("shows none of them");
    expect(session.advice).toContain("Unlock the display");
  });

  it.runIf(macOnly)("says the display is locked when only loginwindow owns one", async () => {
    const { run } = answering(
      '{"ok":true,"asked":9,"owners":["loginwindow"],"claimed":["loginwindow"],' +
        '"lockKnown":false,"locked":false}',
    );
    const session = await osascriptBridge({ process: "Yam", run }).session();
    expect(session.usable).toBe(false);
    expect(session.state).toBe("locked");
    expect(session.detail).toContain("loginwindow");
    expect(session.detail).toContain("the display is locked");
    expect(session.advice).toContain("exit 2");
  });

  /**
   * Windows are claimed, none can be read, and the session dictionary could not
   * be asked. That shape has two causes — a locked screen and a withdrawn
   * grant — so it names neither (P10-F5).
   */
  it.runIf(macOnly)("will not guess when it cannot read the session dictionary", async () => {
    const { run } = answering(
      '{"ok":true,"asked":14,"owners":[],"claimed":["Finder","Yam"],"lockKnown":false}',
    );
    const session = await osascriptBridge({ process: "Yam", run }).session();
    expect(session.usable).toBe(false);
    expect(session.state).toBe("unknown");
    expect(session.detail).toContain("what a locked display looks like");
    expect(session.detail).toContain("withdrawn Accessibility grant");
  });

  it.runIf(macOnly)("says so when nothing at all owns a window", async () => {
    const { run } = answering(
      '{"ok":true,"asked":4,"owners":[],"claimed":[],"lockKnown":true,"locked":false}',
    );
    const session = await osascriptBridge({ process: "Yam", run }).session();
    expect(session.usable).toBe(false);
    expect(session.state).toBe("no-session");
    expect(session.detail).toContain("no process in this login session owns a window");
  });

  it.runIf(macOnly)("answers \"could not tell\" rather than throwing, when osascript refuses", async () => {
    const refused: Run = async () => ({
      code: 1,
      stdout: "",
      stderr: "execution error: Not authorised (-1743)",
      timedOut: false,
    });
    const session = await osascriptBridge({ process: "Yam", run: refused }).session();
    expect(session.usable).toBe(false);
    // Not a cause (P10-F5): the gate may not print this as a reason.
    expect(session.state).toBe("unknown");
    expect(session.detail).toContain("could not tell");
    // The check exists to explain an exit code; one that threw would replace an
    // unexplained failure with another.
    expect(session.advice).toContain("surface doctor");
  });

  it.runIf(macOnly)("calls a timed-out probe `unknown`, never a locked display (P10-F5)", async () => {
    const slow: Run = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    const session = await osascriptBridge({ process: "Yam", run: slow }).session();
    expect(session.state).toBe("unknown");
    expect(session.detail).toContain("could not tell");
    expect(session.detail).not.toContain("locked");
    expect(session.advice).toContain("says nothing about the display either way");
  });

  it.runIf(!macOnly)("says it is a macOS question on any other host", async () => {
    const { run } = answering("{}");
    const session = await osascriptBridge({ process: "Yam", run }).session();
    expect(session.usable).toBe(false);
    expect(session.detail).toBe("not macOS");
  });
});

/**
 * The screenshot that was not taken (native-feedback D1).
 *
 * `screencapture` was spawned and the promise resolved on `close` *or* on
 * `error`, with neither the exit code nor the file looked at — so on a host
 * without the Screen Recording grant, where it prints "could not create image
 * from display" and writes nothing, `surface_screenshot` answered `status:
 * "succeeded"` with a path to a file that did not exist. `yam surface doctor`
 * named that host honestly on the line above. An agent driving a native
 * application was blind and was told it was not, which is the one failure a
 * screenshot must never have.
 */
describe("screenshots are proved, not assumed (native-feedback D1)", () => {
  const macOnly = process.platform === "darwin";

  it.runIf(macOnly)("raises when `screencapture` writes no file", async () => {
    /*
     * An unwritable path, so the assertion holds on either kind of host:
     * without the permission `screencapture` fails at the image, with it at the
     * write, and both are the case this is about — no file, non-zero exit.
     */
    const bridge = osascriptBridge({ process: "Yam" });
    const path = join(tmpdir(), "yam-no-such-directory", "shot.png");
    await expect(bridge.screenshot(path)).rejects.toThrow(AxBridgeError);
    await expect(bridge.screenshot(path)).rejects.toThrow(/No screenshot was written/);
    // And it says which permission, because that is the usual cause.
    await expect(bridge.screenshot(path)).rejects.toThrow(/Screen Recording/);
    expect(existsSync(path)).toBe(false);
  });
});
