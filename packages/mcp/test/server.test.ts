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
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startSampleApp, type SampleServer } from "sample-web";
import { checkTrajectory, readTrajectory } from "@svatah/yam-trajectory";
import { parseArgs } from "@svatah/yam-bindings-cli";
import {
  AGENT_HOLDER_SUFFIX,
  agentHolder,
  buildMcpServer,
  launchRefusal,
  policyFrom,
  programAllowed,
  urlRefusal,
  urlsIn,
} from "../src/server.js";
import { MCP_CORPUS } from "./corpus.js";

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
async function connect(
  root: string | undefined,
  trajectoryPath?: string,
  clientName = "test-agent",
  policy: { allowPrograms?: string[]; allowFileUrls?: boolean } = {},
) {
  const built = await buildMcpServer({
    ...policy,
    ...(root === undefined ? {} : { root }),
    ...(trajectoryPath === undefined ? {} : { trajectoryPath }),
    sessionId: "test",
    io: { out: () => undefined, err: () => undefined },
  });
  const client = new Client({ name: clientName, version: "0" });
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
  // The sessions are the broker's now, and the broker outlives the suite by
  // design; it must not outlive the test run.
  /*
   * The broker outlives its commands by design, and it must not be killed here.
   *
   * This was `pkill -f "surface broker"`, which matches on the **command line**
   * and so kills every broker on the machine — the one another file in this
   * package is mid-journey on, and the one another package's suite is using,
   * because `pnpm -r test` runs several at once and vitest runs files in
   * parallel within each. That is the whole of the intermittent
   * `SESSION_NOT_FOUND`: about one full-suite run in three, some file finished
   * and took somebody else's broker with it.
   *
   * The suite's own broker is reaped once, after every file, by
   * `scripts/vitest-broker.mjs` — by the pid in its descriptor, in the state
   * directory this package's vitest configuration named. Per file is the wrong
   * granularity for a process that exists to outlive commands.
   */
});

describe("the tools an agent is offered (REQ-AGT-2, LLD §15)", () => {
  const PUBLISHED = [
    "surface_act",
    "surface_capabilities",
    "surface_check",
    "surface_close",
    "surface_connect",
    "surface_control",
    "surface_describe",
    "surface_events",
    "surface_read",
    "surface_request",
    "surface_screenshot",
    "surface_sessions",
    "surface_snapshot",
    "surface_targets",
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

  it("offers only the surface tools when it has no project (REQ-AGT-2)", async () => {
    // Seven project tools that could only answer "requires a project" were
    // listed on the server `npx -y @svatah/yam-mcp` starts by default.
    const session = await connect(undefined);
    try {
      const { tools } = await session.client.listTools();
      expect(tools.map((one) => one.name).sort()).toEqual(
        PUBLISHED.filter((one) => one.startsWith("surface_") && one !== "surface_trajectory"),
      );
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
      const { compileProject, loadProject } = await import("@svatah/yam");
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
        written: string[];
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

/**
 * The conformance corpus, over the transport an ordinary MCP client uses to
 * start a server it owns (T21, SF-07, SF-08).
 *
 * SF-07 asks for "the actual subprocess transport" and the reason is wave 3's
 * second defect: an MCP server that had never been run as one, because every
 * test used the in-memory pair. The corpus is the same list `mcp-http.test.ts`
 * runs, imported rather than copied — the one property a second transport has
 * to establish is that it is the *same* server, and two copies of a corpus
 * cannot establish it for long.
 */
describe("the conformance corpus over stdio (SF-07, SF-08)", () => {
  for (const one of MCP_CORPUS) {
    it(one.name, async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [join(ROOT, "packages", "mcp", "dist", "bin.js")],
        cwd: ROOT,
        stderr: "ignore",
        /*
         * The SDK gives a spawned server a *minimal* environment.
         *
         * `StdioClientTransport` defaults to `getDefaultEnvironment()` — PATH,
         * HOME and a short safe list — so nothing named `YAM_*` reaches the
         * server unless it is passed. That is right for an agent host launching
         * an untrusted command, and it means this suite's own
         * `YAM_BROKER_STATE_DIR` was being dropped: the in-process tests used
         * the isolated broker and these used the machine's, which is two broker
         * populations inside one package and worse than the one it replaced.
         */
        env: process.env as Record<string, string>,
      });
      const client = new Client({ name: "corpus-stdio", version: "0" });
      await client.connect(transport);
      try {
        await one.run(client, { sampleUrl: app.origin });
      } finally {
        await client.close().catch(() => undefined);
      }
    }, 180_000);
  }
});

describe("an agent and the command line share one broker (T11, T16, SF-05, SF-13)", () => {
  /**
   * Verification of wave 3. The server had a session store of its own, so a
   * session an agent opened was one `yam surface sessions` could not list and
   * the desktop could not show, and the agent's `surface_control` was refused
   * as "this broker does not arbitrate control". T16's demonstration used an
   * HTTP client as the agent, which is why it passed.
   */
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [join(ROOT, "packages", "cli", "dist", "bin.js"), "surface", ...args, "--json"], {
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    });

  it("a session opened over MCP is one the command line lists, and control is arbitrated between them", async () => {
    const session = await connect(scaffold(), join(tmpdir(), `yam-mcp-shared-${process.pid}.jsonl`));
    let sid: string | undefined;
    try {
      const opened = answer(
        await session.client.callTool({ name: "surface_connect", arguments: { url: app.origin } }),
      ) as { status: string; result: { sessionId: string } };
      expect(opened.status).toBe("succeeded");
      sid = opened.result.sessionId;

      // One broker: the terminal sees what the agent opened.
      const listed = JSON.parse(cli("sessions").stdout) as { result: { sessions: Array<{ sessionId: string }> } };
      expect(listed.result.sessions.map((one) => one.sessionId)).toContain(sid);

      // The agent takes the target under the name its client gave at initialization.
      const taken = answer(
        await session.client.callTool({ name: "surface_control", arguments: { session: sid, action: "take" } }),
      ) as { status: string; result: { holder: string } };
      expect(taken.status).toBe("succeeded");
      expect(taken.result.holder).toBe("test-agent (MCP)");

      // The terminal is refused, and told who has it; the agent is not.
      const input = join(tmpdir(), `yam-mcp-nav-${process.pid}.json`);
      writeFileSync(input, JSON.stringify({ url: "/" }), "utf8");
      const refused = JSON.parse(cli("act", "--session", sid, "--action", "navigate", "--input", input).stdout) as {
        status: string;
        error?: { code: string; message: string };
      };
      expect(refused.status).toBe("refused");
      expect(refused.error?.code).toBe("CONTROL_BUSY");
      expect(refused.error?.message).toContain("test-agent");

      const acted = answer(
        await session.client.callTool({
          name: "surface_act",
          arguments: { session: sid, action: "navigate", args: { url: "/" } },
        }),
      ) as { status: string; error?: { code: string } };
      expect(acted.status, JSON.stringify(acted.error)).toBe("succeeded");

      // The explicit handoff from the terminal, after which the agent is the one refused.
      const handed = JSON.parse(cli("control", "--session", sid, "--take", "--force").stdout) as {
        result: { holder: string };
      };
      expect(handed.result.holder).toBe("yam cli");
      const agentRefused = answer(
        await session.client.callTool({
          name: "surface_act",
          arguments: { session: sid, action: "navigate", args: { url: "/" } },
        }),
      ) as { status: string; error?: { code: string; message: string } };
      expect(agentRefused.status).toBe("refused");
      expect(agentRefused.error?.message).toContain("yam cli");
    } finally {
      if (sid !== undefined) {
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }).catch(() => undefined);
      }
      await session.close();
    }
  }, 240_000);
});

describe("an agent acts as itself, and only a person forces a handoff (SF-13)", () => {
  it("offers no argument that names a holder or forces control", async () => {
    const session = await connect(undefined);
    try {
      const { tools } = await session.client.listTools();
      for (const tool of tools) {
        const properties = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
        expect(properties, tool.name).not.toContain("holder");
        expect(properties, tool.name).not.toContain("force");
      }
    } finally {
      await session.close();
    }
  }, 180_000);

  it("never lets a client pass for a person's client, however it spells its name", () => {
    expect(agentHolder("claude-code")).toBe("claude-code (MCP)");
    expect(agentHolder("Yam desktop")).toBe("Yam desktop (MCP)");
    // A zero-width space and a stray control character are not a different name.
    expect(agentHolder("Yam\u200B desktop\u0007")).toBe("Yam desktop (MCP)");
    expect(agentHolder(undefined)).toBe("an agent (MCP)");
  });

  it("marks agents with a suffix no person's client name has", () => {
    const desktop = /DESKTOP_HOLDER = "([^"]+)"/.exec(
      readFileSync(join(ROOT, "packages", "screens", "src", "holder.ts"), "utf8"),
    )?.[1];
    const terminal = /CLI_HOLDER = "([^"]+)"/.exec(
      readFileSync(join(ROOT, "packages", "cli", "src", "commands", "surface-control.ts"), "utf8"),
    )?.[1];
    expect(desktop).toBeDefined();
    expect(terminal).toBeDefined();
    expect(desktop!.endsWith(AGENT_HOLDER_SUFFIX)).toBe(false);
    expect(terminal!.endsWith(AGENT_HOLDER_SUFFIX)).toBe(false);
  });

  it("refuses to close a session a person holds, and to write a screenshot through act", async () => {
    const session = await connect(undefined);
    let sid: string | undefined;
    try {
      const opened = answer(
        await session.client.callTool({ name: "surface_connect", arguments: { url: app.origin, adapter: "playwright" } }),
      ) as { result: { sessionId: string } };
      sid = opened.result.sessionId;

      const shot = answer(
        await session.client.callTool({
          name: "surface_act",
          arguments: { session: sid, action: "screenshot", args: { path: join(tmpdir(), "yam-mcp-act-shot.png") } },
        }),
      ) as { status: string; error: { code: string } };
      expect(shot.status).toBe("refused");
      expect(existsSync(join(tmpdir(), "yam-mcp-act-shot.png"))).toBe(false);

      const cli = (...args: string[]) =>
        spawnSync(process.execPath, [join(ROOT, "packages", "cli", "dist", "bin.js"), "surface", ...args, "--json"], {
          encoding: "utf8",
          env: { ...process.env, CI: "true" },
        });
      expect(JSON.parse(cli("control", "--session", sid, "--take").stdout).status).toBe("succeeded");
      const closed = answer(
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }),
      ) as { status: string; error: { code: string; message: string } };
      expect(closed.status).toBe("refused");
      expect(closed.error.message).toContain("yam cli");
      cli("control", "--session", sid, "--release");
    } finally {
      if (sid !== undefined) {
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }).catch(() => undefined);
      }
      await session.close();
    }
  }, 240_000);
});

describe("what an agent types in secret stays out of the record (SF-15)", () => {
  it("withholds a password from the trajectory, declared or not", async () => {
    const project = scaffold();
    const path = join(project, "runs", "secret", "trajectory.jsonl");
    const session = await connect(project, path);
    let sid: string | undefined;
    try {
      const connected = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { url: `${app.origin}/login`, adapter: "playwright" },
        }),
      ) as { result: { sessionId: string } };
      sid = connected.result.sessionId;
      const login = answer(
        await session.client.callTool({
          name: "surface_snapshot",
          arguments: { session: sid, interactiveOnly: true },
        }),
      ) as { result: { text: string } };
      const username = /textbox "Username"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.result.text)?.[1];
      const password = /textbox "Password"(?: \[[^\]]*\])* \[ref=(\w+)\]/.exec(login.result.text)?.[1];
      expect(password, login.result.text.slice(0, 400)).toBeDefined();

      // Undeclared, into a field that says it is a password.
      await session.client.callTool({
        name: "surface_act",
        arguments: { session: sid, intent: "enter the password", action: "type", ref: password, args: { value: "hunter2-undeclared" } },
      });
      // Declared, into a field that does not.
      await session.client.callTool({
        name: "surface_act",
        arguments: {
          session: sid,
          intent: "enter the account code",
          action: "type",
          ref: username,
          args: { value: "code-4711-declared" },
          secrets: ["code-4711-declared"],
        },
      });

      // The next look, with an intent, after the password is in the field.
      await session.client.callTool({
        name: "surface_snapshot",
        arguments: { session: sid, intent: "find the sign in button" },
      });
      await session.client.callTool({
        name: "surface_act",
        arguments: { session: sid, intent: "submit with Enter", action: "press", ref: password, args: { key: "Tab" } },
      });

      const written = readFileSync(path, "utf8");
      expect(written).not.toContain("hunter2-undeclared");
      expect(written).not.toContain("code-4711-declared");
      const typed = readTrajectory(path)
        .filter((one) => (one.args as { action?: string } | undefined)?.action === "type")
        .map((one) => ((one.args as { args?: { value?: string } }).args ?? {}).value);
      expect(typed).toEqual(["[REDACTED]", "[REDACTED]"]);
    } finally {
      if (sid !== undefined) {
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }).catch(() => undefined);
      }
      await session.close();
    }
  }, 300_000);
});

describe("a screenshot is a picture the agent can see (SF-11)", () => {
  it("returns the image, and keeps the file beside the trajectory rather than where it is told", async () => {
    const project = scaffold();
    const path = join(project, "runs", "shot", "trajectory.jsonl");
    const session = await connect(project, path);
    let sid: string | undefined;
    try {
      const { tools } = await session.client.listTools();
      const shot = tools.find((one) => one.name === "surface_screenshot")!;
      expect(Object.keys((shot.inputSchema as { properties?: object }).properties ?? {})).not.toContain("path");

      const connected = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { url: `${app.origin}/login`, adapter: "playwright" },
        }),
      ) as { result: { sessionId: string } };
      sid = connected.result.sessionId;
      const result = (await session.client.callTool({
        name: "surface_screenshot",
        arguments: { session: sid, path: join(project, "elsewhere.png") },
      })) as { content: Array<{ type: string; data?: string; mimeType?: string }> };
      const envelope = answer(result) as { status: string; result: { path: string } };
      expect(envelope.status).toBe("succeeded");
      expect(envelope.result.path.startsWith(join(project, "runs", "shot", "screenshots"))).toBe(true);
      expect(existsSync(envelope.result.path)).toBe(true);
      expect(existsSync(join(project, "elsewhere.png"))).toBe(false);
      const image = result.content.find((one) => one.type === "image");
      expect(image?.mimeType).toBe("image/png");
      expect(Buffer.from(image!.data!, "base64").subarray(1, 4).toString("latin1")).toBe("PNG");
    } finally {
      if (sid !== undefined) {
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }).catch(() => undefined);
      }
      await session.close();
    }
  }, 300_000);
});

describe("what an agent may start and open is the person's to say (SF-15)", () => {
  it("starts no program unless the server was told it may", () => {
    expect(launchRefusal({ adapter: "process", app: "/bin/sh" }, {})).toMatch(/--allow-program/);
    expect(launchRefusal({ adapter: "process", app: "/bin/sh" }, { allowPrograms: ["sh"] })).toBeUndefined();
    expect(launchRefusal({ adapter: "process", app: "/bin/sh" }, { allowPrograms: ["/bin/sh"] })).toBeUndefined();
    expect(launchRefusal({ adapter: "process", app: "/bin/zsh" }, { allowPrograms: ["sh"] })).toMatch(/zsh/);
    expect(launchRefusal({ adapter: "process", app: "anything" }, { allowPrograms: ["*"] })).toBeUndefined();
    // An application launched by bundle or path is a program started too.
    expect(launchRefusal({ adapter: "ax", app: "Notes", launch: { bundle: "com.apple.Notes" } }, { allowApps: ["Notes"] })).toMatch(
      /com.apple.Notes/,
    );
    // Both are checked: an allowed bundle does not carry a path that is not.
    expect(
      launchRefusal(
        { adapter: "uia", app: "notepad", launch: { bundle: "notepad", path: "C:\\Windows\\System32\\cmd.exe" } },
        { allowPrograms: ["notepad"], allowApps: ["notepad"] },
      ),
    ).toMatch(/cmd\.exe/);
    // A terminal named only by its launch path is still a program started.
    expect(launchRefusal({ adapter: "process", launch: { path: "/bin/sh" } }, {})).toMatch(/--allow-program/);
  });

  it("drives a running application only when the server was told it may", () => {
    // Typing into a running Terminal starts anything, whatever --allow-program says.
    expect(launchRefusal({ adapter: "ax", app: "Terminal" }, {})).toMatch(/--allow-app/);
    expect(launchRefusal({ adapter: "ax", app: "terminal" }, { allowApps: ["Terminal"] })).toBeUndefined();
    expect(launchRefusal({ adapter: "ax", app: "Yam" }, { allowApps: ["*"] })).toBeUndefined();
  });

  it("matches a bare program name only where a shell would find it", () => {
    const dir = (process.env["PATH"] ?? "").split(":").find((one) => one !== "") ?? "/usr/bin";
    expect(programAllowed("sh", ["sh"])).toBe(true);
    expect(programAllowed(`${dir}/sh`, ["sh"])).toBe(true);
    expect(programAllowed("/tmp/not-on-path/sh", ["sh"])).toBe(false);
    expect(programAllowed("/tmp/x/sh", ["/tmp/x/sh"])).toBe(true);
  });

  it("opens http, https and about: pages, and file: only when allowed", () => {
    expect(urlRefusal("https://example.com", {})).toBeUndefined();
    expect(urlRefusal("about:blank", {})).toBeUndefined();
    expect(urlRefusal("/login", {})).toBeUndefined();
    expect(urlRefusal("file:///etc/passwd", {})).toMatch(/--allow-file-urls/);
    expect(urlRefusal("file:///etc/passwd", { allowFileUrls: true })).toBeUndefined();
    expect(urlRefusal("chrome://settings", {})).toMatch(/refused/);
    // A list is joined into one URL by the web adapters; every spelling is checked.
    expect(urlsIn(["file:///etc/passwd"])).toContain("file:///etc/passwd");
    expect(urlsIn(["a", "b"])).toEqual(["a", "b", "a,b"]);
  });

  it("joins a running browser on loopback only", () => {
    expect(launchRefusal({ attach: "http://127.0.0.1:9222" }, {})).toBeUndefined();
    expect(launchRefusal({ attach: "ws://localhost:9222/devtools/browser/x" }, {})).toBeUndefined();
    expect(launchRefusal({ attach: "http://10.0.0.5:9222" }, {})).toMatch(/loopback/);
    // A name that only starts like a loopback address is not one; a mapped one is.
    expect(launchRefusal({ attach: "http://127.evil.example:9222" }, {})).toMatch(/loopback/);
    expect(launchRefusal({ attach: "http://[::ffff:127.0.0.1]:9222" }, {})).toBeUndefined();
  });

  it("reads the policy from the flags a person puts in the server's configuration", () => {
    expect(policyFrom(parseArgs(["/p", "--allow-program", "sh", "--allow-program", "node,python3"]))).toEqual({
      allowPrograms: ["sh", "node", "python3"],
    });
    expect(policyFrom(parseArgs(["--allow-file-urls"]))).toEqual({ allowFileUrls: true });
    expect(policyFrom(parseArgs(["--allow-app", "Yam", "--allow-upload"]))).toEqual({ allowApps: ["Yam"], allowUpload: true });
    expect(policyFrom(parseArgs([]))).toEqual({});
  });

  it("refuses over the protocol before anything is started, and marks what it cannot undo", async () => {
    const session = await connect(undefined);
    try {
      const { tools } = await session.client.listTools();
      for (const name of ["surface_connect", "surface_act", "surface_request"]) {
        expect(tools.find((one) => one.name === name)?.annotations?.destructiveHint, name).toBe(true);
      }
      const terminal = answer(
        await session.client.callTool({ name: "surface_connect", arguments: { adapter: "process", app: "/bin/sh" } }),
      ) as { status: string; error: { code: string } };
      expect(terminal.status).toBe("refused");
      expect(terminal.error.code).toBe("PERMISSION_REQUIRED");
      const page = answer(
        await session.client.callTool({ name: "surface_connect", arguments: { url: "file:///etc/hosts" } }),
      ) as { status: string; error: { code: string } };
      expect(page.error.code).toBe("PERMISSION_REQUIRED");

      const web = answer(
        await session.client.callTool({ name: "surface_connect", arguments: { url: app.origin, adapter: "playwright" } }),
      ) as { result: { sessionId: string } };
      const sid = web.result.sessionId;
      try {
        const listed = answer(
          await session.client.callTool({
            name: "surface_act",
            arguments: { session: sid, action: "navigate", args: { url: ["file:///etc/hosts"] } },
          }),
        ) as { status: string; error: { code: string } };
        expect(listed.error.code).toBe("PERMISSION_REQUIRED");
        const upload = answer(
          await session.client.callTool({
            name: "surface_act",
            arguments: { session: sid, action: "upload", ref: "r1", args: { files: "/etc/hosts" } },
          }),
        ) as { status: string; error: { code: string } };
        expect(upload.error.code).toBe("PERMISSION_REQUIRED");
      } finally {
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }).catch(() => undefined);
      }
    } finally {
      await session.close();
    }
  }, 180_000);

  it("starts an allowed program", async () => {
    const session = await connect(undefined, undefined, "test-agent", { allowPrograms: ["sh"] });
    let sid: string | undefined;
    try {
      const opened = answer(
        await session.client.callTool({
          name: "surface_connect",
          arguments: { adapter: "process", app: "/bin/sh", launch: { args: ["-c", "echo started; sleep 5"] } },
        }),
      ) as { status: string; result?: { sessionId: string }; error?: unknown };
      expect(opened.status, JSON.stringify(opened.error)).toBe("succeeded");
      sid = opened.result!.sessionId;
    } finally {
      if (sid !== undefined) {
        await session.client.callTool({ name: "surface_close", arguments: { session: sid } }).catch(() => undefined);
      }
      await session.close();
    }
  }, 180_000);
});
