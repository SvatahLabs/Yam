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
  const PUBLISHED = [
    "surface_act",
    "surface_capabilities",
    "surface_check",
    "surface_close",
    "surface_connect",
    "surface_describe",
    "surface_read",
    "surface_screenshot",
    "surface_sessions",
    "surface_snapshot",
    "surface_trajectory",
    "yam_bindings",
    "yam_compile",
    "yam_heal",
    "yam_lint",
    "yam_record",
    "yam_results",
    "yam_run",
  ];

  it("publishes exactly the operation tools and the surface tools", async () => {
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
    const documented = [...page.matchAll(/^\| `((?:yam|surface)_[a-z_]+)` \|/gm)]
      .map((one) => one[1]!)
      .sort();
    expect(documented).toEqual(PUBLISHED);
    expect(documented).not.toContain("yam_workflow");
    expect(documented).not.toContain("yam_tool");
  });

  it("intent is optional on surface tools (SF-12)", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const { tools } = await session.client.listTools();
      for (const name of ["surface_snapshot", "surface_act", "surface_read", "surface_check"]) {
        const tool = tools.find((one) => one.name === name)!;
        const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        expect(schema.properties, name).toHaveProperty("intent");
        expect(schema.required ?? [], `${name} must NOT require intent`).not.toContain("intent");
      }
    } finally {
      await session.close();
    }
  }, 180_000);

  it("surface tools require a session ID (except connect and sessions)", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const { tools } = await session.client.listTools();
      for (const name of ["surface_snapshot", "surface_act", "surface_read", "surface_check", "surface_close"]) {
        const tool = tools.find((one) => one.name === name)!;
        const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
        expect(schema.properties, name).toHaveProperty("session");
        expect(schema.required, `${name} must require session`).toContain("session");
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

describe("a surface exploration via session IDs (T11', LLD §13.4)", () => {
  it("drives the application through connect/snapshot/act/read/check/close", async () => {
    const project = scaffold();
    const path = join(project, "runs", "explore", "trajectory.jsonl");
    const session = await connect(project, path);

    try {
      const connected = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { url: app.origin, adapter: "playwright" },
        }),
      ) as { result: { sessionId: string } };
      const sid = connected.result.sessionId;
      expect(sid).toBeDefined();

      const snapshot = answer(
        await session.client.callTool({
          name: "surface_snapshot",
          arguments: { session: sid, intent: "see what is on the home page", interactiveOnly: true },
        }),
      ) as { result: { text: string; hash: string } };
      expect(snapshot.result.text).toContain("[ref=");

      const signIn = /link "Sign in"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(snapshot.result.text)?.[1];
      expect(signIn, snapshot.result.text.slice(0, 400)).toBeDefined();

      await session.client.callTool({
        name: "surface_act",
        arguments: { session: sid, intent: "go to the sign-in page", action: "click", ref: signIn },
      });

      const login = answer(
        await session.client.callTool({
          name: "surface_snapshot",
          arguments: { session: sid, intent: "see the sign-in form", interactiveOnly: true },
        }),
      ) as { result: { text: string } };
      const username = /textbox "Username"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.result.text)?.[1];
      expect(username, login.result.text.slice(0, 400)).toBeDefined();

      await session.client.callTool({
        name: "surface_act",
        arguments: {
          session: sid,
          intent: "type the enterprise user's email into the username field",
          action: "type",
          ref: username,
          args: { value: "connected2atul@gmail.com" },
        },
      });

      const readResult = answer(
        await session.client.callTool({
          name: "surface_read",
          arguments: { session: sid, intent: "check what the username field now holds", kind: "value", ref: username },
        }),
      ) as { result: { value: string } };
      expect(readResult.result.value).toBe("connected2atul@gmail.com");

      const checkResult = answer(
        await session.client.callTool({
          name: "surface_check",
          arguments: {
            session: sid,
            intent: "confirm the sign-in button is ready",
            predicate: { kind: "visible" },
            subject: "ref",
            ref: /button "Sign In"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.result.text)?.[1],
          },
        }),
      ) as { result: { ok: boolean } };
      expect(checkResult.result.ok).toBe(true);

      /* ── trajectory is written when intent is provided ──────────────── */

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

      expect(lines.map((one) => one.intent)).toEqual([
        "see what is on the home page",
        "go to the sign-in page",
        "see the sign-in form",
        "type the enterprise user's email into the username field",
        "check what the username field now holds",
        "confirm the sign-in button is ready",
      ]);

      await session.client.callTool({
        name: "surface_close",
        arguments: { session: sid },
      });
    } finally {
      await session.close();
    }
  }, 300_000);

  it("records a failed call to the trajectory", async () => {
    const project = scaffold();
    const path = join(project, "runs", "failed", "trajectory.jsonl");
    const session = await connect(project, path);
    try {
      const connected = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { url: app.origin, adapter: "playwright" },
        }),
      ) as { result: { sessionId: string } };
      const sid = connected.result.sessionId;

      await session.client.callTool({
        name: "surface_act",
        arguments: { session: sid, intent: "click something that is not there", action: "click", ref: "r9999" },
      });

      const lines = readTrajectory(path);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.error).toBeDefined();
      expect(lines[0]!.intent).toBe("click something that is not there");

      await session.client.callTool({ name: "surface_close", arguments: { session: sid } });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("calls without intent work but are not recorded to the trajectory", async () => {
    const project = scaffold();
    const path = join(project, "runs", "nointent", "trajectory.jsonl");
    const session = await connect(project, path);
    try {
      const connected = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { url: app.origin, adapter: "playwright" },
        }),
      ) as { result: { sessionId: string } };
      const sid = connected.result.sessionId;

      const snapshot = answer(
        await session.client.callTool({
          name: "surface_snapshot",
          arguments: { session: sid, interactiveOnly: true },
        }),
      ) as { result: { text: string } };
      expect(snapshot.result.text).toContain("[ref=");

      expect(existsSync(path)).toBe(false);

      await session.client.callTool({ name: "surface_close", arguments: { session: sid } });
    } finally {
      await session.close();
    }
  }, 180_000);

  it("says where the trajectory is, so an agent can point at it", async () => {
    const project = scaffold();
    const path = join(project, "runs", "where", "trajectory.jsonl");
    const session = await connect(project, path);
    try {
      const connected = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { url: app.origin, adapter: "playwright" },
        }),
      ) as { result: { sessionId: string } };
      const sid = connected.result.sessionId;

      await session.client.callTool({
        name: "surface_snapshot",
        arguments: { session: sid, intent: "look at the page" },
      });
      const where = answer(
        await session.client.callTool({ name: "surface_trajectory", arguments: {} }),
      ) as { path: string; calls: number };
      expect(where.path).toBe(path);
      expect(where.calls).toBe(1);

      await session.client.callTool({ name: "surface_close", arguments: { session: sid } });
    } finally {
      await session.close();
    }
  }, 180_000);
});

describe("an agent binds and repairs (REQ-AGT-2, Draft 2.24)", () => {
  /**
   * The two operation tools added when the comment that promised them was
   * found to be four phases old.
   *
   * Both go through the functions the local service calls, so what an agent
   * does here and what the app does through `POST /record` and `POST /heal`
   * are the same work. What is asserted is the part an agent depends on: the
   * report says which gateway decided, and healing writes nothing unless it
   * is told to.
   */
  it("binds a flow's targets through the fake gateway and says it was a fixture", async () => {
    const project = scaffold();
    /*
     * `the sign in button` is bound already — to the *home* page's link — so
     * this asks for it to be recorded again on the login page, which is what
     * `rebind` is for and what an agent would do when a page moved. Without it
     * the recorder would reuse the entry and the click would fail, which it
     * does report faithfully.
     */
    writeFileSync(
      join(project, "flows", "agent.flow"),
      'story: Agent binds\n  Go to "/login"\n  Click the sign in button\n\ntest: Agent binds\n',
      "utf8",
    );
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      const report = answer(
        await session.client.callTool({
          name: "yam_record",
          arguments: { flows: ["flows/agent.flow"], gateway: "fake", rebind: true },
        }),
      ) as {
        gateway: { name: string; real: boolean };
        complete: boolean;
        totals: Record<string, number>;
        steps: Array<{ status: string }>;
      };

      // REQ-PKG-4: a report says what decided, and the fixture says it is one.
      expect(report.gateway.name).toMatch(/^fake/);
      expect(report.gateway.real).toBe(false);
      expect(report.complete).toBe(true);
      expect(report.steps.every((one) => one.status === "passed")).toBe(true);
      expect(report.totals["failed"]).toBe(0);
      // A binding is written only after the step performed through it, so what
      // is listed here is what worked (REQ-REC-5).
      expect(report.totals["grounded"]).toBeGreaterThan(0);
      expect(report.written).toContain("home.sign-in-button");
    } finally {
      await session.close();
    }
  }, 180_000);

  it("proposes repairs without writing, and writes only when told", async () => {
    const project = scaffold();
    const session = await connect(project, join(project, "runs", "t", "trajectory.jsonl"));
    try {
      // Break one binding's candidates so a run fails to find it.
      const file = join(project, "bindings", "home", "sign-in-button.yaml");
      const original = readFileSync(file, "utf8");
      writeFileSync(file, original.replace(/"sign-in"/g, '"gone-away"').replace(/'sign-in'/g, "'gone-away'"), "utf8");

      const run = answer(
        await session.client.callTool({
          name: "yam_run",
          arguments: {
            flows: ["flows/natural_language_login.flow"],
            inputs: { email: "connected2atul@gmail.com", password: "qwerty123" },
          },
        }),
      ) as { runId: string; totals: { failed: number } };
      // The run has to fail on the element, or there is nothing to heal.
      expect(run.totals.failed).toBeGreaterThan(0);

      const proposed = answer(
        await session.client.callTool({ name: "yam_heal", arguments: { runId: run.runId } }),
      ) as { applied: boolean; usedModel: boolean; results: Array<{ id: string; outcome: string }>; diff: string };

      // Proposes: the store on disk is untouched, and no model was involved.
      expect(proposed.applied).toBe(false);
      expect(proposed.usedModel).toBe(false);
      expect(readFileSync(file, "utf8")).toContain("gone-away");
      expect(proposed.results.length).toBeGreaterThan(0);

      const applied = answer(
        await session.client.callTool({
          name: "yam_heal",
          arguments: { runId: run.runId, apply: true },
        }),
      ) as { applied: boolean; results: Array<{ id: string; outcome: string }> };
      if (applied.results.some((one) => one.outcome === "repaired")) {
        expect(applied.applied).toBe(true);
        // Written this time: the broken candidate is gone from the file.
        expect(readFileSync(file, "utf8")).not.toContain("gone-away");
      }
    } finally {
      await session.close();
    }
  }, 240_000);
});
