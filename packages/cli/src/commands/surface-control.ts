/**
 * `yam surface <operation>` — direct control of a live target (SF-01, SF-06).
 *
 * Connect to something, look at it, act on it, check what happened, close it.
 * No project, no flow, no plan, no binding, no model.
 *
 * ## Why a broker, and not just this process
 *
 * A session is a browser that is open; a command is a process that ends. The
 * first cut of this file kept the session store in the invocation, so
 * `yam surface connect` printed an id and then took the browser down with it,
 * and the next command answered `SESSION_NOT_FOUND`. The journey this command
 * family exists to deliver could not be run at all.
 *
 * So the store lives in a broker (`yam surface broker`), started lazily by the
 * first command that needs one and discovered by every command after it through
 * an owner-only descriptor in the user's state directory. This file builds the
 * request and prints the answer; it decides nothing about what an operation
 * means, because the broker and the MCP server must not be able to disagree.
 *
 * Arguments that come from the caller's own machine — `--input` reading a file
 * or stdin — are read here, where that file and that stdin exist.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  EXIT,
  stringOption,
  stringOptions,
  boolOption,
  type ParsedArgs,
  type ExitCode,
  type CommandIo,
} from "@svatah/yam-bindings-cli";
import {
  OPERATIONS,
  SURFACE_CLI_SUBCOMMANDS,
  brokerAlive,
  brokerHealth,
  callBroker,
  createAdapterFactory,
  discoverBroker,
  generateToken,
  removeBrokerDescriptor,
  startBroker,
  writeBrokerDescriptor,
  type BrokerDescriptor,
  type BrokerOperation,
} from "@svatah/yam-surface-control";
import { createSurface, listAdapters } from "@svatah/yam-surface";
import { registerAllAdapters } from "../adapters.js";
import { yamBin } from "./ui.js";

const IDLE_MS = 15 * 60 * 1000;

/**
 * Who the command line is when nobody says (SF-13, T16).
 *
 * A holder is a name a person reads beside a session — "yam cli controls" in
 * the desktop — and it has to be the same name across the commands of one
 * terminal, or `control --take` followed by `act` is refused by its own hold.
 * `--holder` names a specific client, an agent driving the CLI included.
 */
export const CLI_HOLDER = "yam cli";

export const SURFACE_CONTROL_SUBCOMMANDS = new Set([
  ...SURFACE_CLI_SUBCOMMANDS.filter((one) => one !== "conform" && one !== "doctor"),
  "broker",
]);

function factory(): { adapterFactory: ReturnType<typeof createAdapterFactory>; registeredAdapters: string[] } {
  registerAllAdapters();
  return {
    adapterFactory: createAdapterFactory(async (_name, config) => await createSurface(config), listAdapters),
    registeredAdapters: listAdapters(),
  };
}

export async function surfaceControlCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const sub = args.command[1];
  if (sub === undefined || !SURFACE_CONTROL_SUBCOMMANDS.has(sub)) {
    return undefined as unknown as ExitCode;
  }
  if (sub === "broker") return await runBroker(io);

  const json = boolOption(args, "json");
  try {
    /*
     * A flag the catalogue does not declare is a usage error (T18, SF-06).
     *
     * `yam surface control --action take` used to parse, ignore `--action`
     * entirely — the command line spells that operation `--take`/`--release` —
     * report the *status* of the lease, and exit 0. A caller who meant to take
     * control was told nobody held it, which is true and is not the answer to
     * the question asked.
     *
     * SF-06 says invalid flags produce structured errors, and the catalogue
     * already knows every flag of every subcommand, so the check is the
     * catalogue rather than a second list beside it. Adding a flag to an
     * operation is still one edit in one file.
     */
    const unknown = unknownFlags(sub, args);
    if (unknown.length > 0) {
      const operation = OPERATIONS.find((one) => one.cli.subcommand === sub);
      const known = (operation?.cli.flags ?? []).map((one) => `--${one.name}`).join(", ");
      io.err(
        `${unknown.map((one) => `--${one}`).join(", ")} ${unknown.length === 1 ? "is not a flag" : "are not flags"} ` +
          `of \`yam surface ${sub}\`. It takes: ${known === "" ? "no flags" : known}${known === "" ? "" : ", --json"}.`,
      );
      return EXIT.usage;
    }
    const request = operationFor(sub, args);
    const broker = await connectToBroker(io);
    const result = (await callBroker(broker, request.operation, request.args)) as Record<
      string,
      unknown
    >;
    io.out(JSON.stringify(result, null, json ? 2 : 0));
    return exitFor(result);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  }
}

/** The exit code a result envelope means (SF-06). */
function exitFor(result: Record<string, unknown>): ExitCode {
  /*
   * `refused` is not `succeeded` (SF-11).
   *
   * Wave 2 gave operations five outcomes and mapped one of them. A stale
   * reference, a busy target and an unsupported operation all exited 0, so a
   * script could not tell them from a success — which is the whole reason the
   * outcome vocabulary exists.
   */
  const status = result["status"];
  if (status !== "failed" && status !== "refused") return EXIT.ok;
  const code = (result as { error?: { code?: string } }).error?.code;
  if (code === "CHECK_FAILED") return 20 as ExitCode;
  if (code === "SESSION_NOT_FOUND" || code === "SESSION_CLOSED") return 21 as ExitCode;
  if (code === "ADAPTER_UNAVAILABLE" || code === "ADAPTER_NOT_REGISTERED") return 22 as ExitCode;
  if (code === "CONNECT_FAILED") return 23 as ExitCode;
  if (code === "INVALID_ARGUMENT") return EXIT.usage;
  if (code === "TIMEOUT") return 75 as ExitCode;
  return EXIT.failed;
}

/**
 * The broker this machine is using, started if there is not one.
 *
 * Started detached and unref'd, because it must outlive the command that
 * needed it — that is the whole point of it.
 */
export async function connectToBroker(io: CommandIo): Promise<BrokerDescriptor> {
  const found = discoverBroker();
  if (found !== undefined && (await brokerAlive(found))) return found;
  /*
   * A descriptor whose process is gone, which answers nothing, **or which
   * speaks a different contract** is stale (T18, SF-03).
   *
   * The third case is the one that had to be added. The broker outlives the
   * commands that use it, and a machine can easily have one that a different
   * build started — the packaged application starts its own from the copy of
   * the CLI staged inside the bundle. Talking to it looked like it worked:
   * arguments the older build had never heard of were dropped and the
   * operation answered `succeeded`, on a target the caller never named.
   *
   * A broker that cannot serve this contract is stopped rather than reasoned
   * with. It closes its own sessions and removes its descriptor on the signal,
   * which is the same tidy exit `yam surface broker` performs on Ctrl-C.
   */
  if (found !== undefined) {
    const health = await brokerHealth(found);
    if (health.alive) {
      io.err(
        `the surface broker on this machine was started from a different build of Yam; ` +
          `stopping it and starting one that matches.`,
      );
      try {
        process.kill(found.pid, "SIGTERM");
      } catch {
        /* Already gone, or somebody else's; the descriptor goes either way. */
      }
      for (let waited = 0; waited < 10_000; waited += 100) {
        await new Promise((done) => setTimeout(done, 100));
        if (!(await brokerHealth(found)).alive) break;
      }
    }
    removeBrokerDescriptor();
  }

  io.err("starting the surface broker; it holds your sessions between commands.");
  const child = spawn(process.execPath, [yamBin(), "surface", "broker"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
    const descriptor = discoverBroker();
    if (descriptor !== undefined && (await brokerAlive(descriptor))) return descriptor;
  }
  throw new Error(
    "The surface broker did not start within 30 s. Run `yam surface broker` in another " +
      "terminal to see what it says.",
  );
}

/** Run the broker in the foreground; the spawned process is this. */
async function runBroker(io: CommandIo): Promise<ExitCode> {
  const existing = discoverBroker();
  if (existing !== undefined && (await brokerAlive(existing))) {
    io.err(`a broker is already running at ${existing.url}`);
    return EXIT.ok;
  }
  const token = generateToken();
  const { adapterFactory, registeredAdapters } = factory();
  const broker = await startBroker({
    token,
    factory: adapterFactory,
    registeredAdapters,
    idleMs: IDLE_MS,
    onIdle: () => {
      /*
       * Nothing has been asked for a quarter of an hour. Close the sessions
       * this broker launched and go, rather than leaving a browser and a
       * listening port behind on somebody's machine for ever.
       */
      void broker.close().then(() => {
        removeBrokerDescriptor();
        process.exit(0);
      });
    },
  });
  writeBrokerDescriptor({
    url: broker.url,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  io.err(`surface broker listening ${broker.url}`);

  const stop = (): void => {
    void broker.close().then(() => {
      removeBrokerDescriptor();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // Held open by the server's handle until one of the paths above exits.
  await new Promise<void>(() => undefined);
  return EXIT.ok;
}

/**
 * Flags on this command line that the catalogue does not declare (T18, SF-06).
 *
 * `--json` is every operation's, and `--help` is the shell's; everything else
 * has to be written down in the catalogue to be accepted.
 */
const UNIVERSAL_FLAGS = new Set(["json", "help"]);

export function unknownFlags(sub: string, args: ParsedArgs): string[] {
  const operation = OPERATIONS.find((one) => one.cli.subcommand === sub);
  if (operation === undefined) return [];
  const declared = new Set(operation.cli.flags.map((one) => one.name));
  return Object.keys(args.options)
    .filter((name) => !UNIVERSAL_FLAGS.has(name))
    .filter((name) => !declared.has(name))
    .sort();
}

/** The operation and arguments a command line means. */
function operationFor(
  sub: string,
  args: ParsedArgs,
): { operation: BrokerOperation; args: Record<string, unknown> } {
  const session = stringOption(args, "session") ?? "";
  const defined = (record: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

  switch (sub) {
    case "targets":
      return {
        operation: "targets",
        args: defined({
          url: stringOption(args, "url"),
          adapter: stringOption(args, "adapter"),
        }),
      };

    case "connect":
      return {
        operation: "connect",
        args: defined({
          url: stringOption(args, "url"),
          // An application that is already running, and a browser that is
          // already running (T18, SF-04). The broker refuses more than one.
          app: stringOption(args, "app"),
          attach: stringOption(args, "attach"),
          adapter: stringOption(args, "adapter"),
          headed: boolOption(args, "headed") || undefined,
        }),
      };

    case "snapshot":
      return {
        operation: "snapshot",
        args: defined({
          session,
          root: stringOption(args, "root"),
          maxNodes:
            args.options["max-nodes"] === undefined ? undefined : Number(args.options["max-nodes"]),
          interactiveOnly: boolOption(args, "interactive-only") || undefined,
        }),
      };

    case "act":
      return {
        operation: "act",
        args: defined({
          session,
          action: stringOption(args, "action") ?? "",
          ref: stringOption(args, "ref"),
          ref2: stringOption(args, "ref2"),
          snapshot: stringOption(args, "snapshot"),
          args: inputFor(args),
          idempotencyKey: stringOption(args, "idempotency-key"),
          holder: stringOption(args, "holder") ?? CLI_HOLDER,
          // `--secret <value>`, repeatable: what must not come back in a result,
          // an event or a trajectory line (SF-15).
          secrets: stringOptions(args, "secret").length === 0 ? undefined : stringOptions(args, "secret"),
        }),
      };

    case "read":
      return {
        operation: "read",
        args: defined({
          session,
          kind: stringOption(args, "kind") ?? "text",
          ref: stringOption(args, "ref"),
          name: stringOption(args, "name"),
        }),
      };

    case "check": {
      const input = inputFor(args);
      if (input === undefined) {
        throw new Error(
          "`yam surface check` needs --input <file.json> or --input - with the predicate and " +
            "subject, so a value with quotes or spaces survives the shell.",
        );
      }
      const check = input as { predicate?: unknown; subject?: unknown };
      return {
        operation: "check",
        args: defined({
          session,
          predicate: check.predicate,
          subject: check.subject ?? "ref",
          ref: stringOption(args, "ref"),
        }),
      };
    }

    case "close":
      return { operation: "close", args: { session } };
    case "sessions":
      return { operation: "sessions", args: {} };
    case "capabilities":
      return { operation: "capabilities", args: { session } };
    case "events":
      return { operation: "events", args: { session } };
    case "describe":
      return {
        operation: "describe",
        args: defined({ session, ref: stringOption(args, "ref") ?? "", snapshot: stringOption(args, "snapshot") }),
      };
    case "control": {
      const take = boolOption(args, "take");
      const release = boolOption(args, "release");
      return {
        operation: "control",
        args: defined({
          session,
          action: take ? "take" : release ? "release" : "status",
          holder: stringOption(args, "holder") ?? CLI_HOLDER,
          force: boolOption(args, "force") || undefined,
        }),
      };
    }

    case "request": {
      /*
       * `--input` carries the whole `ApiRequest` — headers, a JSON body, auth —
       * without shell quoting hazards; `--method`/`--url` are the short form for
       * the common case. The two compose: the flags win over the file, so a
       * saved request can be re-sent against another path.
       */
      const input = (inputFor(args) ?? {}) as Record<string, unknown>;
      const method = stringOption(args, "method") ?? (input["method"] as string | undefined) ?? "GET";
      const url = stringOption(args, "url") ?? (input["url"] as string | undefined);
      if (url === undefined) {
        throw new Error(
          "`yam surface request` needs --url <url-or-path>, or an --input file with one.",
        );
      }
      return {
        operation: "request",
        args: defined({
          session,
          request: { name: "request", ...input, method: method.toUpperCase(), url },
          withSessionCookies: boolOption(args, "with-session-cookies") || undefined,
          holder: stringOption(args, "holder") ?? CLI_HOLDER,
        }),
      };
    }

    case "screenshot":
      return {
        operation: "screenshot",
        args: defined({ session, path: stringOption(args, "path") }),
      };

    default:
      throw new Error(`Unknown surface subcommand "${sub}".`);
  }
}

/** `--input <file>` or `--input -`, parsed; read here because the file is here. */
function inputFor(args: ParsedArgs): Record<string, unknown> | undefined {
  const path = stringOption(args, "input");
  if (path === undefined) return undefined;
  const raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
