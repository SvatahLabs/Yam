import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXIT, stringOption, boolOption, type ParsedArgs, type ExitCode, type CommandIo } from "@svatah/yam-bindings-cli";
import {
  operationByCliSubcommand,
  SURFACE_CLI_SUBCOMMANDS,
  createAdapterFactory,
  createSessionStore,
  dispatchConnect,
  dispatchSnapshot,
  dispatchAct,
  dispatchRead,
  dispatchCheck,
  dispatchClose,
  dispatchSessions,
  dispatchCapabilities,
  dispatchDescribe,
  dispatchScreenshot,
  type DispatchContext,
} from "@svatah/yam-surface-control";
import { createSurface, listAdapters } from "@svatah/yam-surface";
import { registerAllAdapters } from "../adapters.js";

const store = createSessionStore();

function ctx(): DispatchContext {
  return { sessions: store };
}

function factory() {
  registerAllAdapters();
  return createAdapterFactory(
    async (_name, config) => await createSurface(config),
    listAdapters,
  );
}

export const SURFACE_CONTROL_SUBCOMMANDS = new Set(
  SURFACE_CLI_SUBCOMMANDS.filter((s) => s !== "conform" && s !== "doctor"),
);

export async function surfaceControlCommand(
  args: ParsedArgs,
  io: CommandIo,
): Promise<ExitCode> {
  const sub = args.command[1];
  if (sub === undefined || !SURFACE_CONTROL_SUBCOMMANDS.has(sub)) {
    return undefined as unknown as ExitCode;
  }

  const json = boolOption(args, "json");
  const emit = (data: unknown): void => {
    io.out(JSON.stringify(data, null, json ? 2 : 0));
  };

  try {
    const result = await dispatch(sub, args, io);
    emit(result);
    const status = (result as Record<string, unknown>).status;
    if (status === "failed") {
      const error = (result as Record<string, { code?: string }>).error;
      if (error?.code === "CHECK_FAILED") return 20 as ExitCode;
      if (error?.code === "SESSION_NOT_FOUND" || error?.code === "SESSION_CLOSED") return 21 as ExitCode;
      if (error?.code === "ADAPTER_UNAVAILABLE" || error?.code === "ADAPTER_NOT_REGISTERED") return 22 as ExitCode;
      if (error?.code === "CONNECT_FAILED") return 23 as ExitCode;
      if (error?.code === "INVALID_ARGUMENT") return EXIT.usage;
      if (error?.code === "TIMEOUT") return 75 as ExitCode;
      return EXIT.failed;
    }
    return EXIT.ok;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return EXIT.failed;
  }
}

async function dispatch(
  sub: string,
  args: ParsedArgs,
  io: CommandIo,
): Promise<Record<string, unknown>> {
  const session = stringOption(args, "session") ?? "";

  switch (sub) {
    case "connect":
      return await dispatchConnect(ctx(), {
        url: stringOption(args, "url"),
        adapter: stringOption(args, "adapter"),
        headed: boolOption(args, "headed") || undefined,
        adapterFactory: factory(),
      });

    case "snapshot":
      return await dispatchSnapshot(ctx(), {
        session,
        root: stringOption(args, "root"),
        maxNodes: args.options["max-nodes"] !== undefined
          ? Number(args.options["max-nodes"])
          : undefined,
        interactiveOnly: boolOption(args, "interactive-only") || undefined,
      });

    case "act": {
      const action = stringOption(args, "action") ?? "";
      const ref = stringOption(args, "ref");
      const ref2 = stringOption(args, "ref2");
      let actArgs: Record<string, unknown> | undefined;
      const inputPath = stringOption(args, "input");
      if (inputPath !== undefined) {
        const raw = inputPath === "-"
          ? readStdin()
          : readFileSync(resolve(inputPath), "utf8");
        actArgs = JSON.parse(raw) as Record<string, unknown>;
      }
      return await dispatchAct(ctx(), {
        session,
        action,
        ref,
        ref2,
        args: actArgs as never,
      });
    }

    case "read":
      return await dispatchRead(ctx(), {
        session,
        kind: (stringOption(args, "kind") ?? "text") as never,
        ref: stringOption(args, "ref"),
        name: stringOption(args, "name"),
      });

    case "check": {
      const inputPath = stringOption(args, "input") ?? "";
      const raw = inputPath === "-"
        ? readStdin()
        : readFileSync(resolve(inputPath), "utf8");
      const checkInput = JSON.parse(raw) as {
        predicate: { kind: string; value?: string; name?: string; negate?: boolean };
        subject: string;
      };
      return await dispatchCheck(ctx(), {
        session,
        predicate: checkInput.predicate,
        subject: checkInput.subject as never,
        ref: stringOption(args, "ref"),
      });
    }

    case "close":
      return await dispatchClose(ctx(), { session });

    case "sessions":
      return await dispatchSessions(ctx());

    case "capabilities":
      return await dispatchCapabilities(ctx(), { session });

    case "describe":
      return await dispatchDescribe(ctx(), {
        session,
        ref: stringOption(args, "ref") ?? "",
      });

    case "screenshot":
      return await dispatchScreenshot(ctx(), {
        session,
        path: stringOption(args, "path"),
      });

    default:
      throw new Error(`Unknown surface subcommand "${sub}".`);
  }
}

function readStdin(): string {
  return readFileSync(0, "utf8");
}
