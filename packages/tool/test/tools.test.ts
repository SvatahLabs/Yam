/**
 * Deriving tools from stories (T5.3, REQ-BEH-3, REQ-AUTO-8, LLD §13.3).
 *
 * The end-to-end proof — a real MCP client, a real browser, an audit log — is
 * `packages/cli/test/tool-server.test.ts`. What is here is the derivation
 * itself, which has no browser in it and is the part a reviewer has to be able
 * to check by reading: which stories become tools, what their schemas say, and
 * which stories are refused.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, SCHEMA_VERSION, type Config, type Plan, type Story } from "@svatah/yam-schema";
import {
  callTool,
  definitionOf,
  exposureFor,
  inputSchemaOf,
  requiresIdempotent,
  toolNameOf,
  toolsFor,
} from "../src/index.js";

const story = (name: string, parts: Partial<Story> = {}): Story => ({
  name,
  kind: "story",
  file: "flows/a.flow",
  meta: { enabled: true, onFailure: "stop", tags: [] },
  signature: {
    inputs: {
      location: { type: "string" },
      date: { type: "string", default: "2026-09-03" },
    },
    outputs: { booking: { type: "string" } },
  },
  steps: [],
  ...parts,
});

const plan = (stories: Story[]): Plan => ({
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-09-04T00:00:00.000Z",
  project: "p",
  stories,
  compositions: {},
  runs: {},
  targets: {},
  apis: [],
  customSteps: [],
  hash: "h",
});

/**
 * A config for one case (P6-F5).
 *
 * `DEFAULT_CONFIG` is `Omit<Config, "project">` — the project's name is the one
 * field with no defensible default — so the name has to be supplied here. The
 * same construction was wrong in `@svatah/yam-workflow` and is what kept
 * `pnpm -r typecheck` red, which Draft 2.8 §16 now makes part of the
 * verification contract.
 */
const config = (parts: Partial<Config> = {}): Config => ({
  ...DEFAULT_CONFIG,
  project: "tool-test",
  ...parts,
});

describe("a story's signature is the tool's schema (LLD §13.3)", () => {
  it("makes an input without a default required, and one with a default not", () => {
    // The same rule the runtime validates by (REQ-AUTO-5), from the same line.
    const schema = inputSchemaOf(story("Book a slot"));
    expect(schema.required).toEqual(["location"]);
    expect(schema.properties["date"]?.default).toBe("2026-09-03");
    expect(schema.additionalProperties).toBe(false);
  });

  it("maps the IR's types onto JSON Schema's", () => {
    const schema = inputSchemaOf(
      story("Types", {
        signature: {
          inputs: {
            s: { type: "string" },
            n: { type: "number" },
            b: { type: "boolean" },
            j: { type: "json" },
            k: { type: "secret" },
          },
          outputs: {},
        },
      }),
    );
    expect(schema.properties["n"]?.type).toBe("number");
    expect(schema.properties["b"]?.type).toBe("boolean");
    expect(schema.properties["j"]?.type).toBe("object");
    // A secret is a string on the wire — the client has to be able to send one —
    // and the protecting happens on this side (REQ-NFR-6). The description says
    // so, because an agent choosing what to pass should know.
    expect(schema.properties["k"]?.type).toBe("string");
    expect(schema.properties["k"]?.description).toContain("redacted");
  });

  it("names the tool from the story, and says what it returns", () => {
    expect(toolNameOf("Book a slot")).toBe("book_a_slot");
    expect(toolNameOf("Cancel booking!")).toBe("cancel_booking");
    expect(toolNameOf("  ")).toBe("story");

    const tool = definitionOf(story("Book a slot", { meta: { enabled: true, onFailure: "stop", tags: [], idempotent: true } }));
    expect(tool.description).toContain("booking");
    expect(tool.description).toContain("Idempotent");
    expect(tool.description).toContain("No model");
  });

  it("says plainly when a story is not idempotent", () => {
    // An agent choosing between tools should be told which one it cannot retry.
    expect(definitionOf(story("Pay")).description).toContain("Not marked idempotent");
  });
});

describe("what a tool server refuses to expose (REQ-AUTO-8)", () => {
  const two = plan([
    story("Book a slot", { meta: { enabled: true, onFailure: "stop", tags: [], idempotent: true } }),
    story("Pay for a slot"),
  ]);

  it("exposes nothing by default", () => {
    // A server that published every story would publish whatever the last person
    // added, and the idempotency declaration would be the only thing between an
    // agent and a story nobody meant it to see.
    expect(toolsFor({ plan: two, config: config() }).tools).toEqual([]);
  });

  it("requires idempotency in production and not in test, unless told otherwise", () => {
    expect(requiresIdempotent(config({ environment: "production" }))).toBe(true);
    expect(requiresIdempotent(config({ environment: "test" }))).toBe(false);
    // An explicit value wins in both directions.
    expect(
      requiresIdempotent(
        config({ environment: "production", tool: { expose: [], requireIdempotent: false } }),
      ),
    ).toBe(false);
    expect(
      requiresIdempotent(config({ environment: "test", tool: { expose: [], requireIdempotent: true } })),
    ).toBe(true);
  });

  it("refuses a non-idempotent story when it is required, with a reason", () => {
    const { exposed, refused } = exposureFor(two, config({ environment: "production" }), [
      "Book a slot",
      "Pay for a slot",
    ]);
    expect(exposed.map((one) => one.story.name)).toEqual(["Book a slot"]);
    expect(refused[0]?.name).toBe("Pay for a slot");
    expect(refused[0]?.why).toContain("An agent retries");
  });

  it("refuses a story with no signature", () => {
    const bare = plan([story("Log out", { signature: undefined })]);
    const { refused } = exposureFor(bare, config(), ["Log out"]);
    expect(refused[0]?.why).toContain("no signature");
  });

  it("names the stories that exist when asked for one that does not", () => {
    const { refused } = exposureFor(two, config(), ["Book a table"]);
    expect(refused[0]?.why).toContain("Book a slot");
  });

  it("refuses two stories that would become one tool", () => {
    // `book_a_slot` twice: an agent's call would get whichever was registered
    // last, and nothing about the call would say so.
    const clashing = plan([story("Book a slot"), story("Book: a slot")]);
    expect(() =>
      toolsFor({
        plan: clashing,
        config: config(),
        expose: "Book a slot,Book: a slot",
      }),
    ).toThrow(/one tool name/);
  });
});

describe("calling a tool (LLD §13.3)", () => {
  const tool = definitionOf(story("Book a slot"));

  const outcome = (parts: Partial<Awaited<ReturnType<Parameters<typeof callTool>[2]["runner"]>>> = {}) =>
    ({
      runId: "r1",
      outputs: { booking: "Slot booked." },
      summary: {} as never,
      results: [],
      exitCode: 0,
      ...parts,
    }) as never;

  it("runs as an agent, by the client's own name (REQ-AUTO-6)", async () => {
    let seen: unknown;
    await callTool(tool, { location: "Indiranagar" }, {
      client: "claude-desktop",
      runner: async (_story, call) => {
        seen = call.invoker;
        return outcome();
      },
    });
    expect(seen).toEqual({ kind: "agent", id: "claude-desktop", via: "mcp" });
  });

  it("is still an agent when the client did not name itself", async () => {
    let seen: unknown;
    await callTool(tool, {}, {
      runner: async (_story, call) => {
        seen = call.invoker;
        return outcome();
      },
    });
    expect(seen).toEqual({ kind: "agent", id: "agent", via: "mcp" });
  });

  it("returns outputs and the runId", async () => {
    const result = await callTool(tool, { location: "x" }, { runner: async () => outcome() });
    expect(result).toMatchObject({
      runId: "r1",
      outputs: { booking: "Slot booked." },
      status: "passed",
      exitCode: 0,
    });
  });

  it("reports a failure as a result, with the step and the class", async () => {
    /*
     * Not an exception. The agent asked what happened, and the honest answer is
     * which step stopped and why — with the `runId` that has the whole record.
     * An exception would leave it with a string and nowhere to look.
     */
    const result = await callTool(tool, {}, {
      runner: async () =>
        outcome({
          exitCode: 1,
          outputs: {},
          results: [
            {
              status: "failed",
              text: "Click the Book now button",
              failure: { class: "locator", message: 'Could not resolve "booking.book-now-button"' },
            },
          ] as never,
        }),
    });
    expect(result.status).toBe("failed");
    expect(result.failure?.step).toBe("Click the Book now button");
    expect(result.failure?.class).toBe("locator");
    expect(result.runId).toBe("r1");
  });
});
