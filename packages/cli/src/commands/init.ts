/**
 * `yam init` (REQ-AGT-1, LLD §15).
 *
 * Writes the directories and the config a project needs, and one flow that
 * explains the shape of a flow by being one. It refuses to overwrite: `init` in
 * an existing project is almost always a mistake, and the one time it is not,
 * `--force` says so.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { boolOption, stringOption, stringOptions, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { EXIT, type ExitCode } from "@svatah/yam-bindings-cli";
import type { CommandIo } from "@svatah/yam-bindings-cli";
import { OLD_SCAFFOLD_MARKER } from "../scaffold.js";

const CONFIG = `# Yam project configuration.
schemaVersion: "1.0.0"
project: "PROJECT"
environment: test
adapter: ADAPTER

# The application under test. \`app\` is the local endpoint; every other
# endpoint is named under \`endpoints\` and selected with
# \`yam <command> --endpoint <name>\` or YAM_ENDPOINT=<name>.
app:
  baseUrl: "BASE_URL"BASE_URL_NOTE
ENDPOINTS

flows: { dir: flows }
steps: { dir: steps }
bindings:
  dir: bindings
  testIdAttributes: ["data-testid", "data-test", "data-qa"]
data: { file: data.yaml }
api: { dir: api }

run:
  workers: 4
  headless: true
  stepTimeoutMs: 10000
  candidateTimeoutMs: 2000
  screenshots: onFailure
  trace: false
  outputDir: runs
  checkpoints: false
  audit: true

compile:
  confidenceThreshold: 0.8

record:
  model: "none"
  maxSnapshotTokens: 4000
  visionFallback: false
  # How long a grounding waits for a review in the app before the session
  # gives up and writes its report (LLD §13.5). Ten minutes.
  decisionDeadlineMs: 600000

heal:
  onFail: false
  relocalizeThreshold: 0.72
  margin: 0.1
  useModel: false
`;

const EXAMPLE_FLOW = `// A flow is prose. One sentence per step, no locators, no sigils.
//
// This first story works against any application: it opens the front page and
// checks it is there. Replace it with what your application does. A target
// phrase — "the username field" — has no binding until \`yam record\` asks you
// to click it once; after that the flow replays with no model in the loop.

story: Open the front page
  Go to "/"
  The URL should contain "/"

// story: Sign in
//   Go to "/login"
//   Type {data.user.email} into the username field
//   Type {data.user.password} into the password field
//   Click the sign in button
//   The page title should contain "Dashboard"

test: Open the front page
`;

interface Endpoint {
  readonly name: string;
  readonly baseUrl: string;
  readonly environment: "test" | "staging" | "production";
}

/** `name=url` or `name=url@production`, as `--endpoint` takes it. */
export function parseEndpoint(text: string): Endpoint | undefined {
  const match = /^([A-Za-z0-9_-]+)=(\S+?)(?:@(test|staging|production))?$/.exec(text.trim());
  if (match === null) return undefined;
  return { name: match[1]!, baseUrl: match[2]!, environment: (match[3] as Endpoint["environment"] | undefined) ?? "test" };
}

interface Answers {
  readonly name: string;
  readonly adapter: string;
  readonly baseUrl?: string;
  readonly endpoints: readonly Endpoint[];
}

const KINDS: readonly Endpoint["environment"][] = ["test", "staging", "production"];

/**
 * Ask a person at a terminal; take the flags when there is none (REQ-CLI-11).
 *
 * The questions are the project's: what it is called, which adapter drives it,
 * where it runs locally, and where else it runs. Nothing defaults to Yam's own
 * sample application — a project that silently pointed at port 4173 recorded
 * flows against the wrong application and told no one, which is how this
 * command came to ask.
 */
async function answers(root: string, args: ParsedArgs, io: CommandIo): Promise<Answers> {
  const fallbackName = basename(resolve(root));
  const fromFlags: Answers = {
    name: stringOption(args, "name") ?? fallbackName,
    adapter: stringOption(args, "adapter") ?? "playwright",
    ...(stringOption(args, "url") === undefined ? {} : { baseUrl: stringOption(args, "url")! }),
    endpoints: stringOptions(args, "endpoint").map((one) => {
      const parsed = parseEndpoint(one);
      if (parsed === undefined) throw new Error(`--endpoint takes name=url or name=url@production, not "${one}".`);
      return parsed;
    }),
  };
  const interactive =
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true &&
    !boolOption(args, "yes") &&
    stringOption(args, "url") === undefined;
  if (!interactive) return fromFlags;

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = async (question: string, fallback?: string): Promise<string> => {
    const reply = (await rl.question(fallback === undefined || fallback === "" ? `${question} ` : `${question} [${fallback}] `)).trim();
    return reply === "" ? (fallback ?? "") : reply;
  };
  try {
    io.err("Setting up a Yam project. Enter accepts the value in brackets.\n");
    const name = await ask("Project name", fromFlags.name);
    const adapter = await ask("Adapter (playwright, bidi, http, appium, uia, ax)", fromFlags.adapter);
    let baseUrl = "";
    while (baseUrl === "") {
      baseUrl = await ask("Where does the application run locally? e.g. http://localhost:3000");
      if (baseUrl === "") io.err('  A base URL is needed; every flow\'s Go to "/" is relative to it.');
    }
    const endpoints: Endpoint[] = [...fromFlags.endpoints];
    for (;;) {
      const more = (
        await ask(endpoints.length === 0 ? "Add a remote endpoint (staging, production…)? (y/N)" : "Add another endpoint? (y/N)", "N")
      ).toLowerCase();
      if (!more.startsWith("y")) break;
      const endpointName = await ask("  Endpoint name", endpoints.length === 0 ? "staging" : "");
      const url = await ask("  Its base URL");
      const kind = await ask("  Its kind (test, staging, production)", endpointName === "production" ? "production" : "staging");
      if (endpointName === "" || url === "") {
        io.err("  Skipped: an endpoint needs a name and a URL.");
        continue;
      }
      endpoints.push({
        name: endpointName,
        baseUrl: url,
        environment: (KINDS as readonly string[]).includes(kind) ? (kind as Endpoint["environment"]) : "staging",
      });
    }
    return { name, adapter, baseUrl, endpoints };
  } finally {
    rl.close();
  }
}

/** The config text for the answers. */
export function renderConfig(a: Answers): string {
  const endpoints =
    a.endpoints.length === 0
      ? "# endpoints:\n#   staging: { baseUrl: \"https://staging.example.com\", environment: staging }\n#   production: { baseUrl: \"https://example.com\", environment: production }"
      : "endpoints:\n" +
        a.endpoints.map((one) => `  ${one.name}: { baseUrl: "${one.baseUrl}", environment: ${one.environment} }`).join("\n");
  return CONFIG.replace("PROJECT", a.name)
    .replace("ADAPTER", a.adapter)
    .replace("BASE_URL", a.baseUrl ?? "http://localhost:3000")
    .replace("BASE_URL_NOTE", a.baseUrl === undefined ? "   # ← set this to where your application runs" : "")
    .replace("ENDPOINTS", endpoints);
}

/**
 * What a project must not commit (LLD §16, Draft 2.5).
 *
 * "Run artifacts are committed only under `evals/conformance/` and `reports/`.
 * Every project directory ignores `runs/`, `.yam/`, and any absolute-path
 * echo such as `var/`."
 *
 * `var/` is not a directory Yam writes on purpose. It is what an absolute
 * `--out` leaves behind when something joins it onto the project root instead
 * of resolving it — which is exactly how fourteen run artifacts came to be
 * committed under `evals/fixtures/var/folders/…` in Phase 2 and stayed there
 * until the Phase 3 verification found them. A bug like that should show up as
 * an untracked directory nobody commits, not as a diff nobody reads.
 */
const GITIGNORE = `# Run output. Results, screenshots and traces are artifacts of a run, not of
# the project: they are reproduced by re-running and never reviewed as a diff.
runs/
.yam/

# The shape an absolute --out leaves behind when it is joined onto the project
# root rather than resolved (LLD §16).
var/
private/

# Playwright's own output, when a flow runs under the Playwright Test host.
test-results/
playwright-report/
`;

const DATA = `# Run-level data (REQ-LANG-9).
#
# A value under \`secrets:\` is read from the named environment variable at run
# time and is redacted everywhere — audit, results, traces and screenshots.

user:
  email: "someone@example.com"
  password: "\${YAM_PASSWORD}"

secrets:
  - user.password
`;

export async function initCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const force = boolOption(args, "force");
  let a: Answers;
  try {
    a = await answers(root, args, io);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.usage;
  }

  const files: Array<[string, string]> = [
    ["yam.config.yaml", renderConfig(a)],
    [join("flows", "front-page.flow"), EXAMPLE_FLOW],
    ["data.yaml", DATA],
    [".gitignore", GITIGNORE],
  ];

  /*
   * A `.gitignore` that is already there is not a reason to refuse: `yam
   * init` inside an existing repository is a normal thing to do, and the file
   * is the repository's, not ours. It is written only when absent.
   */
  const existing = files
    .map(([name]) => name)
    .filter((name) => name !== ".gitignore" && existsSync(join(root, name)));
  if (existing.length > 0 && !force) {
    io.err(
      `${existing.join(", ")} already exist(s). \`yam init\` in a project that has one is ` +
        "almost always a mistake; pass --force if it is not.",
    );
    return EXIT.usage;
  }

  for (const dir of ["flows", "steps", "bindings", "api", "runs"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  /*
   * The example this command wrote before Draft 2.22 was a sign-in against a
   * `/login` route that most applications lack; `init --force` over such a
   * project replaced the config and left that flow to fail the next
   * `yam record`. An example is this command's to retire — a flow a person
   * edited carries no marker and is left alone.
   */
  const earlier = join(root, "flows", "sign-in.flow");
  const retired = existsSync(earlier) && readFileSync(earlier, "utf8").includes(OLD_SCAFFOLD_MARKER);
  if (retired) unlinkSync(earlier);
  for (const [name, contents] of files) {
    if (name === ".gitignore" && existsSync(join(root, name))) continue;
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents, "utf8");
  }

  const where = root === "." ? "this directory" : root;
  const note =
    a.baseUrl === undefined
      ? "  The config points at http://localhost:3000 for now: set app.baseUrl to where your application runs.\n\n"
      : `  Application: ${a.baseUrl}${a.endpoints.length === 0 ? "" : `; endpoints: ${a.endpoints.map((one) => one.name).join(", ")} (--endpoint <name>)`}\n\n`;
  io.err(
    `Initialised ${where} as "${a.name}".\n` +
      (retired ? "  Removed flows/sign-in.flow, the example an earlier init wrote.\n" : "") +
      note +
      "  yam check     read, lint and compile the flows\n" +
      "  yam record    bind the targets by driving the real application\n" +
      "  yam run       replay the plan\n\n" +
      "  yam           at any time: where you are, and what is next\n",
  );
  return EXIT.ok;
}
