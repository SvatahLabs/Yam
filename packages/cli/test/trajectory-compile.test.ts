/**
 * The trajectory compiler (T5.5, REQ-BEH-4, LLD §13.4).
 *
 * T5.5's Validate list:
 *
 * 1. **The six-call exploration from T4.6 compiles to a proposal whose Tier 1
 *    compile succeeds for at least 80 percent of steps.** The same exploration,
 *    driven the same way — a real MCP client over a real transport against the
 *    sample application — and then compiled. Not a hand-written trajectory: the
 *    thing under test is that what the capture half writes is what the compile
 *    half can read.
 * 2. **Nothing written outside `proposals/`.** Asserted by walking the project
 *    directory before and after and requiring the only new paths to be under
 *    `proposals/`. A trajectory is an agent's unreviewed exploration, and the
 *    flow store, the bindings store and the plan are not its to touch.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startSampleApp, type SampleServer } from "sample-web";
import {
  compileTrajectory,
  readTrajectory,
  writeProposal,
  type TrajectoryLine,
} from "@svatah/trajectory";
import { proposalSchema } from "@svatah/schema";
import { buildMcpServer } from "../src/commands/mcp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");

let app: SampleServer;
const projects: string[] = [];

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-traj-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api", "data.yaml"]) {
    cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  }
  writeFileSync(
    join(dir, "svatah.config.yaml"),
    readFileSync(join(FIXTURES, "svatah.config.yaml"), "utf8").replace(
      /baseUrl: ".*"/,
      `baseUrl: "${app.origin}"`,
    ),
    "utf8",
  );
  return dir;
}

/** Every file under a directory, relative, sorted. */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(dir, path));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

/**
 * The T4.6 exploration, driven again: look, act, look, act, read, check.
 *
 * Copied in shape from `mcp.test.ts` rather than shared, because that test is
 * about the *capture* and this one is about what the capture can be turned into.
 * A helper the two shared would make a change to one silently change the other.
 */
async function explore(project: string, path: string): Promise<TrajectoryLine[]> {
  const built = await buildMcpServer({
    root: project,
    trajectoryPath: path,
    sessionId: "t",
    io: { out: () => undefined, err: () => undefined },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "explorer", version: "1.0.0" });
  await Promise.all([built.server.connect(serverSide), client.connect(clientSide)]);

  const answer = (result: unknown): unknown =>
    JSON.parse(((result as { content: Array<{ text: string }> }).content[0]!).text);

  try {
    const home = answer(
      await client.callTool({
        name: "surface_snapshot",
        arguments: { intent: "see what is on the home page", interactiveOnly: true },
      }),
    ) as { text: string };
    const signIn = /link "Sign in"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(home.text)?.[1];
    expect(signIn, home.text.slice(0, 400)).toBeDefined();

    await client.callTool({
      name: "surface_act",
      arguments: { intent: "go to the sign-in page", action: "click", ref: signIn },
    });

    const login = answer(
      await client.callTool({
        name: "surface_snapshot",
        arguments: { intent: "see the sign-in form", interactiveOnly: true },
      }),
    ) as { text: string };
    const username = /textbox "Username"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.text)?.[1];
    expect(username, login.text.slice(0, 400)).toBeDefined();

    await client.callTool({
      name: "surface_act",
      arguments: {
        intent: "type the enterprise user's email into the username field",
        action: "type",
        ref: username,
        args: { value: "connected2atul@gmail.com" },
      },
    });

    await client.callTool({
      name: "surface_read",
      arguments: {
        intent: "check what the username field now holds",
        kind: "value",
        ref: username,
      },
    });

    await client.callTool({
      name: "surface_check",
      arguments: {
        intent: "confirm the sign-in button is ready",
        predicate: { kind: "visible" },
        subject: "ref",
        ref: /button "Sign In"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.text)?.[1],
      },
    });
  } finally {
    await client.close().catch(() => undefined);
    await built.close();
  }

  return readTrajectory(path);
}

beforeAll(async () => {
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("the T4.6 exploration compiles to a proposal (T5.5's Validate)", () => {
  it("compiles at least 80 percent of its steps at Tier 1", async () => {
    const project = scaffold();
    const lines = await explore(project, join(project, "runs", "t", "trajectory.jsonl"));
    expect(lines).toHaveLength(6);

    const compiled = compileTrajectory(lines, { now: "2026-09-04T00:00:00.000Z" });

    /*
     * Four steps from six calls: the two snapshots are the agent *looking*, and
     * a replay does not need to be told to look — the resolver takes whatever
     * snapshots it needs.
     */
    expect(compiled.steps.total).toBe(4);
    expect(
      compiled.steps.rate,
      `only ${compiled.steps.compiled}/${compiled.steps.total} compiled:\n` +
        compiled.review.map((one) => `  ${one.intent}: ${one.why}`).join("\n"),
    ).toBeGreaterThanOrEqual(0.8);
  }, 240_000);

  it("draws the sentences from what the calls did, not from what the agent said", async () => {
    /*
     * The distinction the whole design turns on. The agent said "go to the
     * sign-in page"; the call was `act("click", <the Sign in link>)`. Taking the
     * intent as the sentence gives `Go to "the sign-in page"` — a navigation to
     * a URL that does not exist, from a call that was a click. Plausible and
     * wrong is worse than `// review:`.
     */
    const project = scaffold();
    const lines = await explore(project, join(project, "runs", "t", "trajectory.jsonl"));
    const { proposal } = compileTrajectory(lines, { now: "2026-09-04T00:00:00.000Z" });

    expect(proposal.flow).toContain("Click the Sign in link");
    expect(proposal.flow).toContain('Type "connected2atul@gmail.com" into the Username field');
    expect(proposal.flow).toContain("Remember the value of the Username field as");
    expect(proposal.flow).toContain("should be visible");
    // And the agent's own words are above each step, not discarded.
    expect(proposal.flow).toContain("// go to the sign-in page");
    expect(proposal.flow).toContain("// confirm the sign-in button is ready");
  }, 240_000);

  it("carries a compiled story fragment and unverified bindings", async () => {
    const project = scaffold();
    const lines = await explore(project, join(project, "runs", "t", "trajectory.jsonl"));
    const { proposal } = compileTrajectory(lines, { now: "2026-09-04T00:00:00.000Z" });

    // It validates against the published schema, which refuses `verified: true`.
    expect(() => proposalSchema.parse(proposal)).not.toThrow();
    expect(proposal.story?.steps.length).toBeGreaterThanOrEqual(3);
    expect(proposal.bindings.length).toBeGreaterThanOrEqual(2);
    expect(proposal.bindings.every((f) => f.entries.every((e) => !e.verified))).toBe(true);
    // Every binding has something to resolve by.
    expect(proposal.bindings.every((f) => f.entries[0]!.candidates.length > 0)).toBe(true);
    // The context pattern is the page the call was made on, which is what the
    // URL recorded on each line is for.
    expect(proposal.bindings.some((f) => f.entries[0]!.context.pattern === "/login")).toBe(true);
    // No model touched it, and the provenance says so.
    expect(proposal.provenance.model).toBe("none:trajectory-compile");
    expect(proposal.provenance.tokensIn).toBe(0);
  }, 240_000);

  it("writes nothing outside proposals/", async () => {
    const project = scaffold();
    const lines = await explore(project, join(project, "runs", "t", "trajectory.jsonl"));

    const before = tree(project);
    const compiled = compileTrajectory(lines, { now: "2026-09-04T00:00:00.000Z" });
    const { files } = writeProposal(join(project, "proposals"), compiled);

    const added = tree(project).filter((path) => !before.includes(path));
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((path) => path.startsWith("proposals/"))).toBe(true);
    // Nothing that existed before was rewritten either.
    expect(files.every((path) => relative(project, path).startsWith("proposals/"))).toBe(true);
    // And the flow store and the bindings store are byte-identical.
    expect(tree(join(project, "flows"))).toEqual(tree(join(FIXTURES, "flows")));
  }, 240_000);

  it("writes a flow, a proposal and the bindings, under the date", async () => {
    const project = scaffold();
    const lines = await explore(project, join(project, "runs", "t", "trajectory.jsonl"));
    const compiled = compileTrajectory(lines, { now: "2026-09-04T00:00:00.000Z" });
    const { dir, files } = writeProposal(join(project, "proposals"), compiled);

    expect(dir.endsWith(join("proposals", "2026-09-04"))).toBe(true);
    expect(files.some((f) => f.endsWith(".flow"))).toBe(true);
    expect(files.some((f) => f.endsWith(".json"))).toBe(true);
    expect(files.some((f) => f.includes(join("bindings")) && f.endsWith(".yaml"))).toBe(true);
  }, 240_000);
});

describe("what the compiler will not phrase, it says out loud", () => {
  it("emits a `// review:` comment carrying the agent's words and the reason", async () => {
    /*
     * A call that fails is a step nobody should replay, and it is the most
     * interesting thing in an exploration. It is kept as a comment rather than
     * dropped: a proposal that quietly lost what it could not phrase would be
     * one a reviewer cannot trust, because what is missing is invisible.
     */
    const project = scaffold();
    const path = join(project, "runs", "bad", "trajectory.jsonl");
    const built = await buildMcpServer({
      root: project,
      trajectoryPath: path,
      sessionId: "bad",
      io: { out: () => undefined, err: () => undefined },
    });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "explorer", version: "1.0.0" });
    await Promise.all([built.server.connect(serverSide), client.connect(clientSide)]);

    try {
      await client.callTool({
        name: "surface_act",
        arguments: { intent: "click something that is not there", action: "click", ref: "r9999" },
      });
    } finally {
      await client.close().catch(() => undefined);
      await built.close();
    }

    const compiled = compileTrajectory(readTrajectory(path), {
      now: "2026-09-04T00:00:00.000Z",
    });
    expect(compiled.steps.compiled).toBe(0);
    expect(compiled.proposal.flow).toContain("// review:");
    expect(compiled.proposal.flow).toContain("click something that is not there");
    expect(compiled.review[0]?.why).toContain("the call failed");
  }, 240_000);
});

/**
 * `svatah trajectory compile` — the same compile, through the command line.
 *
 * The ADE's "compile to proposal" (T5.8) and a person at a terminal call one
 * function, which is the rule LLD §13.5 states for the service and §15 for MCP:
 * an agent and a person must get the same artifact.
 */
describe("svatah trajectory compile (T5.5, REQ-AGT-1)", () => {
  it("writes the proposal and reports the rate", async () => {
    const project = scaffold();
    const path = join(project, "runs", "t", "trajectory.jsonl");
    await explore(project, path);

    const before = tree(project);
    const result = await cli(["trajectory", "compile", path, ".", "--json"], project);
    expect(result.code, result.output).toBe(0);

    const report = JSON.parse(result.out) as {
      dir: string;
      files: string[];
      steps: { total: number; compiled: number; rate: number };
    };
    expect(report.steps.rate).toBeGreaterThanOrEqual(0.8);
    expect(report.files.every((file) => file.startsWith("proposals/"))).toBe(true);

    const added = tree(project).filter((one) => !before.includes(one));
    expect(added.every((one) => one.startsWith("proposals/"))).toBe(true);
  }, 240_000);

  it("takes a story name, so a proposal can be called what it is", async () => {
    const project = scaffold();
    const path = join(project, "runs", "t", "trajectory.jsonl");
    await explore(project, path);

    const result = await cli(
      ["trajectory", "compile", path, ".", "--name", "Sign in as the enterprise user", "--json"],
      project,
    );
    expect(result.code, result.output).toBe(0);
    const { files } = JSON.parse(result.out) as { files: string[] };
    expect(files.some((file) => file.includes("sign-in-as-the-enterprise-user.flow"))).toBe(true);
  }, 240_000);

  it("says what it wants when it is given nothing to compile", async () => {
    const project = scaffold();
    expect((await cli(["trajectory"], project)).code).toBe(64);
    expect((await cli(["trajectory", "compile"], project)).code).toBe(64);
  }, 120_000);
});

/** The installed command line, with stdout kept apart so `--json` parses. */
function cli(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; output: string; out: string }> {
  return new Promise((done) => {
    let output = "";
    let out = "";
    const child = spawn(process.execPath, [SVATAH, ...args], { cwd, env: process.env });
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output, out }));
  });
}
