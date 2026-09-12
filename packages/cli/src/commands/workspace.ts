/**
 * `yam ui --tmux`, and `yam workspace` (T14.5, REQ-TUI-2, LLD §15.1).
 *
 * One tmux session named for the project, four panes that share one service:
 * the cockpit on the left, a shell in the project top right, the run's events
 * bottom right, and the editor on the open flow when `$EDITOR` is set. The
 * service is started inside the session, in its own window, so it lives as
 * long as the session does; the cockpit's pane ends the session when the
 * cockpit quits. Everything is driven through tmux's own command line and
 * nothing else, so a later phase can drive the same session as a surface.
 *
 * Without tmux, the cockpit opens alone and one line says so.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { boolOption, EXIT, stringOption, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { parseHandshake, yamBin } from "./ui.js";

/** `yam-<project>`, in the characters tmux accepts in a session name. */
export function sessionNameFor(project: string): string {
  const name = basename(resolve(project)).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `yam-${name === "" ? "project" : name}`;
}

function tmux(...argv: string[]): { ok: boolean; out: string; err: string } {
  const result = spawnSync("tmux", argv, { encoding: "utf8" });
  return { ok: result.status === 0, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** Is tmux on PATH? */
export function tmuxAvailable(): boolean {
  return spawnSync("tmux", ["-V"], { encoding: "utf8" }).status === 0;
}

/** Quote for a shell line tmux runs. */
const q = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

export interface WorkspaceOptions {
  /** Build the session and return without attaching; for scripts and tests. */
  readonly detach?: boolean;
}

/**
 * Start or attach the workspace. Returns the exit code; when tmux is absent,
 * the caller falls back to the cockpit alone.
 */
export async function workspaceCommand(args: ParsedArgs, io: CommandIo, options: WorkspaceOptions = {}): Promise<ExitCode> {
  const project = resolve(args.command[1] ?? ".");
  const detach = options.detach === true || boolOption(args, "detach");
  const session = sessionNameFor(project);
  const yam = `${q(process.execPath)} ${q(yamBin())}`;

  if (!tmuxAvailable()) {
    io.err("The workspace needs tmux, which is not on PATH; opening the cockpit alone.");
    return await (await import("./ui.js")).uiCommand({ ...args, options: { ...args.options, tmux: undefined as never } }, io);
  }

  if (tmux("has-session", "-t", `=${session}`).ok) {
    io.err(`attaching to the workspace ${session}`);
    return attach(session, detach, io);
  }

  /*
   * The service, in its own window, writing its handshake where this process
   * can read it. Started first, because every other pane needs the address.
   */
  const given = {
    url: stringOption(args, "url") ?? process.env["YAM_SERVICE_URL"],
    token: stringOption(args, "token") ?? process.env["YAM_SERVICE_TOKEN"],
  };
  /*
   * The size the session is born at (Draft 2.24).
   *
   * `new-session -d` takes tmux's default, 80×24, so the cockpit's pane after
   * two splits is 40 columns — under its 60-column minimum, which is why a
   * fresh workspace opened with the inspector collapsed and everything
   * truncated. Attaching resizes it, but the first frame a person sees is the
   * one that has to make sense, and `--detach` never attaches at all.
   *
   * The terminal's own size when there is one; tmux's default otherwise, which
   * is what a pipe or a CI job gets.
   */
  const size =
    process.stdout.columns !== undefined && process.stdout.rows !== undefined
      ? ["-x", String(process.stdout.columns), "-y", String(process.stdout.rows)]
      : [];
  let connection: { url: string; token: string };
  mkdirSync(join(project, ".yam"), { recursive: true });
  const handshake = join(project, ".yam", "workspace.handshake");
  rmSync(handshake, { force: true });

  if (given.url !== undefined && given.token !== undefined) {
    connection = given as { url: string; token: string };
    const created = tmux("new-session", "-d", ...size, "-s", session, "-c", project, "-n", "service", "sh", "-c", `echo ${q("attached to " + given.url)}; sleep 2147483647`);
    if (!created.ok) {
      io.err(`tmux could not create the session: ${created.err.trim()}`);
      return EXIT.failed;
    }
  } else {
    const created = tmux(
      "new-session", "-d", ...size, "-s", session, "-c", project, "-n", "service",
      "sh", "-c", `${yam} serve ${q(project)} --port 0 2>&1 | tee ${q(handshake)}`,
    );
    if (!created.ok) {
      io.err(`tmux could not create the session: ${created.err.trim()}`);
      return EXIT.failed;
    }
    const started = Date.now();
    let parsed: { url: string; token: string } | undefined;
    while (parsed === undefined && Date.now() - started < 30_000) {
      if (existsSync(handshake)) parsed = parseHandshake(readFileSync(handshake, "utf8"));
      if (parsed === undefined) await new Promise((done) => setTimeout(done, 100));
    }
    if (parsed === undefined) {
      tmux("kill-session", "-t", `=${session}`);
      io.err("`yam serve` printed no handshake within 30 s inside the session; the session was closed.");
      return EXIT.failed;
    }
    connection = parsed;
    rmSync(handshake, { force: true });
  }

  /*
   * The address into the session's environment, so every pane created from
   * here shares the one service instead of starting its own.
   */
  tmux("set-environment", "-t", `=${session}`, "YAM_SERVICE_URL", connection.url);
  tmux("set-environment", "-t", `=${session}`, "YAM_SERVICE_TOKEN", connection.token);
  const env = ["-e", `YAM_SERVICE_URL=${connection.url}`, "-e", `YAM_SERVICE_TOKEN=${connection.token}`];

  /*
   * The workspace window. The cockpit ends the session when it quits: that is
   * how "the service lives until the last pane" is kept simple enough to read.
   */
  /*
   * Quitting the cockpit closes the cockpit (TV-12, TV-T16).
   *
   * It used to `kill-session`, which took the person's shell and their editor
   * with it — everything they had typed in the pane beside it, because they
   * pressed `q` in the pane above. The service window is what keeps the session
   * alive; when the last pane a person wants is gone they close it themselves,
   * the way they close every other tmux session they have.
   */
  const cockpit = `${yam} ui ${q(project)}`;
  tmux("new-window", "-t", `=${session}`, "-c", project, "-n", "yam", ...env, "sh", "-c", cockpit);
  /* The mouse, in the session rather than in a person's own configuration. */
  tmux("set-option", "-t", `=${session}`, "mouse", "on");
  /*
   * The cockpit takes the larger share (Draft 2.24).
   *
   * An even split gives it half the terminal, and its three-pane layout needs
   * 120 columns before the inspector will sit beside the others — so on a
   * 220-column terminal an even split left it at 110 and collapsed, one column
   * short of the layout it was written for. 60/40 clears it on anything from
   * about 200 columns, and the shell keeps a usable width.
   */
  tmux("split-window", "-t", `=${session}:yam`, "-h", "-l", "40%", "-c", project, ...env);
  /* Named panes, so a person can see which is which without reading its output. */
  tmux("select-pane", "-t", `=${session}:yam.0`, "-T", "cockpit");
  tmux("select-pane", "-t", `=${session}:yam.1`, "-T", "shell");
  tmux("set-option", "-t", `=${session}:yam`, "pane-border-status", "top");
  tmux("split-window", "-t", `=${session}:yam.1`, "-v", "-c", project, ...env, "sh", "-c", `${yam} runs tail ${q(project)}`);
  tmux("select-pane", "-t", `=${session}:yam.2`, "-T", "events");
  const editor = process.env["EDITOR"];
  if (editor !== undefined && editor !== "") {
    const flow = stringOption(args, "flow");
    const target = flow === undefined ? "" : ` ${q(join(project, flow))}`;
    tmux("split-window", "-t", `=${session}:yam.0`, "-v", "-c", project, ...env, "sh", "-c", `${editor}${target}`);
  }
  tmux("select-pane", "-t", `=${session}:yam.0`);
  tmux("select-window", "-t", `=${session}:yam`);

  io.err(`workspace ${session}: the cockpit, a shell, the run's events${editor ? ", the editor" : ""}; service at ${connection.url}`);
  return attach(session, detach, io);
}

function attach(session: string, detach: boolean, io: CommandIo): ExitCode {
  if (detach) {
    io.out(session);
    return EXIT.ok;
  }
  // Inherit the terminal: this is the person's tmux client now.
  const result = spawnSync("tmux", ["attach-session", "-t", `=${session}`], { stdio: "inherit" });
  return (result.status === 0 ? EXIT.ok : EXIT.failed) as ExitCode;
}
