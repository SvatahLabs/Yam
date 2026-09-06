/**
 * `yam init` (REQ-AGT-1, LLD §15).
 *
 * Writes the directories and the config a project needs, and one flow that
 * explains the shape of a flow by being one. It refuses to overwrite: `init` in
 * an existing project is almost always a mistake, and the one time it is not,
 * `--force` says so.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boolOption, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { EXIT, type ExitCode } from "@svatah/yam-bindings-cli";
import type { CommandIo } from "@svatah/yam-bindings-cli";

const CONFIG = `# Yam project configuration (LLD §3.5).
schemaVersion: "1.0.0"
project: "PROJECT"
environment: test
adapter: playwright

app:
  baseUrl: "http://localhost:4173"

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
// The target phrases below have no bindings yet, so the first run records them
// (\`yam record\`, or \`YAM_MODE=record\` in a Playwright test). After that
// the same flow replays with no model in the loop.

story: Sign in
  Open "/login"
  Type {data.user.email} into the username field
  Type {data.user.password} into the password field
  Click the sign in button
  The page title should contain "Dashboard"

test: Sign in
`;

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

  const files: Array<[string, string]> = [
    ["yam.config.yaml", CONFIG.replace("PROJECT", root === "." ? "my-project" : root)],
    [join("flows", "sign-in.flow"), EXAMPLE_FLOW],
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
  for (const [name, contents] of files) {
    if (name === ".gitignore" && existsSync(join(root, name))) continue;
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents, "utf8");
  }

  const where = root === "." ? "this directory" : root;
  io.err(
    `Initialised ${where}.\n\n` +
      "  yam check     read, lint and compile the flows\n" +
      "  yam record    bind the targets by driving the real application\n" +
      "  yam run       replay the plan\n\n" +
      "  yam           at any time: where you are, and what is next\n",
  );
  return EXIT.ok;
}
