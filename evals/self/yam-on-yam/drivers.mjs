/**
 * The two public interfaces, behind one shape (T18, SF-03, SF-07).
 *
 * T18 asks for the primary journey "through `yam surface` … and again through
 * the MCP tools". Written twice it would be two journeys that drift, and the
 * one thing the run has to establish is that they are the *same* journey — so
 * it is written once (`journey.mjs`) against the small interface below, and
 * these are its two implementations.
 *
 * Neither of them reaches inside the product. The CLI driver spawns the built
 * binary and reads its stdout; the MCP driver spawns `@svatah/yam-mcp` and speaks the
 * protocol to it over stdio through the official SDK client, as an ordinary
 * agent would. There is no in-memory transport here on purpose: SF-07 asks for
 * "the actual subprocess transport", and wave 3's second defect was an MCP
 * server that had never been run as one.
 *
 * Every call is recorded — the command a person would type, or the tool an
 * agent would call, and the envelope that came back. That record *is* the
 * evidence T18 asks to be kept.
 */
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CLI, MCP_SERVER, ROOT } from "./launch.mjs";

/** The flag spelling a catalogue argument has on the command line. */
const FLAG = {
  maxNodes: "max-nodes",
  interactiveOnly: "interactive-only",
  idempotencyKey: "idempotency-key",
};

/**
 * What `--input` carries, per operation.
 *
 * The command line does not spell a structured argument as a flag: `act` reads
 * its whole `args` object from `--input`, and `check` reads its predicate and
 * subject from one. The MCP tools take the same values as named arguments, so
 * this mapping is the only place the two shapes differ — and keeping it in one
 * table is what lets `journey.mjs` be written once.
 */
const CLI_INPUT = {
  act: (args) => args.args,
  check: (args) => ({ predicate: args.predicate, subject: args.subject ?? "ref" }),
  request: (args) => args.request,
  /*
   * `connect`'s launch object goes through `--input` too (T22). It carries a
   * program's arguments and a directory path, which are exactly the values
   * `--input` exists to carry "without shell quoting hazards" (SF-06) — and it
   * is only there when the caller supplied one.
   */
  connect: (args) => (args.launch === undefined ? undefined : { launch: args.launch }),
};

/**
 * Where a flag is spelled differently from the argument, per the catalogue.
 *
 * `control` is the one that differs: the operation takes `action: take |
 * release | status`, and the command line spells those `--take` and
 * `--release`, which is what the catalogue declares. Translating here rather
 * than writing the journey twice is the point of this file — and it is now
 * *enforced*, because `yam surface` rejects a flag the catalogue does not
 * declare instead of ignoring it.
 */
/** The operations whose catalogue entry declares a `--holder`. */
const TAKES_HOLDER = new Set(["act", "control", "request"]);

const CLI_ARGS = {
  control: ({ action, ...rest }) => ({
    ...rest,
    ...(action === "take" ? { take: true } : {}),
    ...(action === "release" ? { release: true } : {}),
  }),
};

/**
 * `yam surface …`, spawned.
 *
 * Complex arguments go through `--input -` on stdin, which is what the
 * catalogue's own CLI shape says to do with a value that would otherwise meet
 * the shell's quoting rules (SF-06).
 */
export function cliDriver({ transcript, holder }) {
  return {
    kind: "cli",
    what: "yam surface",
    async call(operation, args = {}) {
      const flags = [];
      let stdin;
      const spelled = CLI_ARGS[operation]?.(args) ?? args;
      const body = CLI_INPUT[operation]?.(args);
      const structured = new Set(["args", "predicate", "subject", "request", "launch"]);
      for (const [name, value] of Object.entries(spelled)) {
        if (value === undefined) continue;
        if (body !== undefined && structured.has(name)) continue;
        const flag = `--${FLAG[name] ?? name}`;
        if (typeof value === "boolean") {
          if (value) flags.push(flag);
        } else {
          flags.push(flag, String(value));
        }
      }
      if (body !== undefined) {
        flags.push("--input", "-");
        stdin = JSON.stringify(body);
      }
      /*
       * `--holder` only where the catalogue declares it. `connect` does not
       * take one — a session is not held until somebody takes it — and
       * `yam surface` now rejects a flag an operation does not declare, which
       * is how this line came to be written correctly.
       */
      if (
        holder !== undefined &&
        !flags.includes("--holder") &&
        TAKES_HOLDER.has(operation)
      ) {
        flags.push("--holder", holder);
      }

      const argv = ["surface", operation, ...flags, "--json"];
      const ran = spawnSync(process.execPath, [CLI, ...argv], {
        encoding: "utf8",
        cwd: ROOT,
        ...(stdin === undefined ? {} : { input: stdin }),
        maxBuffer: 64 * 1024 * 1024,
      });
      const line = `yam ${argv.join(" ")}${stdin === undefined ? "" : `  <<< ${stdin}`}`;
      let envelope;
      try {
        envelope = JSON.parse(ran.stdout);
      } catch {
        envelope = {
          status: "failed",
          error: {
            code: "NO_ENVELOPE",
            message: `no JSON on stdout (exit ${ran.status}): ${(ran.stderr || ran.stdout).trim().slice(0, 400)}`,
          },
        };
      }
      transcript.push({ interface: "cli", command: line, exit: ran.status, answer: envelope });
      return { envelope, exit: ran.status };
    },
    async close() {},
  };
}

/**
 * The MCP tools, over stdio, through the SDK's own client.
 *
 * The tool names come from the catalogue (`surface_<operation>`), so an
 * operation added to it is callable here without this file being edited — which
 * is the property the catalogue exists to have.
 */
export async function mcpDriver({ transcript, name = "yam-on-yam" }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    /*
     * `@svatah/yam-mcp`, not `yam mcp` (PK-02).
     *
     * The packaging wave made the MCP server its own installable and removed
     * the subcommand, and this line kept spawning the subcommand — which now
     * prints where it moved and exits 64. Nothing caught it because the eval
     * suite is not part of `pnpm -r test`: it needs a packaged application and
     * a machine with the Accessibility grant, so it runs by hand.
     */
    args: [MCP_SERVER],
    cwd: ROOT,
    stderr: "ignore",
  });
  const client = new Client({ name, version: "0" });
  await client.connect(transport);

  return {
    kind: "mcp",
    what: "MCP tools over stdio",
    client,
    async call(operation, args = {}) {
      const tool = `surface_${operation}`;
      const supplied = Object.fromEntries(
        Object.entries(args).filter(([, value]) => value !== undefined),
      );
      let envelope;
      let isError = false;
      try {
        const result = await client.callTool({ name: tool, arguments: supplied });
        isError = result.isError === true;
        const text = (result.content ?? []).find((one) => one.type === "text")?.text ?? "";
        try {
          envelope = JSON.parse(text);
        } catch {
          envelope = { status: "failed", error: { code: "NO_ENVELOPE", message: text.slice(0, 400) } };
        }
      } catch (error) {
        envelope = {
          status: "failed",
          error: { code: "TOOL_THREW", message: error instanceof Error ? error.message : String(error) },
        };
      }
      transcript.push({ interface: "mcp", tool, arguments: supplied, isError, answer: envelope });
      return { envelope, exit: envelope.status === "succeeded" ? 0 : 1 };
    },
    async close() {
      await client.close().catch(() => undefined);
    },
  };
}
