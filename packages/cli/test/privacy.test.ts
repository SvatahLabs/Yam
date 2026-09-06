/**
 * Privacy mode (T4.7, REQ-NFR-3).
 *
 * > Privacy: Tier 3 can be disabled and Tier 2 local so no step text leaves the
 * > machine during compile; local-only recording is P2.
 *
 * The claim is about *bytes on a wire*, and the only honest way to test it is to
 * cut the wire. Every command below runs with `scripts/block-external-network.mjs`
 * loaded, which refuses every connection that is not to the machine itself
 * through all four doors Node has — `fetch`, `http`, `https`, `net` and `tls`.
 *
 * A command that passes under it has demonstrably reached for nothing beyond the
 * application under test. A command that reached for a model fails loudly, which
 * is the negative control the last test in this file exercises: a blocker that
 * blocked nothing would make every other assertion here worthless.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");
const BLOCKER = join(ROOT, "scripts", "block-external-network.mjs");

let app: SampleServer;
const projects: string[] = [];

/**
 * A copy of the fixture project, with its `compile:` section replaced when the
 * test needs a different one. Appending would leave two `compile:` keys, which
 * is a YAML error rather than an override.
 */
function scaffold(compileSection?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-privacy-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api"]) {
    cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  }
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));
  const base = readFileSync(join(FIXTURES, "yam.config.yaml"), "utf8").replace(
    /baseUrl: ".*"/,
    `baseUrl: "${app.origin}"`,
  );
  writeFileSync(
    join(dir, "yam.config.yaml"),
    compileSection === undefined
      ? base
      : // `compile:` and every indented or blank line under it, up to the next
        // top-level key.
        base.replace(/^compile:\n(?:[ \t].*\n|\n)*/m, `${compileSection.trim()}\n\n`),
    "utf8",
  );
  return dir;
}

/** Run the CLI with every non-loopback connection refused. */
function offline(
  args: readonly string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: {
        ...process.env,
        YAM_SAMPLE_PASSWORD: "qwerty123",
        YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
        YAM_SAMPLE_CARD_CVV: "123",
        NODE_OPTIONS: [process.env["NODE_OPTIONS"], `--import=${BLOCKER}`]
          .filter(Boolean)
          .join(" "),
        ...env,
      },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

beforeAll(async () => {
  if (!existsSync(YAM)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 180_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("compile reaches nothing at all (REQ-NFR-3)", () => {
  it("compiles the fixtures with every non-loopback connection refused", async () => {
    // The default, and the point: no step text leaves the machine because
    // nothing is sent anywhere. `--tier2` and `--tier3` are opt-in.
    const project = scaffold();
    const result = await offline(["compile", ".", "--stable", "--out", ".yam/plan.json"], project);
    expect(result.code, result.output).toBe(EXIT.ok);
    expect(existsSync(join(project, ".yam", "plan.json"))).toBe(true);
    expect(result.output).not.toContain("Blocked a");
  }, 180_000);

  it("lints with every non-loopback connection refused", async () => {
    const project = scaffold();
    const result = await offline(["lint", "."], project);
    expect(result.code, result.output).toBe(EXIT.ok);
  }, 180_000);

  it("produces the same plan offline as it does with a network", async () => {
    /*
     * The assertion that makes the first one mean something. A compile that
     * silently did less when it could not reach anything would also pass under
     * the blocker.
     */
    const project = scaffold();
    await offline(["compile", ".", "--stable", "--out", "offline.json"], project);
    await new Promise<void>((done) => {
      const child = spawn(
        process.execPath,
        [YAM, "compile", ".", "--stable", "--out", "online.json"],
        { cwd: project, env: process.env },
      );
      child.on("close", () => done());
    });
    expect(readFileSync(join(project, "offline.json"), "utf8")).toBe(
      readFileSync(join(project, "online.json"), "utf8"),
    );
  }, 180_000);
});

describe("run reaches nothing but the application (REQ-RUN-1, REQ-NFR-1)", () => {
  it("replays the fixtures with every non-loopback connection refused", async () => {
    /*
     * "The executor makes no model calls" and "replay has no network dependency
     * other than the target platform" are both structural — `runtime` cannot
     * import `gateway`, and the dependency-graph test says so. This is the same
     * claim as a thing a person can run.
     */
    const project = scaffold();
    const result = await offline(
      [
        "run",
        ".",
        "--host",
        "none",
        "--run-id",
        "offline",
        "--flow",
        "flows/natural_language_login.flow",
        "--input",
        "email=connected2atul@gmail.com",
        "--input",
        "password=qwerty123",
      ],
      project,
    );

    // The flow has one documented unsupported step, so the run fails — what
    // matters is *how*: no blocked connection, and every other step passed.
    expect(result.output).not.toContain("Blocked a");
    expect(result.output).toContain("4 passed");
    expect(existsSync(join(project, "runs", "offline", "results.jsonl"))).toBe(true);
  }, 300_000);

  it("runs both hosts under the blocker, through the compatibility milestone", () => {
    /*
     * `scripts/compatibility.mjs` is the thing that runs the four fixtures under
     * *both* hosts, four times, and it does every one of those runs with the
     * blocker loaded. Re-implementing that here would be a second, worse copy of
     * a check that already exists and already runs in CI — so what is asserted
     * is that it does, which is a property of the script and readable from it.
     */
    const script = readFileSync(join(ROOT, "scripts", "compatibility.mjs"), "utf8");
    expect(script).toContain("block-external-network.mjs");
    expect(script).toContain('"playwright"');
    expect(script).toMatch(/NODE_OPTIONS[\s\S]{0,120}BLOCK_NETWORK/);
  });
});

describe("Tier 2 reaches localhost and nothing else (REQ-NFR-3)", () => {
  it("is allowed through to a local model server", async () => {
    /*
     * The distinction privacy mode is *for*: `--tier2` names a server on
     * localhost, and the blocker lets loopback through. So a project can have a
     * model in its compiler and still make the claim that no step text left the
     * machine — which is exactly what REQ-NFR-3 asks for.
     *
     * There is no local model server in the contract, so what is checked is that
     * the attempt is *not blocked*: the failure, if any, is the server not being
     * there rather than the network being cut.
     */
    const project = scaffold(`
compile:
  confidenceThreshold: 0.8
  tier2:
    provider: ollama
    endpoint: "http://127.0.0.1:11434"
    model: "qwen2.5:3b"
`);
    writeFileSync(
      join(project, "flows", "paraphrase.flow"),
      "story: Loose\n  Tap the sign in button\n\ntest: Loose\n",
      "utf8",
    );
    const result = await offline(
      ["compile", ".", "--stable", "--tier2", "--flow", "flows/paraphrase.flow"],
      project,
    );
    expect(result.output).not.toContain("Blocked a fetch connection to 127.0.0.1");
    expect(result.output).not.toContain("Blocked a fetch connection to localhost");
  }, 180_000);

  it("refuses a Tier 2 endpoint that is not local", async () => {
    // A `compile.tier2` pointing at a hosted model is not privacy mode, whatever
    // it is called. The blocker is what says so, and the message names the host.
    const project = scaffold(`
compile:
  confidenceThreshold: 0.8
  tier2:
    provider: ollama
    endpoint: "https://models.example.com"
    model: "qwen2.5:3b"
`);
    writeFileSync(
      join(project, "flows", "paraphrase.flow"),
      "story: Loose\n  Tap the sign in button\n\ntest: Loose\n",
      "utf8",
    );
    const result = await offline(
      ["compile", ".", "--stable", "--tier2", "--flow", "flows/paraphrase.flow"],
      project,
    );
    expect(result.output).toContain("models.example.com");
  }, 180_000);
});

describe("the blocker itself", () => {
  it("refuses a connection that is not to this machine", async () => {
    /*
     * The negative control. Without it, every assertion above would also pass
     * against a blocker that blocked nothing — which is the failure mode a
     * privacy test is most likely to have and least likely to notice.
     */
    const project = scaffold();
    const result = await offline(["doctor", "."], project, {
      // `doctor` does not reach out, so the reach is made here, explicitly.
      NODE_OPTIONS: `--import=${BLOCKER} --import=data:text/javascript,${encodeURIComponent(
        'const r = await fetch("https://api.anthropic.com/v1/messages").catch((e) => e);' +
          'console.error(String(r && r.message));',
      )}`,
    });
    expect(result.output).toContain("Blocked a fetch connection to api.anthropic.com");
  }, 120_000);

  it("names the requirement, so a failure reads as a policy and not a bug", async () => {
    const source = readFileSync(BLOCKER, "utf8");
    expect(source).toContain("REQ-RUN-1");
    expect(source).toContain("REQ-NFR-1");
    // All four doors Node has; patching only the top would leave a socket open.
    for (const door of ["node:http", "node:https", "node:net", "node:tls"]) {
      expect(source, door).toContain(door);
    }
  });
});

describe("the documentation names what still needs a remote model (T4.7)", () => {
  const doc = readFileSync(join(ROOT, "docs", "privacy.md"), "utf8");

  it("says which commands reach a remote model and which do not", () => {
    expect(doc).toContain("## What reaches a remote model");
    for (const command of ["yam compile", "yam run", "yam record", "yam heal"]) {
      expect(doc, command).toContain(command);
    }
  });

  it("gives the command a reader can run to check the claim", () => {
    expect(doc).toContain("block-external-network.mjs");
    expect(doc).toContain("pnpm privacy:check");
  });

  it("says plainly what is still not local (REQ-NFR-3's own caveat)", () => {
    // "No step text leaves the machine during compile" holds; "no step text
    // ever leaves the machine" does not, because grounding has no local path
    // yet. A privacy page that did not say so would be the worst kind of wrong.
    expect(doc).toContain("Local-only recording is P2");
  });
});
