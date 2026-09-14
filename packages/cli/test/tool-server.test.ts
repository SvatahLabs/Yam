/**
 * `yam tool serve` (T5.3, REQ-BEH-3, REQ-AUTO-6, 8, LLD §13.3).
 *
 * T5.3's Validate list, in one file:
 *
 * 1. **An MCP client calls a recorded "Book a slot" story with inputs and
 *    receives outputs and a `runId`** — a real client over a real transport, the
 *    tool's schema derived from the story's signature, against the sample
 *    application.
 * 2. **`audit.jsonl` shows the agent invoker and redacted inputs** — the record
 *    that is the only account of why the system changed, because an agent cannot
 *    be asked afterwards.
 * 3. **The model endpoint blocked during the test.** Every call in the last
 *    describe runs with `scripts/block-external-network.mjs`, which refuses every
 *    connection that is not to this machine. A tool call that reached a model
 *    would fail loudly.
 *
 * Plus REQ-AUTO-8: a non-idempotent story is not exposed when
 * `tool.requireIdempotent` is on, and the operator is told which and why.
 *
 * The transport is the SDK's in-memory pair, as `mcp.test.ts` uses: both are real
 * transports, and spawning a second process would make this measure stdio
 * framing rather than the tools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startSampleApp, type SampleServer } from "sample-web";
import type { AuditLine, Summary } from "@svatah/yam-schema";
import { buildToolServer } from "../src/commands/tool.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");
// A `file:` URL: `--import` takes a module specifier, and a Windows path is not one.
const BLOCKER = pathToFileURL(join(ROOT, "scripts", "block-external-network.mjs")).href;

const CARD = "5123456789012346";

let app: SampleServer;
const projects: string[] = [];

function scaffold(extra = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-tool-"));
  projects.push(dir);
  for (const entry of ["bindings", "flows", "api", "data.yaml"]) {
    cpSync(join(FIXTURES, entry), join(dir, entry), { recursive: true });
  }
  writeFileSync(
    join(dir, "yam.config.yaml"),
    readFileSync(join(FIXTURES, "yam.config.yaml"), "utf8").replace(
      /baseUrl: ".*"/,
      `baseUrl: "${app.origin}"`,
    ) + extra,
    "utf8",
  );
  return dir;
}

/** A client connected to a tool server over the SDK's in-memory transport pair. */
async function connect(root: string, expose = "Book a slot") {
  const built = await buildToolServer({
    root,
    expose,
    io: { out: () => undefined, err: () => undefined },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // The name the audit log records as the invoker (REQ-AUTO-6).
  const client = new Client({ name: "an-agent", version: "1.0.0" });
  await Promise.all([built.server.connect(serverSide), client.connect(clientSide)]);
  return {
    client,
    built,
    async close() {
      await client.close().catch(() => undefined);
      await built.close();
    },
  };
}

function audit(project: string, runId: string): AuditLine[] {
  return readFileSync(join(project, "runs", runId, "audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as AuditLine);
}

beforeAll(async () => {
  app = await startSampleApp(0);
}, 120_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("the tools are the stories (REQ-BEH-3, LLD §13.3)", () => {
  it("derives one tool per exposed story, with a schema from its signature", async () => {
    const project = scaffold();
    const { client, close } = await connect(project);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(["book_a_slot"]);

      const tool = tools[0]!;
      // `location: string` has no default and is required; `date: string =
      // "2026-09-03"` has one and is not. The same rule the runtime validates by
      // (REQ-AUTO-5), derived from the same line.
      expect(tool.inputSchema.required).toEqual(["location"]);
      expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(["date", "location"]);
      expect(tool.description).toContain("booking, place");
      expect(tool.description).toContain("No model");
    } finally {
      await close();
    }
  }, 240_000);

  it("returns the story's outputs and a runId", async () => {
    const project = scaffold();
    const { client, close } = await connect(project);
    try {
      const result = await client.callTool({
        name: "book_a_slot",
        arguments: { location: "Indiranagar" },
      });

      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
        runId: string;
        outputs: Record<string, unknown>;
        status: string;
      };

      expect(payload.status).toBe("passed");
      expect(payload.outputs).toEqual({ booking: "Slot booked.", place: "Indiranagar" });
      // The runId names a run directory the agent can go and read.
      expect(existsSync(join(project, "runs", payload.runId, "results.jsonl"))).toBe(true);
      expect(result.isError).toBeFalsy();
    } finally {
      await close();
    }
  }, 240_000);

  it("records the run as `tool`, invoked by an agent (REQ-AUTO-6)", async () => {
    const project = scaffold();
    const { client, close } = await connect(project);
    try {
      const result = await client.callTool({
        name: "book_a_slot",
        arguments: { location: "Indiranagar" },
      });
      const { runId } = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
        runId: string;
      };

      const summary = JSON.parse(
        readFileSync(join(project, "runs", runId, "summary.json"), "utf8"),
      ) as Summary;
      expect(summary.behavior).toBe("tool");
      // The MCP client's own name, not "agent": who called matters more than
      // what kind of thing called.
      expect(summary.invoker).toEqual({ kind: "agent", id: "an-agent", via: "mcp" });

      const lines = audit(project, runId);
      const run = lines.find((line) => line.kind === "run");
      expect(run).toBeDefined();
      expect((run!.detail as { invoker: { kind: string } }).invoker.kind).toBe("agent");
      // And the surface calls are there: what the agent's call actually did.
      expect(lines.some((line) => line.kind === "surface")).toBe(true);
    } finally {
      await close();
    }
  }, 240_000);

  it("redacts a secret input in the audit, and returns it to the caller", async () => {
    // `Pay for a slot` takes `card: secret`. The agent supplied it, so the
    // agent may have it back; `audit.jsonl` is a file and may not (REQ-NFR-6).
    const project = scaffold("\ntool:\n  expose: []\n  requireIdempotent: false\n");
    const { client, close } = await connect(project, "Pay for a slot");
    try {
      const result = await client.callTool({
        name: "pay_for_a_slot",
        arguments: { card: CARD },
      });
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
        runId: string;
        outputs: Record<string, unknown>;
      };
      expect(payload.outputs["paid"]).toBe(CARD);

      const dir = join(project, "runs", payload.runId);
      expect(readFileSync(join(dir, "audit.jsonl"), "utf8")).not.toContain(CARD);
      expect(readFileSync(join(dir, "results.jsonl"), "utf8")).not.toContain(CARD);
      expect(readFileSync(join(dir, "summary.json"), "utf8")).not.toContain(CARD);
    } finally {
      await close();
    }
  }, 240_000);

  it("refuses a call whose arguments the signature does not accept", async () => {
    const project = scaffold();
    const { client, close } = await connect(project);
    try {
      // No `location`, which has no default. The SDK validates against the
      // schema derived from the signature, so the story never starts — which is
      // the point of deriving rather than writing the schema.
      const result = await client.callTool({ name: "book_a_slot", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("location");
      // And nothing ran: no run directory was made for it.
      expect(existsSync(join(project, "runs"))).toBe(false);
    } finally {
      await close();
    }
  }, 240_000);
});

describe("`requireIdempotent` decides what an agent can see (REQ-AUTO-8)", () => {
  it("does not expose a non-idempotent story, and says why", async () => {
    const project = scaffold("\ntool:\n  expose: []\n  requireIdempotent: true\n");
    const said: string[] = [];
    const built = await buildToolServer({
      root: project,
      expose: "Book a slot,Pay for a slot",
      io: { out: () => undefined, err: (line) => said.push(line) },
    });
    try {
      expect(built.tools.map((t) => t.name)).toEqual(["book_a_slot"]);
      expect(said.join("\n")).toContain("Pay for a slot");
      expect(said.join("\n")).toContain("idempotent");
    } finally {
      await built.close();
    }
  }, 120_000);

  it("is on by default in production and off in test", async () => {
    const production = scaffold().replace(/$/, "");
    writeFileSync(
      join(production, "yam.config.yaml"),
      readFileSync(join(production, "yam.config.yaml"), "utf8").replace(
        "environment: test",
        "environment: production",
      ),
      "utf8",
    );
    const strict = await buildToolServer({
      root: production,
      expose: "Pay for a slot",
      io: { out: () => undefined, err: () => undefined },
    });
    expect(strict.tools).toEqual([]);
    await strict.close();

    // The same story, the same config but for one word.
    const relaxed = await buildToolServer({
      root: scaffold(),
      expose: "Pay for a slot",
      io: { out: () => undefined, err: () => undefined },
    });
    expect(relaxed.tools.map((t) => t.name)).toEqual(["pay_for_a_slot"]);
    await relaxed.close();
  }, 120_000);

  it("does not expose a story with no signature: there is nothing to derive", async () => {
    const project = scaffold();
    const said: string[] = [];
    const built = await buildToolServer({
      root: project,
      expose: "I want to validate logout",
      io: { out: () => undefined, err: (line) => said.push(line) },
    });
    expect(built.tools).toEqual([]);
    expect(said.join("\n")).toContain("no signature");
    await built.close();
  }, 120_000);
});

describe("a tool call reaches no model, with the wire cut (REQ-RUN-1, LLD §1)", () => {
  it("serves and lists its tools with every external connection refused", async () => {
    /*
     * T5.3's "model endpoint blocked during the test", as a fact about bytes
     * rather than about imports. `block-external-network.mjs` refuses every
     * connection that is not to this machine, through all the doors Node has.
     *
     * `--json` describes the server and exits, which is enough to prove the
     * *derivation* happened offline; the call itself is exercised in the tests
     * above, and reaches the sample application on localhost, which the blocker
     * allows.
     */
    const project = scaffold();
    const result = await offline(["tool", "serve", ".", "--expose", "Book a slot", "--json"], project);

    expect(result.code, result.output).toBe(0);
    const described = JSON.parse(result.out) as {
      tools: Array<{ name: string }>;
    };
    expect(described.tools.map((t) => t.name)).toEqual(["book_a_slot"]);
  }, 240_000);

  it("runs a story as a tool with the wire cut", async () => {
    // The whole call, offline: the tool derivation, the executor, the browser on
    // localhost. A tool call that reached for a model would fail here.
    const project = scaffold();
    const result = await offline(
      ["workflow", "run", "Book a slot", ".", "--input", "location=Indiranagar", "--run-id", "offline"],
      project,
    );
    expect(result.code, result.output).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      booking: "Slot booked.",
      place: "Indiranagar",
    });
  }, 240_000);
});

/** The CLI, with every connection that is not to this machine refused. */
function offline(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; output: string; out: string }> {
  return new Promise((done) => {
    let output = "";
    let out = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: {
        ...process.env,
        YAM_BASE_URL: app.origin,
        YAM_SAMPLE_PASSWORD: "qwerty123",
        YAM_SAMPLE_CARD_NUMBER: CARD,
        YAM_SAMPLE_CARD_CVV: "123",
        NODE_OPTIONS: [process.env["NODE_OPTIONS"], `--import=${BLOCKER}`]
          .filter(Boolean)
          .join(" "),
      },
    });
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output, out }));
  });
}
