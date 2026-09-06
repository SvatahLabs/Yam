/**
 * Starting and stopping a desktop application (T11.2, LLD §13.9, §7.5).
 *
 * > Desktop adapters take `app.launch` (the executable or bundle, arguments,
 * > environment) and `app.quit` (a graceful route, then a signal) in
 * > configuration; the session opens by launching when no process of that name
 * > owns a window and closes by quitting; the language gains `Quit the app`
 * > (pattern 31, `action: "quit"`), which ends the session through the graceful
 * > route and fails if the process survives it.
 *
 * Here rather than in each adapter, because it is the same three decisions on
 * every platform and only the commands differ. The AX and UIA adapters are
 * about *reading a tree*; whether a process exists is not an accessibility
 * question.
 *
 * ## Three things this file knows that are not obvious
 *
 * **`open -n` on macOS, not `spawn`.** A GUI application forked from a process
 * that is not in the user's Aqua session never attaches to the WindowServer: it
 * runs, its renderer runs, and it has no window that either the accessibility
 * API or System Events can see, for ever. Measured on this project — a direct
 * `spawn` polled for 37 s and answered `windows=0` at every step, while the
 * same build opened with `open -n` answered `1` (LLD §7.5). `open` hands the
 * launch to LaunchServices, which places it in the session a person is looking
 * at.
 *
 * **A signal is not a quit.** Node's default `SIGTERM` handling ends a main
 * process where it stands, so an Electron application never runs `before-quit`
 * — the app's `yam serve` child was left with no parent to stop it, one
 * orphan per launch (P10-F1). The graceful route is an Apple-event `quit` on
 * macOS and `CloseMainWindow` on Windows; the signal is what follows if it does
 * not work, and `SIGKILL` is what follows that.
 *
 * **"Running" is not "has a window".** A process that is still exiting, and a
 * helper process that shares its application's name, are both running and
 * neither can be driven. The caller decides what "ready" means — it is an
 * accessibility question after all — and passes it in.
 */
import { spawnSync } from "node:child_process";

/** Where the application is and how to start it (`config.app.launch`). */
export interface LaunchConfig {
  /** A macOS `.app` bundle, opened through LaunchServices. */
  readonly bundle?: string;
  /** An executable, spawned directly. Windows and Linux. */
  readonly path?: string;
  readonly args?: readonly string[];
  /** Added to the launched process's environment, never to Yam's. */
  readonly env?: Readonly<Record<string, string>>;
  /** How long to wait for a window. Default 60 s, as LLD §15's gate does. */
  readonly timeoutMs?: number;
  /**
   * The window's size once it exists, `[width, height]` (pattern 33, T12.7).
   *
   * The adapter applies it through the same route `Resize the window to …`
   * uses, so an initial size and a mid-flow resize are one mechanism.
   */
  readonly size?: readonly [number, number];
}

/** How to stop it (`config.app.quit`). */
export interface QuitConfig {
  /** macOS: an Apple-event `quit` to this bundle identifier. */
  readonly bundleId?: string;
  /** How long the graceful route is given. Default 10 s. */
  readonly gracefulMs?: number;
  /** How long the signal is given before `SIGKILL`. Default 20 s. */
  readonly signalMs?: number;
}

/** What ran, so a caller can say what it did and a test can see it. */
export interface LifecycleStep {
  readonly what: "launch" | "graceful" | "signal" | "kill";
  readonly command: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/** The commands this module runs. Injected, so every path above is testable. */
export interface Runner {
  run(command: string, args: readonly string[], env?: Readonly<Record<string, string>>): {
    status: number | null;
    stdout: string;
    stderr: string;
  };
}

export const systemRunner: Runner = {
  run(command, args, env) {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      timeout: 30_000,
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
};

const DEFAULT_LAUNCH_TIMEOUT_MS = 60_000;
const DEFAULT_GRACEFUL_MS = 10_000;
const DEFAULT_SIGNAL_MS = 20_000;

/** The executable a `pgrep -f` / `taskkill` addresses, for either shape. */
export function executableOf(launch: LaunchConfig, platform: string): string | undefined {
  if (launch.path !== undefined) return launch.path;
  if (launch.bundle === undefined) return undefined;
  if (platform !== "darwin") return launch.bundle;
  /*
   * `Foo.app/Contents/MacOS/Foo`, which is the *command line* of the process
   * LaunchServices starts — and so what `pgrep -f` matches. The bundle path on
   * its own matches nothing, and matching the product name alone would catch
   * somebody else's copy of the same application (P10-F7).
   */
  const name = launch.bundle.replace(/\/+$/, "").split("/").pop() ?? "";
  return `${launch.bundle.replace(/\/+$/, "")}/Contents/MacOS/${name.replace(/\.app$/, "")}`;
}

/**
 * Start the application.
 *
 * Returns the step it took; whether it is *ready* is the caller's question and
 * `waitFor` is how it asks.
 */
export function launchApplication(
  launch: LaunchConfig,
  options: { platform?: string; runner?: Runner } = {},
): LifecycleStep {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? systemRunner;
  const environment = launch.env ?? {};

  if (platform === "darwin" && launch.bundle !== undefined) {
    /*
     * `-n` a new instance and `-F` a fresh one: a restored window from a
     * previous run must not stand in for this launch. The environment goes on
     * the command line because `open` starts the application through
     * LaunchServices, which does not inherit this process's environment.
     */
    const args = ["-n", "-F"];
    for (const [name, value] of Object.entries(environment)) args.push("--env", `${name}=${value}`);
    args.push("-a", launch.bundle);
    for (const one of launch.args ?? []) args.push("--args", one);
    const result = runner.run("open", args);
    return {
      what: "launch",
      command: `open ${args.join(" ")}`,
      ok: result.status === 0,
      ...(result.status === 0 ? {} : { detail: result.stderr.trim() || result.stdout.trim() }),
    };
  }

  const executable = launch.path ?? launch.bundle;
  if (executable === undefined) {
    return {
      what: "launch",
      command: "(nothing to launch)",
      ok: false,
      detail:
        "`app.launch` names neither a `bundle` nor a `path`, so there is nothing to start.",
    };
  }
  const result = runner.run(executable, launch.args ?? [], environment);
  return {
    what: "launch",
    command: `${executable} ${(launch.args ?? []).join(" ")}`.trim(),
    // A spawned GUI application does not exit, so a null status is the normal
    // answer here and only a non-zero one is a failure.
    ok: result.status === null || result.status === 0,
    ...(result.status === null || result.status === 0
      ? {}
      : { detail: result.stderr.trim() || result.stdout.trim() }),
  };
}

/** The process ids of this executable, right now. */
export function processIdsOf(
  executable: string,
  options: { platform?: string; runner?: Runner } = {},
): number[] {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? systemRunner;
  const parse = (text: string): number[] =>
    text
      .split("\n")
      .map((one) => Number(one.trim()))
      .filter((one) => Number.isInteger(one) && one > 0);

  if (platform === "win32") {
    const name = executable.split(/[\\/]/).pop() ?? executable;
    const found = runner.run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Get-Process -Name '${name.replace(/\.exe$/i, "")}' -ErrorAction SilentlyContinue | ` +
        "Select-Object -ExpandProperty Id",
    ]);
    return parse(found.stdout);
  }
  // By the executable *path*: unique to this build, so another copy of the same
  // application installed elsewhere is neither counted nor stopped (P10-F7).
  return parse(runner.run("pgrep", ["-f", executable]).stdout);
}

/**
 * Stop it: the graceful route, then a signal, then a harder one.
 *
 * Every phase has its own clock. Sharing one meant escalating to `SIGKILL` five
 * seconds after `SIGTERM`, which is the defect P8-F1 is about in a new place.
 */
export async function quitApplication(
  executable: string,
  quit: QuitConfig = {},
  options: {
    platform?: string;
    runner?: Runner;
    /** For tests: how the waiting is done. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ gone: boolean; steps: LifecycleStep[]; ms: number }> {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? systemRunner;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const startedAt = Date.now();
  const steps: LifecycleStep[] = [];
  const alive = (): number[] => processIdsOf(executable, { platform, runner });

  if (alive().length === 0) return { gone: true, steps, ms: 0 };

  /* ── 1. the graceful route ─────────────────────────────────────────────── */

  if (platform === "darwin" && quit.bundleId !== undefined) {
    const script = `tell application id "${quit.bundleId}" to quit`;
    const result = runner.run("osascript", ["-e", script]);
    steps.push({
      what: "graceful",
      command: `osascript -e '${script}'`,
      ok: result.status === 0,
      ...(result.status === 0 ? {} : { detail: result.stderr.trim() }),
    });
  } else if (platform === "win32") {
    const name = (executable.split(/[\\/]/).pop() ?? executable).replace(/\.exe$/i, "");
    const command =
      `Get-Process -Name '${name}' -ErrorAction SilentlyContinue | ` +
      "ForEach-Object { $_.CloseMainWindow() | Out-Null }";
    const result = runner.run("powershell.exe", ["-NoProfile", "-Command", command]);
    steps.push({
      what: "graceful",
      command,
      ok: result.status === 0,
      ...(result.status === 0 ? {} : { detail: result.stderr.trim() }),
    });
  }

  const graceful = quit.gracefulMs ?? DEFAULT_GRACEFUL_MS;
  for (let waited = 0; waited < graceful; waited += 250) {
    if (alive().length === 0) return { gone: true, steps, ms: Date.now() - startedAt };
    await sleep(250);
  }

  /* ── 2. a signal, on its own clock ─────────────────────────────────────── */

  if (platform === "win32") {
    for (const pid of alive()) {
      runner.run("taskkill", ["/PID", String(pid)]);
    }
    steps.push({ what: "signal", command: "taskkill /PID …", ok: true });
  } else {
    runner.run("pkill", ["-f", executable]);
    steps.push({ what: "signal", command: `pkill -f ${executable}`, ok: true });
  }

  const signalled = Date.now();
  const signal = quit.signalMs ?? DEFAULT_SIGNAL_MS;
  for (let waited = 0; waited < signal; waited += 250) {
    if (alive().length === 0) return { gone: true, steps, ms: Date.now() - startedAt };
    await sleep(250);
  }
  void signalled;

  /* ── 3. and the one nothing can catch ──────────────────────────────────── */

  if (platform === "win32") {
    for (const pid of alive()) runner.run("taskkill", ["/PID", String(pid), "/F"]);
    steps.push({ what: "kill", command: "taskkill /F", ok: true });
  } else {
    runner.run("pkill", ["-9", "-f", executable]);
    steps.push({ what: "kill", command: `pkill -9 -f ${executable}`, ok: true });
  }
  for (let waited = 0; waited < 5_000; waited += 250) {
    if (alive().length === 0) return { gone: true, steps, ms: Date.now() - startedAt };
    await sleep(250);
  }
  return { gone: alive().length === 0, steps, ms: Date.now() - startedAt };
}

/**
 * Wait for a condition, and say how long it took.
 *
 * "The application is ready" is the caller's question — for a desktop adapter
 * it is "does a process of that name own a window an accessibility client can
 * read", which is an accessibility question and belongs in the adapter.
 */
export async function waitFor(
  ready: () => Promise<boolean>,
  options: { timeoutMs?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ready: boolean; ms: number }> {
  const timeout = options.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const every = options.everyMs ?? 500;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const startedAt = Date.now();
  for (;;) {
    if (await ready()) return { ready: true, ms: Date.now() - startedAt };
    if (Date.now() - startedAt >= timeout) return { ready: false, ms: Date.now() - startedAt };
    await sleep(every);
  }
}
