/**
 * `yam runs tail` (T14.5): the events of the current run, as they arrive over
 * the service's stream, one line each. What the workspace's bottom-right pane
 * runs. It attaches to the service `YAM_SERVICE_URL`/`YAM_SERVICE_TOKEN` or
 * `--url`/`--token` name, and never starts one: a tail of nothing is nothing.
 */
import { EXIT, stringOption, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";

/** One line per event, in the run report's own marks. */
export function tailLine(event: { readonly kind: string } & Record<string, unknown>): string | undefined {
  switch (event.kind) {
    case "run.started":
      return `run ${String(event["runId"] ?? "")} started`;
    case "step.result": {
      const result = (event["result"] ?? event) as { status?: string; story?: string; text?: string; failure?: { message?: string } };
      const marks: Record<string, string> = { passed: "✓", failed: "✗", skipped: "–", healed: "~", aborted: "!" };
      const line = `  ${marks[result.status ?? ""] ?? "·"} ${result.story ?? ""} · ${result.text ?? ""}`;
      return result.status === "failed" && result.failure?.message !== undefined
        ? `${line}\n      ${result.failure.message.split("\n")[0]}`
        : line;
    }
    case "run.summary": {
      const summary = (event["summary"] ?? event) as { runId?: string; totals?: { passed?: number; failed?: number; skipped?: number }; exitCode?: number };
      const t = summary.totals ?? {};
      return `run ${summary.runId ?? ""}: ${t.passed ?? 0} passed, ${t.failed ?? 0} failed, ${t.skipped ?? 0} skipped (exit ${summary.exitCode ?? "?"})`;
    }
    case "run.failed":
      return `run ${String(event["runId"] ?? "")} failed: ${String(event["message"] ?? "")}`;
    case "log":
      return `  ${String(event["level"] ?? "log")}: ${String(event["message"] ?? "")}`;
    default:
      return undefined;
  }
}

export async function runsCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (args.command[1] !== "tail") {
    io.err("yam runs tail [--url <url> --token <t>]   the current run's events, as they happen");
    return EXIT.usage;
  }
  const url = stringOption(args, "url") ?? process.env["YAM_SERVICE_URL"];
  const token = stringOption(args, "token") ?? process.env["YAM_SERVICE_TOKEN"];
  if (url === undefined || token === undefined) {
    io.err("`yam runs tail` follows a running service: pass --url and --token, or start it from `yam ui --tmux`, which sets them.");
    return EXIT.usage;
  }
  const { YamClient } = await import("@svatah/yam-sdk");
  const client = new YamClient({ url, token });
  io.err(`following ${url}`);
  await new Promise<void>((done) => {
    const stop = client.subscribe(
      (event) => {
        const line = tailLine(event as { readonly kind: string } & Record<string, unknown>);
        if (line !== undefined) io.out(line);
      },
      { onError: (error) => { io.err(`stream ended: ${error.message}`); stop(); done(); } },
    );
    process.once("SIGINT", () => { stop(); done(); });
    process.once("SIGTERM", () => { stop(); done(); });
  });
  return EXIT.ok;
}
