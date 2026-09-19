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
  yam explore         let an agent drive the application; its exploration becomes a proposal
  yam check           read, lint and compile the flows; writes .yam/plan.json
  yam record          record what you do in the real application as a flow; --flow binds a written one
  yam run             replay the plan; the exit code is the verdict
  yam heal            repair the bindings the interface moved, from the last run
  yam ui              the terminal cockpit (--tmux for the workspace)
  yam serve           the local service, for Yam.app and other clients

  yam <command> --help   options and exit codes of one command
  yam help <topic>       flows · bindings · exit-codes · session · adapters · agents

More, one level down: yam bindings · workflow · tool · eval · surface · migrate · repl · trajectory · host
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
  --endpoint <name>           one of the config's endpoints: its base URL, storage
                              state and environment kind replace app: and environment:

Where each value comes from, first match wins:

  1. the flag on the command line
  2. the environment: YAM_BASE_URL, YAM_STORAGE_STATE, YAM_INPUT_<NAME>
  3. the project's yam.config.yaml, under app: — or under endpoints:<name>
     when --endpoint or YAM_ENDPOINT names one

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
  { name: "init", synopsis: "yam init [dir] [--name <project>] [--adapter <name>] [--url <local base URL>] [--endpoint name=url[@kind]]... [--yes] [--force]", description: "Start a project. At a terminal it asks: the project's name, the adapter, where the application runs locally, and any remote endpoints (staging, production) with their kind. With --url or --yes it takes the flags and asks nothing. It writes yam.config.yaml, flows/ with a first story that works against any application, data.yaml, and the directories the other verbs use.", options: [["--name <project>", "the project's name (default: the directory's)"], ["--adapter <name>", "playwright, bidi, http, appium, uia or ax (default: playwright)"], ["--url <base URL>", "where the application runs locally"], ["--endpoint name=url[@kind]", "a remote endpoint; kind is test, staging or production; repeatable"], ["--yes", "ask nothing; take the flags and the defaults"], ["--force", "write into a directory that already has a project"]], exits: [EXIT.ok, EXIT.usage] },
  { name: "explore", synopsis: "yam explore [dir] [--name <story>] [--trajectory <path.jsonl>]", description: "Let an agent write the first draft. Serves the MCP surface for one exploration and, when the agent disconnects, compiles what it did into a proposal under proposals/<date>/ for you to review. The agent opens its own target with `surface_connect`; this command records what it does, it does not choose what it drives. --trajectory compiles one that an MCP session or the app's Session screen wrote.", options: [["--name <story>", "the proposed story's name"], ["--trajectory <path.jsonl>", "compile an existing trajectory instead of serving a session"], json], exits: [EXIT.ok, EXIT.usage, EXIT.failed] },
  { name: "check", synopsis: "yam check [dir] [--tier2] [--tier3] [--allow-model-drift] [--json]", description: "Read, lint and compile the flows in one verb, and write .yam/plan.json. lint and compile are its two halves, kept as commands of their own.", options: [["--tier2", "let the local model compile sentences the grammar refuses"], ["--tier3", "let the frontier model compile what the local model cannot"], ["--allow-model-drift", "compile even though the pinned model digest changed"], json], exits: [EXIT.ok, EXIT.compileErrors, EXIT.modelUnavailable] },
  { name: "lint", synopsis: "yam lint [dir] [--json]", description: "Read the flows and report errors and warnings without writing a plan.", options: [json], exits: [EXIT.ok, EXIT.compileErrors] },
  { name: "compile", synopsis: "yam compile [dir] [--stable] [--out .yam/plan.json] [--tier2] [--tier3] [--allow-model-drift] [--json]", description: "Compile the flows into the plan. --stable makes the output byte for byte reproducible, which is what lets the plan be committed.", options: [["--stable", "reproducible output; the same flows give the same bytes"], ["--out <path>", "where to write the plan"], ["--tier2", "let the local model compile sentences the grammar refuses"], ["--tier3", "let the frontier model compile what the local model cannot"], ["--allow-model-drift", "compile even though the pinned model digest changed"], json], exits: [EXIT.ok, EXIT.compileErrors, EXIT.modelUnavailable] },
  { name: "record", synopsis: "yam record [dir] [--name <story>] | yam record --flow <file> | yam record --all [--story <name>] [--rebind] [--gateway human|anthropic|fake] [--force-production] [--json]", description: "Alone: record a new flow from what you do. The browser opens at the application; drive it; each click and each value you enter becomes a sentence, each element you touch a binding. Enter at the terminal ends it and writes flows/<story>.flow. With --flow or --all: bind the targets of a flow somebody wrote, by driving it step by step — your click in the browser at each unbound target (human, the default at a terminal with no credential), or a model gateway.", options: [["--name <story>", "the story's name when recording what you do (asked otherwise)"], ["--all", "bind every unbound target in the plan"], ["--flow <file>", "only this flow"], ["--story <name>", "only this story; repeatable"], ["--rebind", "record elements that already have a binding"], ["--gateway human|anthropic|fake", "who grounds a phrase to an element: you, in the browser; a model; or the committed answers"], ["--force-production", "record against a production configuration anyway"], json], session: true, exits: [EXIT.ok, EXIT.compileErrors, EXIT.groundingFailed, EXIT.expectationFailed, EXIT.refused] },
  { name: "run", synopsis: "yam run [dir] [--host playwright|none] [--flow <file>] [--story <name>] [--workers <n>] [--resume <runId> --from <stepId>] [--no-check] [--json]", description: "Replay the plan. The plan is checked first when the flows changed; the run directory holds results, summary, audit, checkpoints and screenshots; the exit code is the verdict.", options: [["--host playwright|none", "inside Playwright Test, or the standalone executor (default: none)"], ["--flow <file>", "only this flow"], ["--story <name>", "only this story; repeatable"], ["--workers <n>", "flows in parallel"], ["--resume <runId> --from <stepId>", "pick a run up at a checkpoint"], ["--no-check", "run the plan on disk as it is; refused when it is stale"], json], session: true, exits: [EXIT.ok, EXIT.failed, EXIT.compileErrors, EXIT.healed, EXIT.aborted, EXIT.hashMismatch] },
  { name: "heal", synopsis: "yam heal [--run <id> | --from-bind-failures] [--project <dir>] [--apply] [--no-model] [--json]", description: "Repair the bindings the interface moved. With no arguments, the last run of this project. A repair is a proposed diff and a report; --apply writes it to the store.", options: [["--run <id>", "the run to heal (default: the last run)"], ["--from-bind-failures", "the failures a plain Playwright project wrote under .yam/"], ["--project <dir>", "the project (default: the nearest one above the working directory)"], ["--apply", "write the accepted repairs into the store"], ["--no-model", "relocalize only; never ask a model to re-ground"], ["--dir <bindings>", "the store (default: bindings/)"], ["--runs <dir>", "where runs are (default: runs/)"], json], session: true, exits: [EXIT.ok, EXIT.someUnrepaired, EXIT.usage] },
  { name: "ui", synopsis: "yam ui [dir] [--screen flows|run] [--flow <file>] [--run <id>] [--story <name>] [--url <url> --token <t>] [--tmux] [--json] [--capture <ms>]", description: "The terminal cockpit: four panes, the same screens and actions as Yam.app. --tmux opens the workspace: the cockpit, a shell, the audit tail and your editor in one tmux session.\n\nAppearance follows the terminal: YAM_THEME=light|dark states it outright, and COLORFGBG is read when it does not — so the cockpit and Yam.app are on the same theme as the machine. YAM_COLOR=24bit|256|none says how much colour to send, and NO_COLOR is honoured.", options: [["--screen flows|run", "open on a screen"], ["--flow <file>", "open on a flow"], ["--run <id>", "open on a run"], ["--story <name>", "open on a story"], ["--url <url>", "attach to a service that is already running"], ["--token <t>", "that service's bearer token"], ["--tmux", "the workspace, in a tmux session named for the project"], ["--capture <ms>", "draw for that long, then quit; for scripts"], json], exits: [EXIT.ok, EXIT.usage] },
  { name: "runs tail", synopsis: "yam runs tail [--url <url> --token <t>]", description: "The current run's events as they happen, one line each, from a running service. The workspace's bottom-right pane runs this.", options: [["--url <url>", "the service"], ["--token <t>", "its bearer token"]], exits: [EXIT.ok, EXIT.usage] },
  { name: "workspace", synopsis: "yam workspace [dir]", description: "The same as yam ui --tmux.", exits: [EXIT.ok, EXIT.usage] },
  { name: "trust", synopsis: "yam trust [dir] [--revoke] [--status] [--list] [--json]", description: "Let this project's own code run on this machine: the files under its steps directory, a playwright.config at its root, and a program its config launches. A project nobody has trusted loads without its custom steps and says so, and a run that would start its code is refused. yam init trusts the project it makes; the desktop asks when it opens one; CI=true (or 1) and YAM_TRUST_PROJECT=1 trust without asking.", options: [["--revoke", "stop trusting it"], ["--status", "say whether its code runs here, and why; exit 1 when it does not"], ["--list", "every trusted directory"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "serve", synopsis: "yam serve [dir] [--port 0] [--token <t>]", description: "The local service on 127.0.0.1, behind a bearer token printed once on stdout. Yam.app, the cockpit and the SDK talk to it; every handler calls the same functions the command line calls.", options: [["--port <n>", "the port (default: one the system chooses)"], ["--token <t>", "the bearer token (default: generated)"]], exits: [EXIT.ok] },
  { name: "status", synopsis: "yam status [dir] [--json]     (the same as yam with nothing after it)", description: "Where you are and what is next: the flows, the plan, the unbound targets, the last run, and the one verb to run now. This is what yam alone prints.", options: [json], exits: [EXIT.ok] },
  { name: "doctor", synopsis: "yam doctor [dir] [--json]", description: "Check the host and the project: Node, the adapters, the config, the flows, the bindings, the data.", options: [json], exits: [EXIT.ok, EXIT.failed] },
  { name: "repl", synopsis: "yam repl [dir] [--adapter <name>] [--headless] [--gateway anthropic|fake|none] [--tier2] [--tier3] [--out <flows>] [--name <flow name>] [--json]", description: "Type sentences and watch them run against a live session; save what worked as a flow.", options: [["--adapter <name>", "which adapter opens the session"], ["--headless", "no browser window"], ["--gateway anthropic|fake|none", "who grounds a phrase"], ["--tier2", "the local model for refused sentences"], ["--tier3", "the frontier model"], ["--out <flows>", "where a saved flow goes"], ["--name <flow name>", "the saved flow's name"], json], session: true, exits: [EXIT.ok, EXIT.usage] },
  { name: "migrate", synopsis: "yam migrate <src> <dest> [--keep-original] [--json]  ·  yam migrate <dest> --from-prototype <db dir> [--project <name>]", description: "Bring v1 and v2 flows, or a prototype database, into a v3 project.", options: [["--keep-original", "leave the source files beside the migrated ones"], ["--from-prototype <dir>", "import the prototype's database instead of flow files"], ["--project <name>", "the imported project's name"], json], exits: [EXIT.ok, EXIT.unmapped] },
  { name: "host generate", synopsis: "yam host generate [dir] [--out .yam/specs]", description: "Write one Playwright Test spec per flow, for a project that runs under Playwright Test directly.", options: [["--out <dir>", "where the specs go"]], exits: [EXIT.ok] },
  { name: "workflow run", synopsis: "yam workflow run <story> [dir] [--input k=v] [--allow-side-effects] [--resume <runId> --from <stepId>] [--json]", description: "Run one story as a function: typed inputs in, outputs on stdout as JSON. Checkpoints and audit are always on; a story not marked idempotent is refused against production.", options: [["--allow-side-effects", "run a story that is not marked idempotent against production"], ["--resume <runId> --from <stepId>", "pick the run up at a checkpoint"], json], session: true, exits: [EXIT.ok, EXIT.failed, EXIT.healed, EXIT.refused, EXIT.aborted, EXIT.hashMismatch] },
  { name: "tool serve", synopsis: "yam tool serve [dir] [--expose \"Story one,Story two\"] [--stdio] [--allow-side-effects] [--json]", description: "An MCP server whose tools are the stories: each tool's schema comes from the story's signature, each call is an audited run.", options: [["--expose <stories>", "which stories to expose, comma separated"], ["--stdio", "serve over stdio"], ["--allow-side-effects", "list stories that are not marked idempotent, even in production"], json], session: true, exits: [EXIT.ok] },
  { name: "trajectory compile", synopsis: "yam trajectory compile <trajectory.jsonl> [dir] [--name \"Story name\"] [--out proposals] [--app proposed] [--json]", description: "Turn an agent's exploration into a proposal: a flow draft, a plan fragment and unverified bindings under proposals/, for a person to read.", options: [["--name <story>", "the proposed story's name"], ["--out <dir>", "where the proposal goes (default: proposals/)"], ["--app <name>", "the app name the bindings are filed under"], json], exits: [EXIT.ok, EXIT.usage] },
  { name: "bindings list", synopsis: "yam bindings list [--dir <bindings>] [--json]", description: "Every binding in the store, with its phrases.", options: [["--dir <bindings>", "the store (default: bindings/)"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "bindings show", synopsis: "yam bindings show <id> [--dir <bindings>] [--json]", description: "One binding: its candidates, its fingerprint, its provenance.", options: [["--dir <bindings>", "the store (default: bindings/)"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "bindings verify", synopsis: "yam bindings verify [--adapter <name>] [--id <id>] [--json]", description: "Resolve every binding against the live application without acting, and report which still find exactly one element.", options: [["--adapter <name>", "which adapter opens the session"], ["--id <id>", "only this binding; repeatable"], json], session: true, exits: [EXIT.ok, EXIT.failed] },
  { name: "bindings prune", synopsis: "yam bindings prune [--used-in <dirs>] [--apply] [--json]", description: "Find bindings no flow or test names any more; --apply removes them.", options: [["--used-in <dirs>", "where to look for uses"], ["--apply", "delete what nothing uses"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface targets", synopsis: "yam surface targets [--url <url>] [--adapter <name>] [--json]", description: "Discover available targets and adapter readiness on this machine.", options: [["--url <url>", "filter targets that can drive this URL"], ["--adapter <name>", "filter to a specific adapter"], json], exits: [EXIT.ok] },
  { name: "surface connect", synopsis: "yam surface connect [--url <url> | --app <name> | --attach <endpoint>] [--adapter <name>] [--headed] [--json]", description: "Connect to a target and open a surface session. Prints the session ID on stdout. Name one target: a URL launches a browser, --attach joins one that is already running, --app drives an application that is already running.", options: [["--url <url>", "the URL to connect to; launches a browser"], ["--app <name>", "an application that is already running, by process name"], ["--attach <endpoint>", "a browser that is already running, by its DevTools endpoint"], ["--adapter <name>", "which adapter to use (default: playwright)"], ["--headed", "show the browser"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface describe", synopsis: "yam surface describe --session <id> --ref <ref> [--json]", description: "Everything the surface knows about one element: its role, name, attributes, text and box.", options: [["--session <id>", "the session"], ["--ref <ref>", "the element, from a snapshot"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface capabilities", synopsis: "yam surface capabilities --session <id> [--json]", description: "What this target supports: which actions, which reads, which checks, and why anything is unavailable.", options: [["--session <id>", "the session"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface events", synopsis: "yam surface events --session <id> [--json]", description: "What this session did: its redacted events, and the steps a proposal would compile from. This is what `Save as automation` promotes.", options: [["--session <id>", "the session"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface control", synopsis: "yam surface control --session <id> [--take] [--release] [--holder <name>] [--force] [--json]", description: "Take a target, give it up, or ask who holds it. A person and an agent can drive the same session; this is how they hand over instead of racing each other. While a target is held, an action from anyone else is refused and told who has it.", options: [["--session <id>", "the session"], ["--take", "take control"], ["--release", "give it up"], ["--holder <name>", "who you are"], ["--force", "take a target its holder has not given up"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface request", synopsis: "yam surface request --session <id> --url <url> [--method GET] [--input <file.json>] [--json]", description: "Send an HTTP request on an HTTP surface and return the response. An HTTP target has no elements to click; this is how one is driven.", options: [["--session <id>", "the session"], ["--url <url>", "the URL, or a path joined to the session's base URL"], ["--method <verb>", "GET by default"], ["--input <file.json>", "the whole request — headers, body, auth — or `-` for stdin"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface screenshot", synopsis: "yam surface screenshot --session <id> [--path <file.png>] [--json]", description: "A picture of the target, when the adapter can take one.", options: [["--session <id>", "the session"], ["--path <file.png>", "where to write it"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface snapshot", synopsis: "yam surface snapshot --session <id> [--root <ref>] [--max-nodes <n>] [--interactive-only] [--json]", description: "Take a semantic snapshot of the current surface state.", options: [["--session <id>", "the session to snapshot"], ["--root <ref>", "subtree root ref"], ["--max-nodes <n>", "max nodes to return"], ["--interactive-only", "only interactive elements"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface act", synopsis: "yam surface act --session <id> --action <name> [--ref <ref>] [--ref2 <ref>] [--input <args.json>] [--json]", description: "Perform an action on the surface.", options: [["--session <id>", "the session"], ["--action <name>", "the action to perform (click, type, etc.)"], ["--ref <ref>", "the element reference"], ["--ref2 <ref>", "second reference (for dragTo)"], ["--input <args.json>", "action arguments as a JSON file or - for stdin"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface read", synopsis: "yam surface read --session <id> --kind <kind> [--ref <ref>] [--name <attr>] [--json]", description: "Read a value from the surface: text, value, attribute, title, url, or result.", options: [["--session <id>", "the session"], ["--kind <kind>", "what to read: text, value, attribute, title, url, result"], ["--ref <ref>", "the element reference"], ["--name <attr>", "the attribute name (when kind=attribute)"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface check", synopsis: "yam surface check --session <id> --input <check.json> [--ref <ref>] [--json]", description: "Check a predicate against the surface.", options: [["--session <id>", "the session"], ["--input <check.json>", "the check predicate as a JSON file or - for stdin"], ["--ref <ref>", "the element reference"], json], exits: [EXIT.ok, 20, EXIT.failed] },
  { name: "surface close", synopsis: "yam surface close --session <id> [--json]", description: "Close a surface session.", options: [["--session <id>", "the session to close"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface sessions", synopsis: "yam surface sessions [--json]", description: "List active surface sessions.", options: [json], exits: [EXIT.ok] },
  { name: "surface conform", synopsis: "yam surface conform --adapter <name> [--only <ids>] [--report <path.md>] [--json]", description: "Run the conformance suite against an adapter; exit 0 is conformant.", options: [["--adapter <name>", "the adapter under test"], ["--only <ids>", "a subset of cases"], ["--report <path.md>", "write the report"], json], session: true, exits: [EXIT.ok, EXIT.failed] },
  { name: "surface doctor", synopsis: "yam surface doctor [--adapter <name>] [--json]", description: "Whether this host can reach each adapter: the browser, the pty, the server, the permission, the session, screen recording.", options: [["--adapter <name>", "one of playwright, bidi, ax, uia, atspi, process, http, appium"], json], exits: [EXIT.ok, EXIT.failed] },
  { name: "surface grant", synopsis: "yam surface grant [--dry-run] [--json]", description: "Ask macOS for Accessibility and Screen Recording, naming the program they attach to.", options: [["--dry-run", "report what would be asked, and ask nothing"], json], exits: [EXIT.ok, EXIT.failed] },
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
  ["surface", "live control: targets, connect, snapshot, describe, capabilities, act, read, check, control, events, request, screenshot, close, sessions, conform, doctor, grant"],
  ["trajectory", "an agent's exploration: compile"],
  ["host", "Playwright Test specs: generate"],
  ["runs", "runs as they happen: tail"],
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

/* ────────────────────────────────────────────────────────────────────────────
 * Shell completion, from the table above (TV-C01, TV-17).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A completion script, generated from `COMMANDS`.
 *
 * The third reader of the one table a person can see — after `yam help` and
 * `yam help <command>` — so a command that is documented can be completed and
 * one that is not cannot, by construction rather than by somebody remembering.
 *
 * Deliberately not generated from the dispatch. The repository's own doctrine
 * about the palette fixture applies here: a check that generated one source from
 * another would compare a thing with itself and pass whatever anyone called
 * anything. The dispatch and this table stay two sources with
 * `tools/repo-checks/test/action-parity.test.ts` between them.
 */
export function completionScript(shell: "bash" | "zsh" = "bash"): string {
  /*
   * `bindings list` is one command with two words. Completing the first word
   * with "bindings list" would offer a thing nobody can type in one go, so the
   * first word is the set of verbs and the second is that verb's subcommands.
   */
  const verbs = [...new Set(COMMANDS.map((one) => one.name.split(" ")[0]!))];
  const subcommands = new Map<string, string[]>();
  for (const one of COMMANDS) {
    const [verb, sub] = one.name.split(" ");
    if (sub === undefined) continue;
    subcommands.set(verb!, [...(subcommands.get(verb!) ?? []), sub]);
  }
  const names = verbs.join(" ");
  const options = verbs
    .map((verb) => {
      const subs = subcommands.get(verb) ?? [];
      const flags = COMMANDS.filter((one) => one.name === verb).flatMap((one) =>
        (one.options ?? []).map(([flag]) => flag.split(" ")[0]),
      );
      return `    ${verb}) opts="${[...subs, ...flags].join(" ")}" ;;`;
    })
    .join("\n");

  if (shell === "zsh") {
    return [
      "#compdef yam",
      "# Generated by `yam completion zsh` from the command table. Do not edit.",
      "_yam() {",
      `  local -a commands; commands=(${names})`,
      '  if (( CURRENT == 2 )); then compadd -- "${commands[@]}"; return; fi',
      "  local opts",
      '  case "${words[2]}" in',
      options,
      '    *) opts="" ;;',
      "  esac",
      '  compadd -- ${=opts}',
      "}",
      "_yam",
      "",
    ].join("\n");
  }
  return [
    "# Generated by `yam completion` from the command table. Do not edit.",
    "_yam() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    `  local commands="${names}"`,
    "  if [ \"$COMP_CWORD\" -eq 1 ]; then",
    '    COMPREPLY=( $(compgen -W "$commands" -- "$cur") ); return',
    "  fi",
    "  local opts",
    '  case "${COMP_WORDS[1]}" in',
    options,
    '    *) opts="" ;;',
    "  esac",
    '  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )',
    "}",
    "complete -F _yam yam",
    "",
  ].join("\n");
}
