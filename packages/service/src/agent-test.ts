/**
 * The connection test that speaks MCP (T16, SF-07, SF-15).
 *
 * "Connect an agent" hands a person a configuration — `npx -y @svatah/yam-mcp`
 * — and the test beside it used to check only the broker that configuration
 * would share, because completing a handshake needs a process and a renderer
 * cannot start one. The service can, so this does what a client does with that
 * configuration and nothing more: start the command, send `initialize`,
 * `notifications/initialized` and `tools/list` over its stdio, and stop it.
 *
 * ## What it is careful about
 *
 * - **The command is fixed here** (SF-15). It is the configuration's own, or
 *   `YAM_MCP_TEST_COMMAND` in the service's environment — which is how a test
 *   points it at a local build instead of the registry. Nothing in a request
 *   reaches `spawn`, so the route cannot be talked into running anything else.
 * - **No tool is called.** A handshake proves the server starts, speaks the
 *   protocol and publishes tools. It does not open a session or touch a
 *   surface, and the answer does not claim it did.
 * - **It ends.** A deadline covers the whole exchange — sixty seconds, because
 *   `npx -y` may be downloading the package — and whatever happens the process
 *   is stopped: stdin closed, then `SIGTERM` to its process group (so the
 *   server `npx` started goes too), then `SIGKILL` if it lingers.
 * - **No dependency on the MCP SDK.** Newline-delimited JSON-RPC is three
 *   requests; the service stays a package that imports `schema` and not a
 *   protocol implementation.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

/** What the agent panel tells people to run (`AGENT_SERVER` in `@svatah/yam-screens`). */
export const MCP_TEST_COMMAND: readonly string[] = ["npx", "-y", "@svatah/yam-mcp"];

/** Long enough for `npx -y` to fetch the package on a first run. */
export const MCP_TEST_TIMEOUT_MS = 60_000;

/** The protocol this client asks for; the server answers with the one it speaks. */
export const MCP_TEST_PROTOCOL = "2025-11-25";

/** Where a failed test stopped. */
export type McpTestStage = "start" | "initialize" | "tools/list";

export type McpTestResult =
  | {
      readonly ok: true;
      /** The command that was started, as one line. */
      readonly command: string;
      readonly server: { readonly name: string; readonly version: string };
      readonly protocolVersion: string;
      /** How many tools `tools/list` published, across every page. */
      readonly tools: number;
      readonly ms: number;
    }
  | {
      readonly ok: false;
      readonly command: string;
      readonly stage: McpTestStage;
      readonly message: string;
      readonly ms: number;
    };

/**
 * The command the service starts: the configuration's, unless its own
 * environment says otherwise.
 *
 * `YAM_MCP_TEST_COMMAND` is a JSON array of words, or a line split on
 * whitespace — `node /abs/packages/mcp/dist/bin.js`. It is read from the
 * service's environment, which a request cannot set.
 */
export function mcpTestCommand(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  const given = env["YAM_MCP_TEST_COMMAND"]?.trim();
  if (given === undefined || given === "") return MCP_TEST_COMMAND;
  if (given.startsWith("[")) {
    try {
      const words = JSON.parse(given) as unknown;
      if (Array.isArray(words) && words.length > 0 && words.every((one) => typeof one === "string")) {
        return words as string[];
      }
    } catch {
      // Not an array after all: read it as a line.
    }
  }
  return given.split(/\s+/);
}

/** The deadline, from `YAM_MCP_TEST_TIMEOUT_MS` when the service's environment sets one. */
export function mcpTestTimeout(env: NodeJS.ProcessEnv = process.env): number {
  const given = Number(env["YAM_MCP_TEST_TIMEOUT_MS"]);
  return Number.isFinite(given) && given > 0 ? given : MCP_TEST_TIMEOUT_MS;
}

/** Stop the server and anything it started, without waiting for it to agree. */
function stop(child: ChildProcess): void {
  child.stdin?.end();
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  const pid = child.pid;
  if (process.platform === "win32") {
    // A shell started it, so the tree is what has to go; `taskkill /T` is how.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on(
      "error",
      () => child.kill(),
    );
    return;
  }
  const signal = (name: NodeJS.Signals): void => {
    try {
      // The negative pid is the process group `detached` gave it: `npx` and its child.
      process.kill(-pid, name);
    } catch {
      child.kill(name);
    }
  };
  signal("SIGTERM");
  const hard = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signal("SIGKILL");
  }, 2_000);
  hard.unref();
  child.once("exit", () => clearTimeout(hard));
}

/** The last lines a server wrote to stderr, which is where it says why it stopped. */
const tail = (text: string): string => {
  const lines = text.trim().split(/\r?\n/).filter((one) => one.trim() !== "");
  return lines.slice(-3).join(" / ").slice(-400);
};

/**
 * Start an MCP server over stdio, complete a handshake and list its tools.
 *
 * Resolves, never rejects: every way this can go wrong is an answer with the
 * stage it stopped at and a sentence about why, because the caller is a panel
 * that shows it to a person.
 */
export async function testMcpServer(options: {
  readonly command: readonly string[];
  readonly timeoutMs?: number;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}): Promise<McpTestResult> {
  const [program, ...args] = options.command;
  const line = options.command.join(" ");
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? MCP_TEST_TIMEOUT_MS;
  if (program === undefined || program === "") {
    return { ok: false, command: line, stage: "start", message: "No MCP server command is configured.", ms: 0 };
  }
  /*
   * A path that is not there, said before anything is started.
   *
   * On Windows the command runs through a shell, because `npx` is `npx.cmd`
   * there — and a shell given a program that does not exist starts perfectly
   * well, prints its own complaint and exits. So the answer was "it exited
   * before answering initialize" for a command that never ran. A bare name is
   * left to the shell's own PATH lookup; only a path is checked here.
   */
  if (program.includes("/") || program.includes("\\")) {
    const candidates =
      process.platform === "win32" ? [program, `${program}.exe`, `${program}.cmd`, `${program}.bat`] : [program];
    if (!candidates.some((one) => existsSync(one))) {
      return { ok: false, command: line, stage: "start", message: `Could not start \`${line}\`: no such file.`, ms: 0 };
    }
  }

  return await new Promise<McpTestResult>((resolve) => {
    let stage: McpTestStage = "start";
    let stderr = "";
    let buffer = "";
    let settled = false;
    let server: { name: string; version: string } = { name: "", version: "" };
    let protocolVersion = "";
    let tools = 0;
    let nextId = 1;

    const child = spawn(program, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.env ?? process.env,
      // Its own process group, so stopping it stops what `npx` started too.
      detached: process.platform !== "win32",
      // `npx` is `npx.cmd` on Windows, which only a shell runs. The words are
      // this module's or the service environment's, never a request's.
      shell: process.platform === "win32",
      windowsHide: true,
    });

    const finish = (result: McpTestResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      stop(child);
      resolve(result);
    };
    const fail = (message: string): void =>
      finish({ ok: false, command: line, stage, message, ms: Date.now() - started });

    const deadline = setTimeout(() => {
      const said = tail(stderr);
      fail(
        `No answer to ${stage === "start" ? "initialize" : stage} within ${Math.round(timeoutMs / 1000)} s.` +
          (said === "" ? "" : ` The server said: ${said}`),
      );
    }, timeoutMs);

    const send = (message: Record<string, unknown>): void => {
      child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    };

    const listTools = (cursor?: string): void => {
      stage = "tools/list";
      send({ id: nextId++, method: "tools/list", params: cursor === undefined ? {} : { cursor } });
    };

    const onMessage = (message: Record<string, unknown>): void => {
      // A request from the server — `ping`, `roots/list` — is answered rather
      // than left to hang the exchange.
      if (typeof message["method"] === "string" && message["id"] !== undefined) {
        send(
          message["method"] === "ping"
            ? { id: message["id"], result: {} }
            : { id: message["id"], error: { code: -32601, message: "The connection test offers no methods." } },
        );
        return;
      }
      if (message["id"] === undefined) return; // a notification: logs, progress
      const error = message["error"] as { message?: unknown } | undefined;
      if (error !== undefined) {
        fail(`The server refused ${stage}: ${typeof error.message === "string" ? error.message : JSON.stringify(error)}`);
        return;
      }
      const result = (message["result"] ?? {}) as Record<string, unknown>;
      if (stage === "initialize") {
        const info = (result["serverInfo"] ?? {}) as { name?: unknown; version?: unknown };
        server = {
          name: typeof info.name === "string" ? info.name : "",
          version: typeof info.version === "string" ? info.version : "",
        };
        protocolVersion = typeof result["protocolVersion"] === "string" ? result["protocolVersion"] : "";
        if (protocolVersion === "") {
          fail("The server answered initialize without a protocol version, so it is not speaking MCP.");
          return;
        }
        send({ method: "notifications/initialized" });
        listTools();
        return;
      }
      if (stage === "tools/list") {
        const page = result["tools"];
        if (!Array.isArray(page)) {
          fail("The server answered tools/list without a list of tools.");
          return;
        }
        tools += page.length;
        const cursor = result["nextCursor"];
        // Bounded: a server that paginates for ever has answered enough.
        if (typeof cursor === "string" && cursor !== "" && nextId < 50) {
          listTools(cursor);
          return;
        }
        finish({ ok: true, command: line, server, protocolVersion, tools, ms: Date.now() - started });
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at !== -1) {
        const text = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (text !== "") {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (typeof parsed === "object" && parsed !== null) onMessage(parsed as Record<string, unknown>);
          } catch {
            fail(`The server wrote something that is not JSON-RPC to stdout: ${text.slice(0, 120)}`);
            return;
          }
        }
        at = buffer.indexOf("\n");
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8_000);
    });
    // Nothing to write to is the same failure as nothing to read from; the
    // `exit` or `error` handler says which.
    child.stdin?.on("error", () => undefined);

    child.on("error", (cause) => {
      stage = "start";
      fail(`Could not start \`${line}\`: ${cause.message}`);
    });
    // `close`, not `exit`: a server that answers and exits at once has lines
    // still in the pipe when `exit` fires, and they are the answer.
    child.on("close", (code, signal) => {
      if (settled) return;
      const said = tail(stderr);
      fail(
        `\`${line}\` exited (${signal ?? `code ${String(code)}`}) before answering ${stage === "start" ? "initialize" : stage}.` +
          (said === "" ? "" : ` It said: ${said}`),
      );
    });

    child.on("spawn", () => {
      stage = "initialize";
      send({
        id: nextId++,
        method: "initialize",
        params: {
          protocolVersion: MCP_TEST_PROTOCOL,
          capabilities: {},
          clientInfo: { name: "yam-connection-test", version: "0.2.0" },
        },
      });
    });
  });
}
