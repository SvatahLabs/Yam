/**
 * A pseudo-terminal a caller can write to (T22, SF-22).
 *
 * ## Why this is not `script(1)`
 *
 * The repository already reaches a pty through `script(1)`, and the note in
 * `tools/repo-checks/test/tui-pty.test.ts` says exactly why that could only ever
 * be half of a terminal surface:
 *
 * > Typing into a pseudo-terminal means writing to its *master*, and `script`
 * > gives a caller no way to reach one: its only input is its own stdin, which
 * > must already be a terminal.
 *
 * Measured here: `script -q /dev/null …` spawned with a piped stdin answers
 * `script: tcgetattr/ioctl: Operation not supported on socket` and exits 1. So a
 * surface built on it could capture a TUI and never press a key in one, which is
 * why the parity gate's two cockpit checks are `unreachable` on Yam's side.
 *
 * ## What it is instead
 *
 * A program that already ships with the operating system, allocating the pty and
 * copying it to and from this process's pipes. Two of them, because no single
 * one is on every host:
 *
 * | Allocator | Where it is | Where it is not |
 * |---|---|---|
 * | `expect(1)` | every macOS install (`/usr/bin/expect`), and most BSDs | not installed by default on Debian/Ubuntu |
 * | `python3` with its `pty` module | every mainstream Linux | not on a stock macOS without the developer tools |
 *
 * Between them they cover macOS and Linux with **no dependency and no native
 * build**, which is the constraint that ruled out `node-pty`. A host with
 * neither is not a failure: `readiness()` says which programs it looked for and
 * what it found, in its own words, and the adapter refuses before it spawns
 * anything.
 *
 * ## No shell, disclosed
 *
 * SF-22: "no undisclosed shell escape". There is no shell here at all — the
 * command and its arguments are handed to the allocator as a vector and
 * `exec`'d directly, so a value that happens to contain `;` or `$(…)` is an
 * argument and nothing else. Both allocators are given the vector; neither is
 * given a command line to parse.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

export interface PtyOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly columns: number;
  readonly rows: number;
}

export interface Pty {
  /** Which program allocated it, for the record and for the support matrix. */
  readonly allocator: "expect" | "python3";
  write(data: string): void;
  onData(handler: (chunk: string) => void): void;
  onExit(handler: (status: { code: number | null; signal: string | null }) => void): void;
  /** SIGTERM, then SIGKILL if it will not go. Resolves when it has gone. */
  stop(gracefulMs?: number): Promise<void>;
  readonly pid: number | undefined;
  readonly running: boolean;
}

/**
 * Is a program on this host, and does it answer its probe?
 *
 * The exit status is the answer. This read only whether the program started,
 * so `python3 -c "import pty"` counted as a Python with a `pty` module on
 * Windows, where the import fails — `pty` needs `termios`, which is Unix's —
 * and the Windows runner tried to drive a terminal it could not allocate.
 */
function present(program: string, probe: readonly string[]): boolean {
  const asked = spawnSync(program, [...probe], { encoding: "utf8", timeout: 10_000 });
  return asked.error === undefined && asked.status === 0;
}

export interface PtyReadiness {
  readonly ready: boolean;
  readonly allocator?: "expect" | "python3";
  readonly reason?: string;
}

/**
 * Whether this host can allocate a pseudo-terminal, and with what.
 *
 * The reason is the probe's own account of what it looked for. "An adapter's
 * presence in a dropdown is insufficient evidence of support" (SF-09), and so is
 * a platform check: what matters is whether the program is actually there.
 */
export function ptyReadiness(prefer?: "expect" | "python3"): PtyReadiness {
  /*
   * A caller may name the allocator (`YAM_PTY_ALLOCATOR`), which is how both of
   * them come to be *driven* on a host that has both rather than one being
   * claimed on the strength of the other (SF-09: an adapter's presence in a
   * dropdown is insufficient evidence of support). A named allocator that is
   * not there is a refusal that says so, not a silent fall back to the other.
   */
  /*
   * Windows first, named or not: neither allocator can give a terminal there,
   * so naming one is not a reason to try.
   */
  if (process.platform === "win32") {
    return {
      ready: false,
      reason:
        "a pseudo-terminal on Windows is a ConPTY, which neither `expect` nor Python's `pty` " +
        "module provides; no Windows terminal surface is implemented",
    };
  }
  const named = prefer ?? (process.env["YAM_PTY_ALLOCATOR"] as "expect" | "python3" | undefined);
  if (named !== undefined) {
    const probe = named === "expect" ? ["-v"] : ["-c", "import pty"];
    return present(named, probe)
      ? { ready: true, allocator: named }
      : {
          ready: false,
          reason: `\`${named}\` was asked for and is not on this host.`,
        };
  }
  if (present("expect", ["-v"])) return { ready: true, allocator: "expect" };
  if (present("python3", ["-c", "import pty"])) return { ready: true, allocator: "python3" };
  return {
    ready: false,
    reason:
      "no pseudo-terminal could be allocated: `expect` is not on this host (it ships with macOS " +
      "and is the `expect` package on Linux) and neither is a `python3` with its `pty` module. " +
      "Install either one and this surface works with no further change.",
  };
}

/**
 * `expect`'s script, and how the command reaches it.
 *
 * **Through the environment, never interpolated.** The first draft built the
 * script by writing the command into it with Tcl brace quoting, and measured
 * here: inside `{ }` Tcl performs no substitution at all, so the backslashes
 * that quoting added *survived into the argument* — `echo hello $who` reached
 * the program as `echo hello \$who` and printed the variable's name. An
 * environment variable is an opaque string with no quoting rules, `$env(NAME)`
 * reads one as a single word, and `{*}` expands a list without re-parsing it.
 * So no value the caller supplies is ever parsed as Tcl.
 *
 * `stty_init` sets the pty's window size *before* the spawn, because a pty
 * allocated with no controlling terminal is 0×0 and a program that asks how wide
 * its terminal is would be told nothing. `interact` copies this process's stdin
 * into the pty master, which is the whole reason `expect` is here rather than
 * `script`. `wait` afterwards is what turns the child's status into this
 * process's exit code — `interact` alone reports its own.
 */
const EXPECT_SCRIPT = [
  "set timeout -1",
  'set stty_init "cols $env(YAM_PTY_COLUMNS) rows $env(YAM_PTY_ROWS)"',
  "cd $env(YAM_PTY_CWD)",
  "set cmd {}",
  'for {set i 0} {$i < $env(YAM_PTY_ARGC)} {incr i} {',
  "  lappend cmd $env(YAM_PTY_ARG$i)",
  "}",
  "spawn -noecho {*}$cmd",
  "interact",
  "catch wait result",
  "exit [lindex $result 3]",
].join("\n");

/** The command vector, as environment variables no quoting rule applies to. */
function ptyEnvironment(options: PtyOptions): Record<string, string> {
  const argv = [options.command, ...options.args];
  return {
    YAM_PTY_CWD: options.cwd,
    YAM_PTY_COLUMNS: String(options.columns),
    YAM_PTY_ROWS: String(options.rows),
    YAM_PTY_ARGC: String(argv.length),
    ...Object.fromEntries(argv.map((one, at) => [`YAM_PTY_ARG${at}`, one])),
  };
}

/**
 * Python's, for a host with no `expect`.
 *
 * `pty.fork` gives the child a controlling terminal, `TIOCSWINSZ` sizes it, and
 * the loop copies both ways. `execvp` — never a shell.
 */
const PYTHON_BRIDGE = [
  "import os, pty, sys, select, fcntl, termios, struct, json",
  "spec = json.loads(sys.argv[1])",
  "pid, fd = pty.fork()",
  "if pid == 0:",
  "    os.chdir(spec['cwd'])",
  "    os.execvp(spec['command'], [spec['command']] + spec['args'])",
  "fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', spec['rows'], spec['columns'], 0, 0))",
  "while True:",
  "    try:",
  "        ready, _, _ = select.select([fd, 0], [], [])",
  "    except (OSError, ValueError):",
  "        break",
  "    if fd in ready:",
  "        try:",
  "            data = os.read(fd, 65536)",
  "        except OSError:",
  "            break",
  "        if not data:",
  "            break",
  "        os.write(1, data)",
  "    if 0 in ready:",
  "        data = os.read(0, 65536)",
  "        if data:",
  "            os.write(fd, data)",
  "_, status = os.waitpid(pid, 0)",
  "sys.exit(os.waitstatus_to_exitcode(status) & 0xFF if status else 0)",
].join("\n");

/** Open a pseudo-terminal running the command. */
export function openPty(options: PtyOptions & { allocator?: "expect" | "python3" }): Pty {
  const readiness = ptyReadiness(options.allocator);
  if (!readiness.ready) throw new Error(readiness.reason);
  const allocator = readiness.allocator!;

  const env = {
    ...options.env,
    TERM: options.env["TERM"] ?? "xterm-256color",
    ...ptyEnvironment(options),
  };
  const child: ChildProcess =
    allocator === "expect"
      ? spawn("expect", ["-c", EXPECT_SCRIPT], {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: options.cwd,
          env,
        })
      : spawn(
          "python3",
          [
            "-c",
            PYTHON_BRIDGE,
            JSON.stringify({
              command: options.command,
              args: [...options.args],
              cwd: options.cwd,
              columns: options.columns,
              rows: options.rows,
            }),
          ],
          { stdio: ["pipe", "pipe", "pipe"], cwd: options.cwd, env },
        );

  let alive = true;
  let exit: { code: number | null; signal: string | null } | undefined;
  const exitHandlers: Array<(status: { code: number | null; signal: string | null }) => void> = [];
  child.once("exit", (code, signal) => {
    alive = false;
    exit = { code, signal };
    for (const handler of exitHandlers) handler(exit);
  });

  return {
    allocator,
    write(data) {
      if (alive) child.stdin?.write(data);
    },
    onData(handler) {
      /*
       * Both streams, because a pty has only one: what a program writes to its
       * stderr goes to the same terminal a person is looking at, and a snapshot
       * that showed only stdout would be a snapshot of half the screen. The
       * allocator's *own* diagnostics arrive on its stderr too, which is why
       * both are spawned with `-noecho` / no banner.
       */
      child.stdout?.on("data", (chunk: Buffer) => handler(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => handler(chunk.toString("utf8")));
    },
    onExit(handler) {
      if (exit !== undefined) {
        handler(exit);
        return;
      }
      exitHandlers.push(handler);
    },
    async stop(gracefulMs = 5_000) {
      if (!alive) return;
      await new Promise<void>((done) => {
        const hard = setTimeout(() => child.kill("SIGKILL"), gracefulMs);
        child.once("exit", () => {
          clearTimeout(hard);
          done();
        });
        child.kill("SIGTERM");
      });
    },
    get pid() {
      return child.pid;
    },
    get running() {
      return alive;
    },
  };
}
