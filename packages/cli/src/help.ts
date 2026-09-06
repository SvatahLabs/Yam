/**
 * Help (T14.3, REQ-CLI-2, 4, 7, 8, 9, LLD §15.1).
 *
 * One screen at the top, one command at a time below it, one page per topic.
 * The text people read is in this file and under `help/`, and none of it
 * names a specification section, a requirement id, a task or a module letter:
 * those are for the code, and a repository check reads every string here to
 * hold that.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "@svatah/yam-bindings-cli";

/** The top-level help, verbatim from the design; a test compares it. */
export const TOP_LEVEL = `yam — describe a behaviour once, bind it to the real application, replay it without a model

  yam init [dir]      start a project here
  yam check           read, lint and compile the flows; writes .yam/plan.json
  yam record          bind the targets by driving the real application
  yam run             replay the plan; the exit code is the verdict
  yam heal            repair the bindings the interface moved, from the last run
  yam ui              the terminal cockpit (--tmux for the workspace)
  yam serve           the local service, for Yam.app and other clients

  yam <command> --help   options and exit codes of one command
  yam help <topic>       flows · bindings · exit-codes · session · adapters · agents

More, one level down: yam bindings · workflow · tool · mcp · eval · surface · migrate · repl · trajectory · host
`;

/** What each exit code means, in the words `yam help exit-codes` prints. */
export const EXIT_MEANINGS: ReadonlyArray<readonly [number, string, string]> = [
  [EXIT.ok, "ok", "everything passed, or the command did what it was asked"],
  [EXIT.failed, "failed", "a step failed, or a check found something wrong"],
  [EXIT.compileErrors, "compile errors", "the flows, data or config have errors; nothing was written or run"],
  [EXIT.modelUnavailable, "model unavailable", "a model tier was asked for and its backend could not be reached"],
  [EXIT.groundingFailed, "grounding failed", "record could not bind a target to an element"],
  [EXIT.expectationFailed, "expectation failed", "an expectation failed while recording"],
  [EXIT.healed, "healed", "the run passed only because a binding was healed; review the repair"],
  [EXIT.someUnrepaired, "some unrepaired", "heal could not repair every failure"],
  [EXIT.unmapped, "unmapped", "migrate found something in the source it has no mapping for"],
  [EXIT.refused, "refused", "a story that is not marked idempotent, against a production configuration"],
  [EXIT.aborted, "aborted", "a flow stopped under its failure policy; a compensating story may have run"],
  [EXIT.hashMismatch, "cannot resume", "the plan or the bindings changed since the checkpoint"],
  [EXIT.usage, "usage", "the command line itself was wrong"],
];

/** The session context, written once (REQ-CLI-7). */
const SESSION = `Session options — the same on every command that opens a session

  --base-url <url>            where the application is
  --storage-state <path.json> a saved browser state to start from (cookies, local storage)
  --input k=v                 a value for a story's declared input; repeatable
  --headed                    show the browser
  --out <dir>                 where runs are written (default: runs/)
  --run-id <id>               name the run yourself

Where each value comes from, first match wins:

  1. the flag on the command line
  2. the environment: YAM_BASE_URL, YAM_STORAGE_STATE, YAM_INPUT_<NAME>
  3. the project's yam.config.yaml, under app:

A secret input belongs in the environment (YAM_INPUT_PASSWORD=…), never on
the command line, where it would be visible in the process list. It reaches
the story and is redacted in every file a run writes.
`;

interface CommandHelp {
  /** The words after `yam`, as typed. */
  readonly name: string;
  readonly synopsis: string;
  readonly description: string;
  readonly options?: ReadonlyArray<readonly [string, string]>;
  /** Refers to `yam help session` rather than restating the group. */
  readonly session?: boolean;
  readonly exits?: ReadonlyArray<number>;
}

const json: readonly [string, string] = ["--json", "one JSON document on stdout, nothing else"];

/** Every command, with its own help. Order is the order `yam help` lists them, then the nouns. */
export const COMMANDS: readonly CommandHelp[] = [
  { name: "init", synopsis: "yam init [dir] [--force]", description: "Start a project: yam.config.yaml, flows/ with an example, data.yaml, and the directories the other verbs use.", options: [["--force", "write into a directory that already has a project"]], exits: [EXIT.ok, EXIT.usage] },
  { name: "check", synopsis: "yam check [dir] [--tier2] [--tier3] [--allow-model-drift] [--json]", description: "Read, lint and compile the flows in one verb, and write .yam/plan.json. lint and compile are its two halves, kept as commands of their own.", options: [["--tier2", "let the local model compile sentences the grammar refuses"], ["--tier3", "let the frontier model compile what the local model cannot"], ["--allow-model-drift", "compile even though the pinned model digest changed"], json], exits: [EXIT.ok, EXIT.compileErrors, EXIT.modelUnavailable] },
  { name: "lint", synopsis: "yam lint [dir] [--json]", description: "Read the flows and report errors and warnings without writing a plan.", options: [json], exits: [EXIT.ok, EXIT.compileErrors] },
  { name: "compile", synopsis: "yam compile [dir] [--stable] [--out .yam/plan.json] [--tier2] [--tier3] [--allow-model-drift] [--json]", description: "Compile the flows into the plan. --stable makes the output byte for byte reproducible, which is what lets the plan be committed.", options: [["--stable", "reproducible output; the same flows give the same bytes"], ["--out <path>", "where to write the plan"], ["--tier2", "let the local model compile sentences the grammar refuses"], ["--tier3", "let the frontier model compile what the local model cannot"], ["--allow-model-drift", "compile even though the pinned model digest changed"], json], exits: [EXIT.ok, EXIT.compileErrors, EXIT.modelUnavailable] },
  { name: "record", synopsis: "yam record [dir] [--flow <file>] [--story <name>] [--rebind] [--gateway anthropic|fake] [--force-production] [--json]", description: "Drive the plan against the real application and bind every target to an element: by your click in a headed browser, or through a model gateway when one is configured. Nothing is written before you have seen it.", options: [["--flow <file>", "only this flow"], ["--story <name>", "only this story; repeatable"], ["--rebind", "record elements that already have a binding"], ["--gateway anthropic|fake", "who grounds a phrase to an element; fake needs no credential"], ["--force-production", "record against a production configuration anyway"], json], session: true, exits: [EXIT.ok, EXIT.compileErrors, EXIT.groundingFailed, EXIT.expectationFailed, EXIT.refused] },
  { name: "run", synopsis: "yam run [dir] [--host playwright|none] [--flow <file>] [--story <name>] [--workers <n>] [--resume <runId> --from <stepId>] [--no-check] [--json]", description: "Replay the plan. The plan is checked first when the flows changed; the run directory holds results, summary, audit, checkpoints and screenshots; the exit code is the verdict.", options: [["--host playwright|none", "inside Playwright Test, or the standalone executor (default: none)"], ["--flow <file>", "only this flow"], ["--story <name>", "only this story; repeatable"], ["--workers <n>", "flows in parallel"], ["--resume <runId> --from <stepId>", "pick a run up at a checkpoint"], ["--no-check", "run the plan on disk as it is; refused when it is stale"], json], session: true, exits: [EXIT.ok, EXIT.failed, EXIT.compileErrors, EXIT.healed, EXIT.aborted, EXIT.hashMismatch] },
  { name: "heal", synopsis: "yam heal [--run <id> | --from-bind-failures] [--project <dir>] [--apply] [--no-model] [--json]", description: "Repair the bindings the interface moved. With no arguments, the last run of this project. A repair is a proposed diff and a report; --apply writes it to the store.", options: [["--run <id>", "the run to heal (default: the last run)"], ["--from-bind-failures", "the failures a plain Playwright project wrote under .yam/"], ["--project <dir>", "the project (default: the nearest one above the working directory)"], ["--apply", "write the accepted repairs into the store"], ["--no-model", "relocalize only; never ask a model to re-ground"], ["--dir <bindings>", "the store (default: bindings/)"], ["--runs <dir>", "where runs are (default: runs/)"], json], session: true, exits: [EXIT.ok, EXIT.someUnrepaired, EXIT.usage] },
  { name: "ui", synopsis: "yam ui [dir] [--screen flows|run] [--flow <file>] [--run <id>] [--story <name>] [--url <url> --token <t>] [--tmux] [--json] [--capture <ms>]", description: "The terminal cockpit: four panes, the same screens and actions as Yam.app. --tmux opens the workspace: the cockpit, a shell, the audit tail and your editor in one tmux session.", options: [["--screen flows|run", "open on a screen"], ["--flow <file>", "open on a flow"], ["--run <id>", "open on a run"], ["--story <name>", "open on a story"], ["--url <url>", "attach to a service that is already running"], ["--token <t>", "that service's bearer token"], ["--tmux", "the workspace, in a tmux session named for the project"], ["--capture <ms>", "draw for that long, then quit; for scripts"], json], exits: [EXIT.ok, EXIT.usage] },
  { name: "workspace", synopsis: "yam workspace [dir]", description: "The same as yam ui --tmux.", exits: [EXIT.ok, EXIT.usage] },
  { name: "serve", synopsis: "yam serve [dir] [--port 0] [--token <t>]", description: "The local service on 127.0.0.1, behind a bearer token printed once on stdout. Yam.app, the cockpit and the SDK talk to it; every handler calls the same functions the command line calls.", options: [["--port <n>", "the port (default: one the system chooses)"], ["--token <t>", "the bearer token (default: generated)"]], exits: [EXIT.ok] },
  { name: "status", synopsis: "yam status [dir] [--json]     (the same as yam with nothing after it)", description: "Where you are and what is next: the flows, the plan, the unbound targets, the last run, and the one verb to run now. This is what yam alone prints.", options: [json], exits: [EXIT.ok] },
  { name: "doctor", synopsis: "yam doctor [dir] [--json]", description: "Check the host and the project: Node, the adapters, the config, the flows, the bindings, the data.", options: [json], exits: [EXIT.ok, EXIT.failed] },
  { name: "repl", synopsis: "yam repl [dir] [--adapter <name>] [--headless] [--gateway anthropic|fake|none] [--tier2] [--tier3] [--out <flows>] [--name <flow name>] [--json]", description: "Type sentences and watch them run against a live session; save what worked as a flow.", options: [["--adapter <name>", "which adapter opens the session"], ["--headless", "no browser window"], ["--gateway anthropic|fake|none", "who grounds a phrase"], ["--tier2", "the local model for refused sentences"], ["--tier3", "the frontier model"], ["--out <flows>", "where a saved flow goes"], ["--name <flow name>", "the saved flow's name"], json], session: true, exits: [EXIT.ok, EXIT.usage] },
  { name: "mcp", synopsis: "yam mcp [dir] [--trajectory <path.jsonl>] [--session <id>]", description: "An MCP server over stdio with the operations and the raw surface, for an agent that explores; every call is recorded as a trajectory.", options: [["--trajectory <path.jsonl>", "where the trajectory is written"], ["--session <id>", "attach to a session"]], exits: [EXIT.ok] },
  { name: "migrate", synopsis: "yam migrate <src> <dest> [--keep-original] [--json]  ·  yam migrate <dest> --from-prototype <db dir> [--project <name>]", description: "Bring v1 and v2 flows, or a prototype database, into a v3 project.", options: [["--keep-original", "leave the source files beside the migrated ones"], ["--from-prototype <dir>", "import the prototype's database instead of flow files"], ["--project <name>", "the imported project's name"], json], exits: [EXIT.ok, EXIT.unmapped] },
  { name: "host generate", synopsis: "yam host generate [dir] [--out .yam/specs]", description: "Write one Playwright Test spec per flow, for a project that runs under Playwright Test directly.", options: [["--out <dir>", "where the specs go"]], exits: [EXIT.ok] },
  { name: "workflow run", synopsis: "yam workflow run <story> [dir] [--input k=v] [--allow-side-effects] [--resume <runId> --from <stepId>] [--json]", description: "Run one story as a function: typed inputs in, outputs on stdout as JSON. Checkpoints and audit are always on; a story not marked idempotent is refused against production.", options: [["--allow-side-effects", "run a story that is not marked idempotent against production"], ["--resume <runId> --from <stepId>", "pick the run up at a checkpoint"], json], session: true, exits: [EXIT.ok, EXIT.failed, EXIT.healed, EXIT.refused, EXIT.aborted, EXIT.hashMismatch] },
  { name: "tool serve", synopsis: "yam tool serve [dir] [--expose \"Story one,Story two\"] [--stdio] [--allow-side-effects] [--json]", description: "An MCP server whose tools are the stories: each tool's schema comes from the story's signature, each call is an audited run.", options: [["--expose <stories>", "which stories to expose, comma separated"], ["--stdio", "serve over stdio"], ["--allow-side-effects", "list stories that are not marked idempotent, even in production"], json], session: true, exits: [EXIT.ok] },
  { name: "trajectory compile", synopsis: "yam trajectory compile <trajectory.jsonl> [dir] [--name \"Story name\"] [--out proposals] [--app proposed] [--json]", description: "Turn an agent's exploration into a proposal: a flow draft, a plan fragment and unverified bindings under proposals/, for a person to read.", options: [["--name <story>", "the proposed story's name"], ["--out <dir>", "where the proposal goes (default: proposals/)"], ["--app <name>", "the app name the bindings are filed under"], json], exits: [EXIT.ok, EXIT.usage] },
  { name: "bindings list", synopsis: "yam bindings list [--dir <bindings>] [--json]", description: "Every binding in the store, with its phrases.", options: [["--dir <bindings>", "the store (default: bindings/)"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "bindings show", synopsis: "yam bindings show <id> [--dir <bindings>] [--json]", description: "One binding: its candidates, its fingerprint, its provenance.", options: [["--dir <bindings>", "the store (default: bindings/)"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "bindings verify", synopsis: "yam bindings verify [--adapter <name>] [--id <id>] [--json]", description: "Resolve every binding against the live application without acting, and report which still find exactly one element.", options: [["--adapter <name>", "which adapter opens the session"], ["--id <id>", "only this binding; repeatable"], json], session: true, exits: [EXIT.ok, EXIT.failed] },
  { name: "bindings prune", synopsis: "yam bindings prune [--used-in <dirs>] [--apply] [--json]", description: "Find bindings no flow or test names any more; --apply removes them.", options: [["--used-in <dirs>", "where to look for uses"], ["--apply", "delete what nothing uses"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface conform", synopsis: "yam surface conform --adapter <name> [--only <ids>] [--report <path.md>] [--json]", description: "Run the conformance suite against an adapter; exit 0 is conformant.", options: [["--adapter <name>", "the adapter under test"], ["--only <ids>", "a subset of cases"], ["--report <path.md>", "write the report"], json], session: true, exits: [EXIT.ok, EXIT.failed] },
  { name: "surface doctor", synopsis: "yam surface doctor [--adapter ax|uia] [--json]", description: "Whether this host can run a desktop adapter: the permission, the session, screen recording.", options: [["--adapter ax|uia", "which adapter"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "eval healing", synopsis: "yam eval healing [--no-model] [--report <path.md>] [--json]", description: "The healing numbers over the sample application's variants.", options: [["--no-model", "relocalize only"], ["--report <path.md>", "write the report"], json], session: true, exits: [EXIT.ok, EXIT.failed] },
  { name: "eval grounding", synopsis: "yam eval grounding [--gateway anthropic|fake] [--cases <path.jsonl>] [--limit <n>] [--report <path.md>] [--json]", description: "The recorder's grounding accuracy over a case file.", options: [["--gateway anthropic|fake", "who grounds"], ["--cases <path.jsonl>", "the cases"], ["--limit <n>", "only the first n"], ["--report <path.md>", "write the report"], json], session: true, exits: [EXIT.ok, EXIT.failed] },
  { name: "eval compiler", synopsis: "yam eval compiler [--tier2] [--tier3] [--gateway local|anthropic|fake] [--only tier1,tier2] [--report <path.md>] [--json]", description: "Exact-match accuracy of the compiler over the golden set, per tier.", options: [["--tier2", "include the local model"], ["--tier3", "include the frontier model"], ["--gateway local|anthropic|fake", "which backend"], ["--only <tiers>", "a subset of tiers"], ["--report <path.md>", "write the report"], json], exits: [EXIT.ok, EXIT.failed, EXIT.modelUnavailable] },
  { name: "eval self", synopsis: "yam eval self [--update] [--report <path.md>] [--only <check-id>] [--side yam|external]", description: "Yam verifies Yam: every check run two ways, and the agreement between them.", options: [["--update", "refresh the committed reports"], ["--report <path.md>", "write the report elsewhere"], ["--only <check-id>", "one check"], ["--side yam|external", "one side only"]], exits: [EXIT.ok, EXIT.failed] },
  { name: "eval finetune corpus", synopsis: "yam eval finetune corpus [--json]", description: "Describe the local model's training corpus: the refused sentences with their reviewed steps.", options: [json], exits: [EXIT.ok] },
  { name: "eval finetune export", synopsis: "yam eval finetune export [--out <path.jsonl>] [--json]", description: "Export the corpus as training pairs.", options: [["--out <path.jsonl>", "where to write them"], json], exits: [EXIT.ok] },
];

/** The nouns, and the verbs under each, for `yam <noun>` alone. */
export const NOUNS: ReadonlyArray<readonly [string, string]> = [
  ["bindings", "the store: list, show, verify, prune"],
  ["workflow", "a story as a function: run"],
  ["tool", "stories as MCP tools: serve"],
  ["eval", "the published numbers: healing, grounding, compiler, self, finetune"],
  ["surface", "adapters: conform, doctor"],
  ["trajectory", "an agent's exploration: compile"],
  ["host", "Playwright Test specs: generate"],
];

export const TOPICS = ["flows", "bindings", "exit-codes", "session", "adapters", "agents"] as const;
export type Topic = (typeof TOPICS)[number];

/** Built: `dist/help/`, copied from `public/help/`; from source: `public/help/` itself. */
const HELP_DIRS = [
  join(dirname(fileURLToPath(import.meta.url)), "help"),
  join(dirname(fileURLToPath(import.meta.url)), "..", "public", "help"),
];

/** `yam help <topic>`, or undefined for a topic that does not exist. */
export function topic(name: string): string | undefined {
  if (name === "exit-codes") return exitCodesTopic();
  if (name === "session") return SESSION;
  if (!(TOPICS as readonly string[]).includes(name)) return undefined;
  const file = HELP_DIRS.map((dir) => join(dir, `${name}.md`)).find((one) => existsSync(one));
  return file === undefined ? undefined : readFileSync(file, "utf8");
}

/** The exit-code table, from the codes themselves, so it cannot drift (REQ-CLI-8). */
export function exitCodesTopic(): string {
  const width = Math.max(...EXIT_MEANINGS.map(([, name]) => name.length));
  return (
    "Exit codes — what a script or a CI job branches on\n\n" +
    EXIT_MEANINGS.map(([code, name, meaning]) => `  ${String(code).padStart(3)}  ${name.padEnd(width)}  ${meaning}`).join("\n") +
    "\n\nA healed run is its own code on purpose: the application works and a binding drifted, and a job should decide about that deliberately.\n"
  );
}

/** Help for one command, or for a noun alone; undefined when neither matches. */
export function helpFor(words: readonly string[]): string | undefined {
  const name = words.join(" ");
  const command =
    COMMANDS.find((one) => one.name === name) ??
    // The longest command that is a prefix of what was typed: `yam run --help x`.
    [...COMMANDS].sort((a, b) => b.name.length - a.name.length).find((one) => name.startsWith(`${one.name} `));
  if (command !== undefined) {
    const lines = [command.synopsis, "", command.description];
    if (command.options !== undefined && command.options.length > 0) {
      const width = Math.max(...command.options.map(([flag]) => flag.length));
      lines.push("", ...command.options.map(([flag, what]) => `  ${flag.padEnd(width)}  ${what}`));
    }
    if (command.session === true) lines.push("", "  session options: see `yam help session`");
    if (command.exits !== undefined && command.exits.length > 0) {
      lines.push(
        "",
        "Exit codes: " +
          command.exits
            .map((code) => `${code} ${EXIT_MEANINGS.find(([c]) => c === code)?.[1] ?? ""}`.trim())
            .join(" · "),
      );
    }
    return `${lines.join("\n")}\n`;
  }
  const noun = words[0];
  if (noun !== undefined && NOUNS.some(([n]) => n === noun)) {
    const verbs = COMMANDS.filter((one) => one.name.startsWith(`${noun} `));
    return (
      `yam ${noun} — ${NOUNS.find(([n]) => n === noun)?.[1] ?? ""}\n\n` +
      verbs.map((one) => `  ${one.synopsis}`).join("\n") +
      "\n"
    );
  }
  return undefined;
}

/** Every string a person can read from the help, for the vocabulary check (REQ-CLI-9). */
export function userFacingHelpText(): string {
  return [
    TOP_LEVEL,
    ...COMMANDS.map((one) => helpFor(one.name.split(" ")) ?? ""),
    ...NOUNS.map(([noun]) => helpFor([noun]) ?? ""),
    ...TOPICS.map((name) => topic(name) ?? ""),
  ].join("\n");
}
