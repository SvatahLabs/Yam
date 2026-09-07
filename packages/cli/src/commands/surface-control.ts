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
  acquireStartLock,
  brokerState,
  callBroker,
  createAdapterFactory,
  discoverBroker,
  generateToken,
  removeBrokerDescriptor,
  startBroker,
  writeBrokerDescriptor,
  type BrokerDescriptor,
  type BrokerOperation,
  type StartLock,
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
 * The broker this machine is using, started if there is not one — and exactly
 * one of it (T00, SF-05, SF-13).
 *
 * Started detached and unref'd, because it must outlive the command that
 * needed it — that is the whole point of it.
 *
 * ## The two ways this used to hand back a broker that was not the one holding
 * the caller's sessions
 *
 * **It started a second broker.** The body was "look for a descriptor; if there
 * is none, spawn one and wait for a descriptor to appear", with nothing between
 * the looking and the spawning. Two clients that look at the same instant both
 * spawn, both brokers bind a port and write `broker.json`, and the second write
 * wins — leaving a live broker that nothing can address, holding sessions
 * nobody can reach. Two clients ask at the same moment on every run of the
 * Yam-on-Yam suite: the command line driving the packaged application, and the
 * application's own service, which reaches the same broker through the same
 * catalogue. That is why the outer session used to disappear with
 * `SESSION_NOT_FOUND` *around the moment the application opens its own inner
 * session* — that moment is the first time the application's service needs a
 * broker. `acquireStartLock` makes starting one exclusive: the winner starts it,
 * the losers wait for the descriptor it publishes.
 *
 * **It replaced a broker that was merely busy.** `brokerAlive` answers a
 * boolean over a two-second deadline, and a broker launching a browser for
 * somebody else can take longer than that to answer a health check. The old
 * body read the `false`, removed the descriptor, and started a second broker —
 * orphaning the first with every session on it, without ever asking whether its
 * process was still there. `brokerState` separates the three cases, and only
 * one of them is a reason to replace anything.
 */
export async function connectToBroker(io: CommandIo): Promise<BrokerDescriptor> {
  const deadline = Date.now() + 60_000;
  let announcedWait = false;
  /** What the loop was waiting for, so the deadline's message says which. */
  let waitingFor = "a broker to start";

  while (Date.now() < deadline) {
    const found = discoverBroker();

    if (found !== undefined) {
      const { state } = await brokerState(found);
      if (state === "serving") return found;

      if (state === "busy") {
        waitingFor = `the broker at ${found.url} to answer; its process is alive and busy`;
        /*
         * Alive, and working for somebody else. Waiting is the whole fix: the
         * previous behaviour was to conclude it was gone and start a rival.
         */
        await new Promise((done) => setTimeout(done, 250));
        continue;
      }

      if (state === "mismatched") {
        /*
         * It answers, and it speaks a different contract (T18, SF-03).
         *
         * The broker outlives the commands that use it, and a machine can
         * easily have one a different build started — the packaged application
         * starts its own from the copy of the CLI staged inside the bundle.
         * Talking to it looked like it worked: arguments the older build had
         * never heard of were dropped and the operation answered `succeeded`,
         * on a target the caller never named.
         *
         * A broker that cannot serve this contract is stopped rather than
         * reasoned with — but under the start lock, so that stopping it and
         * starting its replacement is one indivisible act rather than a window
         * in which a third client can start a third broker.
         */
        const lock = acquireStartLock();
        if (lock === undefined) {
          await new Promise((done) => setTimeout(done, 250));
          continue;
        }
        try {
          const still = discoverBroker();
          if (still === undefined || (await brokerState(still)).state !== "mismatched") continue;
          io.err(
            "the surface broker on this machine was started from a different build of Yam; " +
              "stopping it and starting one that matches. Sessions opened on it are closed.",
          );
          try {
            process.kill(still.pid, "SIGTERM");
          } catch {
            /* Already gone, or somebody else's; the descriptor goes either way. */
          }
          for (let waited = 0; waited < 10_000; waited += 100) {
            await new Promise((done) => setTimeout(done, 100));
            if ((await brokerState(still)).state === "gone") break;
          }
          removeBrokerDescriptor();
          return await startBrokerProcess(io, lock, deadline);
        } finally {
          lock.release();
        }
      }

      // `gone`: the descriptor is about a process that is not answering and is
      // not there. Fall through and start one.
      removeBrokerDescriptor();
    }

    const lock = acquireStartLock();
    if (lock === undefined) {
      /*
       * Somebody else is starting one right now. Wait for *their* descriptor
       * rather than starting a rival — this is the branch that used to be a
       * second `spawn`.
       */
      waitingFor = "the broker another command on this machine is starting";
      if (!announcedWait) {
        io.err("waiting for the surface broker another command is starting.");
        announcedWait = true;
      }
      await new Promise((done) => setTimeout(done, 100));
      continue;
    }
    try {
      /*
       * Under the lock, look again. Between failing to find a broker and taking
       * the lock, the process that held it may have published a perfectly good
       * one — and starting a second on top of it is the defect this whole
       * function exists to remove.
       */
      const now = discoverBroker();
      if (now !== undefined && (await brokerState(now)).state === "serving") return now;
      return await startBrokerProcess(io, lock, deadline);
    } finally {
      lock.release();
    }
  }

  throw new Error(
    `Gave up after 60 s waiting for ${waitingFor}. Run \`yam surface broker\` in another ` +
      "terminal to see what it says.",
  );
}

/**
 * Spawn the broker and wait for it to publish itself. Called only while holding
 * the start lock, which is what makes "one broker per machine" true.
 */
async function startBrokerProcess(
  io: CommandIo,
  lock: StartLock,
  deadline: number,
): Promise<BrokerDescriptor> {
  io.err("starting the surface broker; it holds your sessions between commands.");
  const child = spawn(process.execPath, [yamBin(), "surface", "broker"], {
    detached: true,
    stdio: "ignore",
    /*
     * The child inherits the lock's identity through the environment, so the
     * broker it becomes can keep the lock held until it has published its
     * descriptor — the parent command may exit before then.
     */
    env: { ...process.env, YAM_BROKER_START_LOCK: "held" },
  });
  child.unref();

  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
    const descriptor = discoverBroker();
    if (descriptor !== undefined && (await brokerState(descriptor)).state === "serving") {
      return descriptor;
    }
    if (child.exitCode !== null) {
      lock.release();
      throw new Error(
        `The surface broker exited with ${child.exitCode} instead of starting. Run ` +
          "`yam surface broker` in another terminal to see what it says.",
      );
    }
  }
  throw new Error(
    "The surface broker did not start within 60 s. Run `yam surface broker` in another " +
      "terminal to see what it says.",
  );
}

/**
 * Run the broker in the foreground; the spawned process is this.
 *
 * It takes the start lock for itself when a person runs `yam surface broker`
 * directly, and does not when `connectToBroker` spawned it — that caller holds
 * the lock on its behalf until this process has published its descriptor, which
 * is the window the lock exists to close. Without the distinction the spawned
 * broker would wait for a lock its own parent is holding.
 */
async function runBroker(io: CommandIo): Promise<ExitCode> {
  const spawnedUnderLock = process.env["YAM_BROKER_START_LOCK"] === "held";
  let lock: StartLock | undefined;
  if (!spawnedUnderLock) {
    lock = acquireStartLock();
    if (lock === undefined) {
      io.err("another command is starting the surface broker on this machine.");
      return EXIT.ok;
    }
  }
  const existing = discoverBroker();
  if (existing !== undefined && (await brokerState(existing)).state !== "gone") {
    io.err(`a broker is already running at ${existing.url}`);
    lock?.release();
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
  /*
   * The lock covers the decision and the publication, not the lifetime. Until
   * the descriptor exists there is nothing for another client to find, and that
   * gap is the race; once it exists every client finds this broker the ordinary
   * way, and holding the lock any longer would stop a legitimate replacement of
   * a mismatched build for ever.
   */
  lock?.release();
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
          /*
           * How to start it, as the design's typed nested object (T22).
           *
           * From `--launch <json>` or from `--input`, because a program's
           * arguments and a directory path are exactly the values `--input`
           * exists to carry "without shell quoting hazards" (SF-06).
           */
          launch: launchFor(args),
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

/**
 * The launch object a connect was given, from its flag or from `--input`.
 *
 * A flag for a small one — `--launch '{"args":["--version"]}'` is a line a
 * person types — and `--input` for a large one, which is the same choice every
 * other structured argument of this command family offers.
 */
function launchFor(args: ParsedArgs): Record<string, unknown> | undefined {
  const flag = stringOption(args, "launch");
  if (flag !== undefined) {
    try {
      return JSON.parse(flag) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `--launch is a JSON object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const input = inputFor(args);
  if (input === undefined) return undefined;
  const nested = input["launch"];
  return (nested === undefined ? input : nested) as Record<string, unknown>;
}

/** `--input <file>` or `--input -`, parsed; read here because the file is here. */
function inputFor(args: ParsedArgs): Record<string, unknown> | undefined {
  const path = stringOption(args, "input");
  if (path === undefined) return undefined;
  const raw = path === "-" ? readFileSync(0, "utf8") : readFileSync(resolve(path), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
