/**
 * `yam ui` — the terminal cockpit (T9.4, REQ-TUI-1, LLD §13.7, §15).
 *
 *   yam ui [dir] [--screen flows|run|…] [--flow <file>] [--run <id>]
 *             [--story <name>] [--url <url> --token <t>] [--json]
 *             [--capture <ms>]
 *
 * > `yam ui` is a full authoring cockpit in the terminal: a standalone Ink
 * > application over the local service rendering the same screen model as the
 * > APP_DIR […] It opens or adopts a service exactly as the app does.
 *
 * ## "Exactly as the app does"
 *
 * The app, on project open: look for a service already serving this directory,
 * and connect to it if there is one; otherwise spawn `yam serve --port 0`,
 * read the url and token off its stdout, and stop it on quit (LLD §13.6). This
 * does the same three things, with one difference that is the terminal's: a
 * `--url`/`--token` pair, or `YAM_SERVICE_URL`/`YAM_SERVICE_TOKEN`, skips
 * the search — which is how an agent points the cockpit at a service it already
 * has, and what `tools/repo-checks/test/tui-pty.test.ts` uses.
 *
 * The service is spawned rather than mounted in-process on purpose. `yam
 * serve` prints a handshake line and owns a port; a cockpit that had *become*
 * the service would be a second implementation of it, and `--json` would then be
 * printing a state no other client could reach.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EXIT,
  numberOption,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/yam-bindings-cli";
import { resolve, dirname, join } from "node:path";

/**
 * The `yam` executable to spawn for a service. `process.argv[1]` when this is
 * the executable; otherwise the built `bin.js` beside this module (`dist/`) or
 * under the package (`src/` in a test), because a test runner's own entry is
 * not a command line anyone can serve from.
 */
export function yamBin(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "bin.js"), join(here, "..", "..", "dist", "bin.js")];
  const argv = process.argv[1];
  if (argv !== undefined && /(^|\/)(bin\.js|yam)$/.test(argv)) return argv;
  return candidates.find((one) => existsSync(one)) ?? argv ?? "yam";
}

/** The one line `yam serve` prints when it is listening (LLD §13.6). */
export function parseHandshake(line: string): { url: string; token: string } | undefined {
  const match = /^yam serve listening url=(\S+) token=(\S+)$/m.exec(line);
  return match === null ? undefined : { url: match[1]!, token: match[2]! };
}

/** Start `yam serve` on this directory and wait for its handshake. */
async function openService(
  project: string,
): Promise<{ url: string; token: string; child: ChildProcess }> {
  const child = spawn(process.execPath, [yamBin(), "serve", project, "--port", "0"], {
    env: process.env,
  });
  let buffer = "";
  return await new Promise((done, fail) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail(
        new Error(
          "`yam serve` printed no handshake within 30 s. Run it by hand to see what it says, " +
            "then point the cockpit at it with `yam ui --url <url> --token <token>`.",
        ),
      );
    }, 30_000);
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const found = parseHandshake(buffer);
      if (found !== undefined) {
        clearTimeout(timer);
        done({ ...found, child });
      }
    });
    /*
     * The service's stderr is its own diagnostics, and the cockpit owns the
     * screen — so it is swallowed while the cockpit draws and reported if the
     * handshake never comes. A line printed into an Ink render is a corrupted
     * frame.
     */
    child.stderr?.on("data", (chunk) => {
      buffer += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`\`yam serve\` exited ${code ?? "?"} before it was listening.\n${buffer}`));
    });
  });
}

export async function uiCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (args.options["tmux"] !== undefined) {
    return await (await import("./workspace.js")).workspaceCommand(args, io);
  }
  const project = resolve(args.command[1] ?? ".");
  const asJson = args.options["json"] !== undefined;

  /*
   * `--keys` needs no service and no terminal: it is the cockpit's key map, and
   * an agent asking what it may press should not have to start one (TV-07).
   */
  if (args.options["keys"] !== undefined) {
    const { printKeys } = await import("@svatah/yam-tui");
    printKeys((text) => io.out(text));
    return EXIT.ok;
  }

  const given = {
    url: stringOption(args, "url") ?? process.env["YAM_SERVICE_URL"],
    token: stringOption(args, "token") ?? process.env["YAM_SERVICE_TOKEN"],
  };

  let started: ChildProcess | undefined;
  let connection: { url: string; token: string };
  try {
    if (given.url !== undefined && given.token !== undefined) {
      connection = { url: given.url, token: given.token };
    } else {
      const opened = await openService(project);
      started = opened.child;
      connection = { url: opened.url, token: opened.token };
    }
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.usage;
  }

  try {
    /*
     * Imported lazily, like every other command: `yam run` should not pay
     * for loading Ink and React, and `yam --help` should load nothing.
     */
    const { runUi, screenFrom } = await import("@svatah/yam-tui");
    const { YamClient } = await import("@svatah/yam-sdk");

    const screen = screenFrom(stringOption(args, "screen"));
    const params = {
      ...(stringOption(args, "flow") === undefined ? {} : { file: stringOption(args, "flow")! }),
      ...(stringOption(args, "run") === undefined ? {} : { runId: stringOption(args, "run")! }),
      ...(stringOption(args, "story") === undefined ? {} : { story: stringOption(args, "story")! }),
      ...(stringOption(args, "select") === undefined
        ? {}
        : { selected: stringOption(args, "select")! }),
    };

    await runUi({
      service: new YamClient(connection),
      connection: { url: connection.url, project },
      ...(screen === undefined ? {} : { screen }),
      params,
      json: asJson,
      out: (text) => io.out(text),
      ...(numberOption(args, "capture") === undefined
        ? {}
        : { captureMs: numberOption(args, "capture")! }),
    });
    return EXIT.ok;
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  } finally {
    // A service this command started is a service this command stops (§13.6).
    started?.kill("SIGTERM");
  }
}
