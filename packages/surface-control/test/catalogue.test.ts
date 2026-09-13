import { describe, it, expect } from "vitest";
import {
  OPERATIONS,
  operationByName,
  operationByCliSubcommand,
  operationByMcpTool,
  operationByServicePath,
  SURFACE_TOOL_NAMES,
  SURFACE_CLI_SUBCOMMANDS,
  ERROR_CODES,
  CLI_EXIT_CODES,
} from "@svatah/yam-contract";

describe("OPERATIONS catalogue", () => {
  it("has exactly 14 operations", () => {
    // Eleven through wave 2; T15 adds `request` so an HTTP surface can be driven
    // at all, T16 adds `control` so a person and an agent can hand over, and T17
    // adds `events` so a session can be promoted into a proposal.
    expect(OPERATIONS).toHaveLength(14);
  });

  it("every operation has unique name, subcommand, toolName, and service path", () => {
    const names = OPERATIONS.map((op) => op.name);
    const subs = OPERATIONS.map((op) => op.cli.subcommand);
    const tools = OPERATIONS.map((op) => op.mcp.toolName);
    const paths = OPERATIONS.map((op) => `${op.service.method} ${op.service.path}`);

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(subs).size).toBe(subs.length);
    expect(new Set(tools).size).toBe(tools.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("one source propagates to all three interfaces", () => {
    const connect = operationByName("connect")!;
    expect(connect).toBeDefined();
    expect(connect.cli.subcommand).toBe("connect");
    expect(connect.mcp.toolName).toBe("surface_connect");
    expect(connect.service.path).toBe("/sessions");

    expect(operationByCliSubcommand("connect")).toBe(connect);
    expect(operationByMcpTool("surface_connect")).toBe(connect);
    expect(operationByServicePath("POST", "/sessions")).toBe(connect);
  });

  it("SURFACE_TOOL_NAMES matches MCP toolNames", () => {
    expect(SURFACE_TOOL_NAMES).toEqual(
      OPERATIONS.map((op) => op.mcp.toolName),
    );
  });

  it("SURFACE_CLI_SUBCOMMANDS matches CLI subcommands", () => {
    expect(SURFACE_CLI_SUBCOMMANDS).toEqual(
      OPERATIONS.map((op) => op.cli.subcommand),
    );
  });

  it("all MCP tool names follow surface_ prefix convention", () => {
    for (const op of OPERATIONS) {
      expect(op.mcp.toolName).toMatch(/^surface_/);
    }
  });

  it("session-requiring operations have session flag in CLI", () => {
    for (const op of OPERATIONS) {
      if (op.requiresSession) {
        const hasSession = op.cli.flags.some((f) => f.name === "session");
        expect(hasSession).toBe(true);
      }
    }
  });

  it("service paths with :session are requiresSession=true", () => {
    for (const op of OPERATIONS) {
      if (op.service.path.includes(":session")) {
        expect(op.requiresSession).toBe(true);
      }
    }
  });
});

describe("lookup functions", () => {
  it("operationByName returns undefined for unknown", () => {
    expect(operationByName("nonexistent")).toBeUndefined();
  });

  it("operationByServicePath matches parameterized paths", () => {
    const snap = operationByServicePath("POST", "/sessions/s_abc123/snapshot");
    expect(snap).toBeDefined();
    expect(snap!.name).toBe("snapshot");
  });

  it("operationByServicePath rejects wrong method", () => {
    expect(operationByServicePath("GET", "/sessions/s_abc123/snapshot")).toBeUndefined();
  });
});

describe("envelope schema", () => {
  it("ERROR_CODES has 15 codes", () => {
    expect(ERROR_CODES).toHaveLength(15);
  });

  it("CLI_EXIT_CODES has distinct values", () => {
    const values = Object.values(CLI_EXIT_CODES);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("input schemas validate", () => {
  it("connect accepts empty input", () => {
    const op = operationByName("connect")!;
    const result = op.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("connect rejects invalid url", () => {
    const op = operationByName("connect")!;
    const result = op.inputSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("act requires session and action", () => {
    const op = operationByName("act")!;
    expect(op.inputSchema.safeParse({}).success).toBe(false);
    expect(op.inputSchema.safeParse({ session: "s_1" }).success).toBe(false);
    expect(
      op.inputSchema.safeParse({ session: "s_1", action: "click" }).success,
    ).toBe(true);
  });

  it("sessions accepts empty input", () => {
    const op = operationByName("sessions")!;
    expect(op.inputSchema.safeParse({}).success).toBe(true);
  });
});
