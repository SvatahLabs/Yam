/**
 * T4.6's Validate — "MCP client integration test drives `compile`, `run`, and a
 * six-call surface exploration that yields a well-formed trajectory file"
 * (REQ-AGT-2, REQ-BEH-4, LLD §15, §13.4).
 *
 * Driven by a real MCP client over a real transport, against a real browser and
 * the sample application. What that establishes and a unit test could not: an
 * external agent, speaking only the protocol, can compile a project, replay it,
 * and explore the application through the surface — and the exploration comes
 * out as a file the trajectory compiler will be able to read (T5.5).
 *
 * The transport is the SDK's in-memory pair rather than stdio. Both are real
 * transports; the in-memory one just does not require a second process, and
 * spawning one would make the test measure stdio framing rather than the tools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startSampleApp, type SampleServer } from "sample-web";
import { checkTrajectory, readTrajectory } from "@svatah/yam-trajectory";
import { buildMcpServer } from "../src/commands/mcp.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");

let app: SampleServer;
const projects: string[] = [];

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-mcp-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api"]) {
    cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  }
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));
  // The application is on an ephemeral port, so the config has to name it: the
  // fixture's own `baseUrl` is the one a developer runs against by hand.
  writeFileSync(
    join(dir, "yam.config.yaml"),
    readFileSync(join(FIXTURES, "yam.config.yaml"), "utf8").replace(
      /baseUrl: ".*"/,
      `baseUrl: "${app.origin}"`,
    ),
    "utf8",
  );
  return dir;
}

/** A client connected to a server over the SDK's in-memory transport pair. */
async function connect(root: string, trajectoryPath: string) {
  const built = await buildMcpServer({
    root,
    trajectoryPath,
    sessionId: "test",
    io: { out: () => undefined, err: () => undefined },
  });
  const client = new Client({ name: "test-agent", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([built.server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    built,
    close: async () => {
      await client.close().catch(() => undefined);
      await built.close();
    },
  };
}

/** The text a tool answered with, parsed when it is JSON. */
function answer(result: unknown): unknown {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const first = content.find((one) => one.type === "text")?.text ?? "";
  try {
    return JSON.parse(first);
  } catch {
    return first;
  }
}

beforeAll(async () => {
  app = await startSampleApp(0);
}, 180_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("the tools an agent is offered (REQ-AGT-2, LLD §15)", () => {
  /**
   * The list, exactly, and the same list `docs/mcp.md` publishes.
   *
   * This was `toContain` per name, which is a subset check: it passed while the
   * module's own comment claimed `record` and `heal` among the operation tools
   * and neither was ever registered, and it would have passed had a tool been
   * added and documented nowhere. What an agent is offered is the contract
   * (REQ-AGT-2), so it is asserted as a whole and against the page a person
   * reads.
   */
  const PUBLISHED = [
    "surface_act",
    "surface_check",
    "surface_read",
    "surface_snapshot",
    "surface_trajectory",
    "yam_bindings",
    "yam_compile",
    "yam_lint",
    "yam_results",
    "yam_run",
  ];

  it("publishes exactly the operation tools and the raw surface tools", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const { tools } = await session.client.listTools();
      expect(tools.map((one) => one.name).sort()).toEqual(PUBLISHED);
    } finally {
      await session.close();
    }
  }, 180_000);

  it("offers what docs/mcp.md says it offers, and nothing else", () => {
    const page = readFileSync(join(ROOT, "docs", "mcp.md"), "utf8");
    // The tool tables' first column: `| `name` | … |`.
    const documented = [...page.matchAll(/^\| `((?:yam|surface)_[a-z_]+)` \|/gm)]
      .map((one) => one[1]!)
      .sort();
    expect(documented).toEqual(PUBLISHED);
    // And the verbs that are deliberately absent stay absent from the tables.
    expect(documented).not.toContain("yam_record");
    expect(documented).not.toContain("yam_heal");
  });

  it("requires an intent on every raw surface tool (LLD §13.4)", async () => {
    /*
     * The property the whole trajectory idea rests on. A surface tool whose
     * `intent` were optional would produce a log rather than something
     * compilable, because the intent *is* the sentence a step compiles from.
     */
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const { tools } = await session.client.listTools();
      for (const name of ["surface_snapshot", "surface_act", "surface_read", "surface_check"]) {
        const tool = tools.find((one) => one.name === name)!;
        const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        expect(schema.properties, name).toHaveProperty("intent");
        expect(schema.required, `${name} must require intent`).toContain("intent");
      }
    } finally {
      await session.close();
    }
  }, 180_000);
});

describe("an agent compiles and runs the project (T4.6's Validate)", () => {
  it("compiles it, and gets the same plan the command line would", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const compiled = answer(
        await session.client.callTool({ name: "yam_compile", arguments: {} }),
      ) as { ok: boolean; hash: string; stories: Array<{ name: string; steps: unknown[] }> };

      expect(compiled.ok).toBe(true);
      expect(compiled.stories.length).toBeGreaterThan(0);

      // The same function the CLI calls, so the same hash. An agent and a person
      // compiling one project must not get two plans.
      const { compileProject, loadProject } = await import("../src/project.js");
      const direct = compileProject(await loadProject(project), { stable: true });
      expect(compiled.hash).toBe(direct.plan.hash);
    } finally {
      await session.close();
    }
  }, 180_000);

  it("runs it and reports every step's status", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const outcome = answer(
        await session.client.callTool({
          name: "yam_run",
          arguments: {
            flows: ["flows/natural_language_login.flow"],
            // The story declares a typed signature, so the run supplies them —
            // the same `--input` the command line takes (REQ-AUTO-5).
            inputs: { email: "connected2atul@gmail.com", password: "qwerty123" },
          },
        }),
      ) as {
        runId: string;
        totals: { passed: number; failed: number };
        steps: Array<{ status: string }>;
      };

      expect(outcome.steps.length).toBeGreaterThan(0);
      expect(outcome.totals.passed, JSON.stringify(outcome.steps, null, 1)).toBeGreaterThan(0);
      // A real run directory, the same one `yam run` writes.
      expect(existsSync(join(project, "runs", outcome.runId, "results.jsonl"))).toBe(true);
    } finally {
      await session.close();
    }
  }, 300_000);

  it("reads the bindings store and the results of a run", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const bindings = answer(
        await session.client.callTool({ name: "yam_bindings", arguments: {} }),
      ) as Array<{ id: string; phrases: string[] }>;
      expect(bindings.some((one) => one.id === "home.sign-in-button")).toBe(true);

      await session.client.callTool({
        name: "yam_run",
        arguments: {
          flows: ["flows/natural_language_login.flow"],
          inputs: { email: "connected2atul@gmail.com", password: "qwerty123" },
        },
      });
      const results = answer(
        await session.client.callTool({ name: "yam_results", arguments: {} }),
      ) as { runId: string; steps: unknown[] };
      expect(results.steps.length, JSON.stringify(results)).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  }, 300_000);
});

describe("a six-call surface exploration (T4.6's Validate, LLD §13.4)", () => {
  it("drives the application and writes a well-formed trajectory", async () => {
    const project = scaffold();
    const path = join(project, "runs", "explore", "trajectory.jsonl");
    const session = await connect(project, path);

    try {
      /*
       * What an agent exploring a sign-in actually does: look, act, look again.
       * Every call carries what it was trying to do, which is what the
       * trajectory compiler will turn into a sentence (LLD §13.4).
       */
      const snapshot = answer(
        await session.client.callTool({
          name: "surface_snapshot",
          arguments: { intent: "see what is on the home page", interactiveOnly: true },
        }),
      ) as { text: string; hash: string };
      expect(snapshot.text).toContain("[ref=");

      const signIn = /link "Sign in"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(snapshot.text)?.[1];
      expect(signIn, snapshot.text.slice(0, 400)).toBeDefined();

      await session.client.callTool({
        name: "surface_act",
        arguments: { intent: "go to the sign-in page", action: "click", ref: signIn },
      });

      const login = answer(
        await session.client.callTool({
          name: "surface_snapshot",
          arguments: { intent: "see the sign-in form", interactiveOnly: true },
        }),
      ) as { text: string };
      const username = /textbox "Username"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.text)?.[1];
      expect(username, login.text.slice(0, 400)).toBeDefined();

      await session.client.callTool({
        name: "surface_act",
        arguments: {
          intent: "type the enterprise user's email into the username field",
          action: "type",
          ref: username,
          args: { value: "connected2atul@gmail.com" },
        },
      });

      const read = answer(
        await session.client.callTool({
          name: "surface_read",
          arguments: { intent: "check what the username field now holds", kind: "value", ref: username },
        }),
      );
      expect(read).toBe("connected2atul@gmail.com");

      const check = answer(
        await session.client.callTool({
          name: "surface_check",
          arguments: {
            intent: "confirm the sign-in button is ready",
            predicate: { kind: "visible" },
            subject: "ref",
            ref: /button "Sign In"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.text)?.[1],
          },
        }),
      ) as { ok: boolean };
      expect(check.ok).toBe(true);

      /* ── the file that comes out ─────────────────────────────────────── */

      const lines = readTrajectory(path);
      expect(lines).toHaveLength(6);
      expect(checkTrajectory(lines), "the trajectory must be well formed").toEqual([]);

      expect(lines.map((one) => one.call)).toEqual([
        "snapshot",
        "act",
        "snapshot",
        "act",
        "read",
        "check",
      ]);
      expect(lines.map((one) => one.seq)).toEqual([1, 2, 3, 4, 5, 6]);

      // Every line says what the agent was doing, in words a sentence could be
      // made from — which is what T5.5 will do with it.
      expect(lines.map((one) => one.intent)).toEqual([
        "see what is on the home page",
        "go to the sign-in page",
        "see the sign-in form",
        "type the enterprise user's email into the username field",
        "check what the username field now holds",
        "confirm the sign-in button is ready",
      ]);

      /*
       * The description is captured at the time of the call, because a reference
       * is lost on navigation and an element described later is a different
       * element or none at all. Candidates and fingerprints are synthesised from
       * this, with no model (LLD §13.4).
       */
      const typed = lines[3]!;
      expect(typed.ref).toBe(username);
      expect(typed.describe?.role).toBe("textbox");
      expect(typed.describe?.name).toBe("Username");
      expect(typed.describe?.attrs["id"]).toBe("username");
      expect(typed.describe?.box).toHaveLength(4);

      // The page's structural hash, which is how the compiler will know a
      // navigation happened between two calls it cannot otherwise see.
      expect(lines[0]!.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(lines[2]!.snapshotHash).not.toBe(lines[0]!.snapshotHash);
    } finally {
      await session.close();
    }
  }, 300_000);

  it("records a call that failed, because that is what happened", async () => {
    // A trajectory is an account of an exploration, and an agent that drove the
    // application into a bad state has produced the most interesting one there
    // is. A capture that recorded only the successes would be a capture nobody
    // could debug from.
    const project = scaffold();
    const path = join(project, "runs", "failed", "trajectory.jsonl");
    const session = await connect(project, path);
    try {
      await session.client
        .callTool({
          name: "surface_act",
          arguments: { intent: "click something that is not there", action: "click", ref: "r9999" },
        })
        .catch(() => undefined);

      const lines = readTrajectory(path);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.error).toBeDefined();
      expect(lines[0]!.intent).toBe("click something that is not there");
    } finally {
      await session.close();
    }
  }, 180_000);

  it("says where the trajectory is, so an agent can point at it", async () => {
    const project = scaffold();
    const path = join(project, "runs", "where", "trajectory.jsonl");
    const session = await connect(project, path);
    try {
      await session.client.callTool({
        name: "surface_snapshot",
        arguments: { intent: "look at the page" },
      });
      const where = answer(
        await session.client.callTool({ name: "surface_trajectory", arguments: {} }),
      ) as { path: string; calls: number };
      expect(where.path).toBe(path);
      expect(where.calls).toBe(1);
    } finally {
      await session.close();
    }
  }, 180_000);
});
