/**
 * A terminal is a surface (T22, SF-22, REQ-ADP-10).
 *
 * > Implement process/PTY as a real surface with terminal snapshot, streams,
 * > exit state, bounded files and signal semantics. Validate the Yam CLI/TUI
 * > through it.
 *
 * Everything below is reached through the operations every other surface has.
 * The catalogue gains nothing: no route, no tool, no flag. What a person does in
 * a terminal maps onto the vocabulary that already exists —
 *
 * | In a terminal | The operation | The action |
 * |---|---|---|
 * | read the screen | `snapshot`, `read`, `check` | — |
 * | type something | `act` | `type` |
 * | press Enter, or ↑, or ^C | `act` | `press` |
 * | clear the screen | `act` | `clear` |
 * | wait for a prompt | `act` | `waitFor` |
 * | end the program | `act` | `quit` |
 * | keep a copy of the screen | `act` | `screenshot` |
 * | what it exited with | `read` | `result` |
 *
 * `press "Control+C"` is not a special case bolted on for signals: writing
 * `0x03` to a pseudo-terminal is what a keyboard does, and the terminal's line
 * discipline turns it into `SIGINT` for the foreground process group. So the
 * signal semantics SF-22 asks for are the terminal's own, driven the way a
 * person drives them. `quit` is the graceful route — `SIGTERM`, then `SIGKILL`
 * if the program will not go — which is what the action already means for a
 * desktop application (pattern 31).
 *
 * ## No shell, and no read outside the declared root
 *
 * There is no shell anywhere in this adapter: the command and its arguments are
 * `exec`'d as a vector, so a value containing `;` or `$(…)` is an argument.
 * Every filesystem read resolves against a declared root and is refused outside
 * it — including through a symbolic link, which is checked after resolution
 * rather than before, because a link is only a link once it has been followed.
 *
 * ## What it is not
 *
 * It is not a terminal emulator. `screen.ts` implements the subset a
 * command-line program and a full-screen TUI use; a program that drives the
 * alternate screen buffer, the mouse or the scrollback will be rendered
 * approximately. That is said here, in `capabilities()` and in the support
 * matrix, rather than discovered.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ActArgs,
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  Config,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SnapshotNode,
  SurfaceAction,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  ActionabilityError,
  CheckError,
  DataError,
  LocateError,
  SessionError,
  buildSnapshot,
  structuralHash,
} from "@svatah/yam-surface";
import { Screen } from "./screen.js";
import { openPty, ptyReadiness, type Pty } from "./pty.js";

const ADAPTER = "process";

/** The escape a terminal key sequence begins with. */
const ESC = "\u001b";

/** The keys a caller can press, as the bytes a terminal sends. */
const KEYS: Readonly<Record<string, string>> = {
  Enter: "\r",
  Return: "\r",
  Tab: "\t",
  Escape: ESC,
  Backspace: "\u007f",
  Delete: `${ESC}[3~`,
  Up: `${ESC}[A`,
  ArrowUp: `${ESC}[A`,
  Down: `${ESC}[B`,
  ArrowDown: `${ESC}[B`,
  Right: `${ESC}[C`,
  ArrowRight: `${ESC}[C`,
  Left: `${ESC}[D`,
  ArrowLeft: `${ESC}[D`,
  Home: `${ESC}[H`,
  End: `${ESC}[F`,
  PageUp: `${ESC}[5~`,
  PageDown: `${ESC}[6~`,
  Space: " ",
};

/**
 * `Control+C` and its family, as the control characters a terminal sends.
 *
 * This is where "signal semantics" lives, and it is one line of arithmetic
 * rather than a signal API: the terminal's line discipline turns `0x03` into
 * `SIGINT`, `0x1c` into `SIGQUIT` and `0x1a` into `SIGTSTP`, for the foreground
 * process group. Driving them as keys is what a person does and is what makes
 * them observable in the same snapshot as everything else.
 */
function keyBytes(key: string): string | undefined {
  const direct = KEYS[key];
  if (direct !== undefined) return direct;
  const control = /^(?:Control|Ctrl)\+(.)$/iu.exec(key);
  if (control !== null) {
    const letter = control[1]!.toUpperCase();
    const code = letter.charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  }
  if (key.length === 1) return key;
  return undefined;
}

export interface ProcessSurfaceOptions {
  /**
   * The directory this session may read, and the one the program runs in.
   *
   * Everything `read`'s `file:` attribute resolves is under it, and anything
   * that resolves outside is refused. Defaults to the working directory, which
   * is the same thing a person gets when they open a terminal.
   */
  readonly root?: string;
  readonly columns?: number;
  readonly rows?: number;
  /**
   * Which pseudo-terminal allocator to use, when a caller wants a particular
   * one. Left alone it is whichever this host has; naming one is how each is
   * *driven* rather than claimed (SF-09).
   */
  readonly allocator?: "expect" | "python3";
}

interface Started {
  readonly pty: Pty;
  readonly screen: Screen;
  readonly command: string;
  readonly args: readonly string[];
  readonly root: string;
  exit?: { code: number | null; signal: string | null };
}

export class ProcessSurface implements AgentSurface {
  readonly kind: SurfaceKind = "process";
  private session: Started | undefined;
  /** Ref → row index, from the snapshot that issued it. */
  private refs = new Map<string, number>();
  private generation = 0;

  constructor(private readonly options: ProcessSurfaceOptions = {}) {}

  capabilities(): Capabilities {
    return {
      dialogs: false,
      frames: false,
      windows: false,
      upload: false,
      drag: false,
      trace: false,
      webmcp: false,
      pick: false,
      observe: false,
      /*
       * `screenshot` is true and means what it can mean here: a terminal has no
       * pixels, so the artifact is the screen as text. Saying `false` would
       * refuse a caller the only picture of a terminal there is.
       */
      screenshot: true,
      restore: false,
    };
  }

  /** Whether this host can run a terminal session at all, in its own words. */
  static readiness(allocator?: "expect" | "python3"): { ready: boolean; reason?: string } {
    const answer = ptyReadiness(allocator);
    return answer.ready ? { ready: true } : { ready: false, reason: answer.reason! };
  }

  async open(session: SessionInit): Promise<void> {
    if (this.session !== undefined) {
      throw new SessionError("This terminal session is already open.", { adapter: ADAPTER });
    }
    const command = session.processName ?? session.appPath ?? session.launch?.path;
    if (command === undefined || command.trim() === "") {
      throw new SessionError(
        "A terminal session needs a program to run. Name it with `--app <program>`; its " +
          "arguments go in the project's `app.launch.args`.",
        { adapter: ADAPTER },
      );
    }
    const readiness = ProcessSurface.readiness(this.options.allocator);
    if (!readiness.ready) throw new SessionError(readiness.reason!, { adapter: ADAPTER });

    const root = resolve(this.options.root ?? session.launch?.path ?? process.cwd());
    const [columns, rows] = session.launch?.size ?? [
      this.options.columns ?? 100,
      this.options.rows ?? 30,
    ];
    const screen = new Screen({ columns, rows });
    const args = session.launch?.args ?? [];
    const pty = openPty({
      command,
      args,
      cwd: root,
      env: {
        ...(Object.fromEntries(
          Object.entries(process.env).filter(([, value]) => value !== undefined),
        ) as Record<string, string>),
        ...(session.launch?.env ?? {}),
        COLUMNS: String(columns),
        LINES: String(rows),
      },
      columns,
      rows,
      ...(this.options.allocator === undefined ? {} : { allocator: this.options.allocator }),
    });
    const started: Started = { pty, screen, command, args: [...args], root };
    pty.onData((chunk) => screen.write(chunk));
    pty.onExit((status) => {
      started.exit = status;
    });
    this.session = started;
  }

  async close(): Promise<void> {
    const live = this.session;
    this.session = undefined;
    this.refs.clear();
    await live?.pty.stop();
  }

  private live(): Started {
    if (this.session === undefined) {
      throw new SessionError("The terminal session is not open.", { adapter: ADAPTER });
    }
    return this.session;
  }

  /**
   * The screen, as semantic nodes.
   *
   * A terminal has one structure and it is honest to publish exactly that: a
   * `terminal` root, and one `text` node per line that has something on it. The
   * roles are the ARIA vocabulary every other adapter maps onto — `terminal` is
   * `log`'s neighbour and is what a screen reader calls one — so a caller that
   * knows how to read a snapshot needs nothing new.
   *
   * Blank lines are left out because a terminal is mostly blank, and a snapshot
   * of thirty rows of nothing is a snapshot with a `maxNodes` problem and no
   * information. `truncated` says when the bound was reached, as everywhere else.
   */
  async snapshot(opts: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean } = {}): Promise<Snapshot> {
    const live = this.live();
    this.generation += 1;
    this.refs = new Map();
    const max = opts.maxNodes ?? 500;
    const nodes: SnapshotNode[] = [];
    const lines = live.screen.lines();
    const running = live.pty.running;

    nodes.push({
      ref: this.issue(-1),
      role: "terminal",
      name: `${live.command}${live.args.length === 0 ? "" : ` ${live.args.join(" ")}`}`,
      value: running ? "running" : `exited ${live.exit?.code ?? "?"}`,
      states: running ? [] : ["disabled"],
      depth: 0,
    });

    /*
     * `interactiveOnly` on a terminal means the line the cursor is on: the only
     * place a person can type. Answering the whole screen would make the flag
     * mean nothing here, and answering nothing would make it mean the surface
     * has no controls — which is false of a terminal that is waiting for input.
     */
    const cursorRow = live.screen.cursor.row - 1;
    for (const [index, line] of lines.entries()) {
      if (nodes.length >= max) break;
      if (opts.interactiveOnly === true && index !== cursorRow) continue;
      if (line.trim() === "" && index !== cursorRow) continue;
      nodes.push({
        ref: this.issue(index),
        role: index === cursorRow ? "textbox" : "text",
        name: line,
        states: index === cursorRow && running ? ["focused"] : [],
        depth: 1,
      });
    }

    const shown = lines.filter((one) => one.trim() !== "").length + 1;
    return {
      ...buildSnapshot(nodes[0]!.ref, nodes, structuralHash(nodes)),
      ...(shown > max ? { truncated: true } : {}),
    };
  }

  private issue(row: number): Ref {
    const ref = `t${this.generation}_${row + 1}`;
    this.refs.set(ref, row);
    return ref;
  }

  private rowOf(ref: Ref | undefined, _action: string): number {
    if (ref === undefined) return -1;
    const row = this.refs.get(ref);
    if (row === undefined) {
      throw new ActionabilityError(
        `${ref} is not a line of the current screen. Take a snapshot and use the reference it gives.`,
        { adapter: ADAPTER },
      );
    }
    return row;
  }

  async act(action: SurfaceAction, ref?: Ref, args?: ActArgs, _ref2?: Ref): Promise<ActResult> {
    const live = this.live();
    // Every reference is checked, whatever the action does with it.
    this.rowOf(ref, action);

    switch (action) {
      case "type": {
        const value = args?.["value"];
        if (typeof value !== "string") {
          throw new DataError("The type action needs an argument value.", { adapter: ADAPTER });
        }
        this.requireRunning(action);
        live.pty.write(value);
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }

      case "press": {
        const key = args?.["key"] ?? args?.["value"];
        if (typeof key !== "string") {
          throw new DataError("The press action needs an argument key.", { adapter: ADAPTER });
        }
        const bytes = keyBytes(key);
        if (bytes === undefined) {
          throw new ActionabilityError(
            `"${key}" is not a key this terminal can send. Try Enter, Tab, Escape, an arrow, ` +
              "a single character, or Control+<letter>.",
            { adapter: ADAPTER },
          );
        }
        this.requireRunning(action);
        live.pty.write(bytes);
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }

      case "clear":
        live.screen.write(`${ESC}[2J${ESC}[H`);
        return { ok: true };

      case "waitFor": {
        const text = args?.["value"] ?? args?.["text"];
        const timeoutMs = Number(args?.["timeoutMs"] ?? 10_000);
        if (typeof text !== "string") {
          throw new DataError("The waitFor action needs an argument value to wait for.", { adapter: ADAPTER });
        }
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (live.screen.text().includes(text)) return { ok: true, value: text };
          await new Promise((done) => setTimeout(done, 50));
        }
        throw new ActionabilityError(
          `The terminal did not show "${text}" within ${timeoutMs} ms. What is on it: ` +
            `${JSON.stringify(live.screen.text().slice(-300))}`,
          { adapter: ADAPTER },
        );
      }

      case "sleep": {
        const ms = Number(args?.["ms"] ?? args?.["value"] ?? 0);
        await new Promise((done) => setTimeout(done, Math.max(0, ms)));
        return { ok: true };
      }

      case "quit": {
        /*
         * The graceful route, then the signal — the same thing pattern 31 means
         * for an application, and the same thing a person means by closing a
         * terminal. It is not `close`: a caller may want the exit state
         * afterwards, and `close` ends the session that holds it.
         */
        await live.pty.stop();
        return { ok: true, value: live.exit?.code ?? null };
      }

      case "screenshot": {
        const path = args?.["path"];
        if (typeof path !== "string") {
          throw new DataError("The screenshot action needs an argument path.", { adapter: ADAPTER });
        }
        await this.screenshot(path);
        return { ok: true, value: path };
      }

      default:
        /*
         * Refused by name, the way an HTTP surface refuses `click` (REQ-SURF-5).
         * A terminal has no elements to click, no URL to navigate and no window
         * to resize, and pretending otherwise is what SF-09 calls an adapter's
         * presence in a dropdown standing in for evidence.
         */
        throw new DataError(
          `A terminal has no "${action}". It takes type, press, clear, waitFor, sleep, ` +
            "screenshot and quit. A flow that clicks, hovers or navigates needs a web, mobile " +
            "or desktop adapter (REQ-SURF-5).",
          { adapter: ADAPTER },
        );
    }
  }

  private requireRunning(_action: string): void {
    const live = this.live();
    if (live.pty.running) return;
    throw new ActionabilityError(
      `The program has exited (${live.exit?.signal ?? `code ${live.exit?.code ?? "?"}`}); ` +
        "there is nothing to type into.",
      { adapter: ADAPTER },
    );
  }

  /**
   * Read the screen, a line, the streams, or the exit state.
   *
   * The named attributes are the streams and the state SF-22 asks for, and they
   * are read through the operation every surface already has rather than
   * through one of this adapter's own. `file:<path>` is the bounded filesystem
   * access, and it is bounded here.
   */
  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    const live = this.live();
    switch (kind) {
      case "text":
      case "value": {
        if (ref === undefined) return live.screen.text();
        const row = this.rowOf(ref, "read");
        return row < 0 ? live.screen.text() : (live.screen.lines()[row] ?? "");
      }
      case "title":
        return `${live.command}${live.args.length === 0 ? "" : ` ${live.args.join(" ")}`}`;
      case "url":
        // A terminal has no URL. Its address is where it is running.
        return live.root;
      case "result":
        return {
          running: live.pty.running,
          pid: live.pty.pid ?? null,
          exitCode: live.exit?.code ?? null,
          signal: live.exit?.signal ?? null,
          cursor: live.screen.cursor,
          size: live.screen.dimensions,
          allocator: live.pty.allocator,
        };
      case "attribute": {
        if (name === undefined) {
          throw new DataError("Reading an attribute needs its name.", { adapter: ADAPTER });
        }
        return this.attribute(live, name);
      }
      default:
        throw new DataError(`A terminal cannot be read for "${kind}".`, { adapter: ADAPTER });
    }
  }

  private attribute(live: Started, name: string): unknown {
    switch (name) {
      case "stream":
      case "stdout":
        /*
         * One stream, and it says so. A pseudo-terminal has a single stream by
         * construction — what a program writes to its stderr goes to the same
         * terminal — so answering a separate `stderr` would be inventing a
         * distinction the surface does not have.
         */
        return live.screen.raw;
      case "exitCode":
        return live.exit?.code ?? null;
      case "signal":
        return live.exit?.signal ?? null;
      case "running":
        return live.pty.running;
      case "pid":
        return live.pty.pid ?? null;
      case "command":
        return [live.command, ...live.args].join(" ");
      case "root":
        return live.root;
      case "allocator":
        return live.pty.allocator;
      default:
        break;
    }
    if (name.startsWith("file:")) return this.readFile(live, name.slice("file:".length));
    throw new ActionabilityError(
      `A terminal has no attribute "${name}". It has stream, exitCode, signal, running, pid, ` +
        "command, root, allocator, and file:<path within the root>.",
      { adapter: ADAPTER },
    );
  }

  /**
   * One file, from under the declared root and nowhere else (SF-15, SF-22).
   *
   * The check is on the *resolved real* path, not on the string a caller wrote.
   * `../` is the obvious escape and the easy one to catch; a symbolic link
   * inside the root pointing outside it is the one that gets past a check made
   * before resolution, so resolution comes first and the containment test comes
   * after.
   */
  private readFile(live: Started, requested: string): string {
    if (isAbsolute(requested)) {
      throw new DataError(
        `This session reads files under ${live.root} only, and "${requested}" is an absolute path.`,
        { adapter: ADAPTER },
      );
    }
    const asked = resolve(live.root, requested);
    let real: string;
    try {
      real = realpathSync(asked);
    } catch {
      throw new DataError(`There is no ${requested} under ${live.root}.`, { adapter: ADAPTER });
    }
    const rootReal = realpathSync(live.root);
    const within = relative(rootReal, real);
    if (within === "" || within.startsWith("..") || isAbsolute(within)) {
      throw new DataError(
        `This session reads files under ${live.root} only, and "${requested}" resolves outside ` +
          "it. A link that leaves the root leaves it.",
        { adapter: ADAPTER },
      );
    }
    if (!statSync(real).isFile()) {
      throw new DataError(`${requested} is not a file.`, { adapter: ADAPTER });
    }
    return readFileSync(real, "utf8");
  }

  async check(predicate: Predicate, subject: string, ref?: Ref): Promise<CheckResult> {
    const live = this.live();
    const kind = (predicate as { kind: string }).kind;
    const negate = (predicate as { negate?: boolean }).negate === true;
    const wanted = String(
      (predicate as { value?: { value?: unknown } }).value?.value ??
        (predicate as { value?: unknown }).value ??
        "",
    );
    const of =
      subject === "ref" && ref !== undefined
        ? (live.screen.lines()[this.rowOf(ref, "check")] ?? "")
        : live.screen.text();

    const answer = (ok: boolean, actual: unknown): CheckResult => ({
      ok: negate ? !ok : ok,
      actual,
    });

    switch (kind) {
      case "text":
        return answer(of === wanted, of);
      case "textContains":
        return answer(of.includes(wanted), of);
      case "value": {
        /*
         * A terminal's "value" is its exit code, which is the one thing a
         * script actually asserts about a command. Compared as the string a
         * person would write, the same way an API answer is (pattern 19).
         */
        const code = live.exit?.code ?? null;
        return answer(String(code ?? "") === wanted, code);
      }
      case "present":
        return answer(true, true);
      case "absent":
        return answer(false, true);
      case "visible":
        return answer(of.trim() !== "", of);
      case "hidden":
        return answer(of.trim() === "", of);
      case "enabled":
        return answer(live.pty.running, live.pty.running);
      case "disabled":
        return answer(!live.pty.running, live.pty.running);
      default:
        throw new CheckError(`A terminal cannot answer the "${kind}" predicate.`, {
          adapter: ADAPTER,
        });
    }
  }

  /**
   * A line of the screen, by what is on it.
   *
   * `text` is the candidate a terminal can answer; a css selector, a test id, a
   * role or an accessibility id are questions about a document, and this is not
   * one. Refusing them by name is what tells a caller which of its candidates
   * this surface could even try (LLD §6.3).
   */
  async locate(candidate: Candidate): Promise<Ref[]> {
    const live = this.live();
    const by = candidate.by;
    if (by !== "text" && by !== "label") {
      throw new LocateError(
        `A terminal can be located by "text" only; "${by}" is a question about a document.`,
        { adapter: ADAPTER },
      );
    }
    const wanted = String(candidate.value);
    await this.snapshot({ maxNodes: 1000 });
    const found: Ref[] = [];
    for (const [ref, row] of this.refs) {
      if (row < 0) continue;
      if ((live.screen.lines()[row] ?? "").includes(wanted)) found.push(ref);
    }
    return found;
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const live = this.live();
    const row = this.rowOf(ref, "describe");
    const lines = live.screen.lines();
    const line = row < 0 ? live.screen.text() : (lines[row] ?? "");
    return {
      ref,
      role: row < 0 ? "terminal" : "text",
      name: line,
      tag: row < 0 ? "terminal" : "line",
      attrs: {
        row: String(row + 1),
        columns: String(live.screen.dimensions.columns),
        rows: String(live.screen.dimensions.rows),
      },
      text: line,
      /*
       * The lines above and below, which is what "neighbours" means on a
       * screen made of lines — and what a fingerprint of a terminal line has to
       * be, because the line's own text is the only other thing there is.
       */
      neighbours: {
        before: row > 0 ? [lines[row - 1] ?? ""] : [],
        after: row >= 0 && row + 1 < lines.length ? [lines[row + 1] ?? ""] : [],
      },
      rolePath: row < 0 ? ["terminal"] : ["terminal", "text"],
      /*
       * A terminal has no pixels, and a box of zeroes is the honest answer
       * rather than character cells dressed up as points.
       */
      box: [0, 0, 0, 0],
      index: Math.max(0, row),
      states: [],
    };
  }

  /**
   * A picture of a terminal is its text.
   *
   * There are no pixels to take, and a surface that refused the operation would
   * leave a caller with no artifact at all for the one kind of screen whose
   * whole content is already characters. The file is written where the caller
   * asked, which is an artifact path the broker scoped, not a read of the
   * session's root.
   */
  async screenshot(path: string): Promise<void> {
    const live = this.live();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path, `${live.screen.text()}\n`, "utf8");
  }

  async state(): Promise<SessionState> {
    const live = this.live();
    return {
      kind: this.kind,
      windowTitle: [live.command, ...live.args].join(" "),
    } as SessionState;
  }

  async restore(): Promise<void> {
    /*
     * A program that has run cannot be put back where it was. Saying so is
     * better than a `restore` that silently starts a second one — the
     * capability says `restore: false` and this is the same answer in the same
     * words.
     */
    throw new SessionError(
      "A terminal session cannot be restored: re-running the program is a new session with new " +
        "side effects, which is not what restoring a checkpoint means.",
      { adapter: ADAPTER },
    );
  }
}

/** The path separator, exported so a test can build a case for either platform. */
export const PATH_SEPARATOR = sep;

export function createProcessSurface(config: Config): ProcessSurface {
  const cwd = (config as { root?: string }).root;
  return new ProcessSurface(cwd === undefined ? {} : { root: cwd });
}
