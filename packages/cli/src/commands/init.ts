/**
 * `svatah init` (REQ-AGT-1, LLD §15).
 *
 * Writes the directories and the config a project needs, and one flow that
 * explains the shape of a flow by being one. It refuses to overwrite: `init` in
 * an existing project is almost always a mistake, and the one time it is not,
 * `--force` says so.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boolOption, type ParsedArgs } from "../args.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import type { CommandIo } from "./surface.js";

const CONFIG = `# Svatah project configuration (LLD §3.5).
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

heal:
  onFail: false
  relocalizeThreshold: 0.72
  margin: 0.1
  useModel: false
`;

const EXAMPLE_FLOW = `// A flow is prose. One sentence per step, no locators, no sigils.
//
// The target phrases below have no bindings yet, so the first run records them
// (\`svatah record\`, or \`SVATAH_MODE=record\` in a Playwright test). After that
// the same flow replays with no model in the loop.

story: Sign in
  Open "/login"
  Type {data.user.email} into the username field
  Type {data.user.password} into the password field
  Click the sign in button
  The dashboard heading should be visible

test: Sign in
`;

const DATA = `# Run-level data (REQ-LANG-9).
#
# A value under \`secrets:\` is read from the named environment variable at run
# time and is redacted everywhere — audit, results, traces and screenshots.

user:
  email: "someone@example.com"
  password: "\${SVATAH_PASSWORD}"

secrets:
  - user.password
`;

export async function initCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const force = boolOption(args, "force");

  const files: Array<[string, string]> = [
    ["svatah.config.yaml", CONFIG.replace("PROJECT", root === "." ? "my-project" : root)],
    [join("flows", "sign-in.flow"), EXAMPLE_FLOW],
    ["data.yaml", DATA],
  ];

  const existing = files.map(([name]) => name).filter((name) => existsSync(join(root, name)));
  if (existing.length > 0 && !force) {
    io.err(
      `${existing.join(", ")} already exist(s). \`svatah init\` in a project that has one is ` +
        "almost always a mistake; pass --force if it is not.",
    );
    return EXIT.usage;
  }

  for (const dir of ["flows", "steps", "bindings", "api", "runs"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const [name, contents] of files) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), contents, "utf8");
  }

  io.err(
    `Initialised ${root}.\n\n` +
      "  svatah lint      check the flow reads and compiles\n" +
      "  svatah compile   write .svatah/plan.json\n" +
      "  svatah run       replay it\n",
  );
  return EXIT.ok;
}
