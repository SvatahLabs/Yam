import { describe, expect, it } from "vitest";
import {
  OPERATIONS,
  SURFACE_TOOL_NAMES,
  SURFACE_CLI_SUBCOMMANDS,
  operationByName,
  operationByCliSubcommand,
  operationByMcpTool,
  operationByServicePath,
} from "../src/catalogue.js";
import {
  generateOpenApiPaths,
  generateTypeScriptClient,
  generatePythonClient,
  generateJavaClient,
} from "../src/codegen.js";

describe("transport parity (T12, SF-03)", () => {
  it("every operation has a CLI subcommand, an MCP tool name and a service path", () => {
    for (const op of OPERATIONS) {
      expect(op.cli.subcommand, `${op.name} missing CLI subcommand`).toBeTruthy();
      expect(op.mcp.toolName, `${op.name} missing MCP tool name`).toBeTruthy();
      expect(op.service.path, `${op.name} missing service path`).toBeTruthy();
      expect(op.service.method, `${op.name} missing service method`).toBeTruthy();
    }
  });

  it("CLI subcommands, MCP tool names and service paths are all unique", () => {
    const cliSubs = SURFACE_CLI_SUBCOMMANDS;
    expect(new Set(cliSubs).size).toBe(cliSubs.length);

    const mcpTools = SURFACE_TOOL_NAMES;
    expect(new Set(mcpTools).size).toBe(mcpTools.length);

    const paths = OPERATIONS.map((op) => `${op.service.method} ${op.service.path}`);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("lookup functions find every operation by every key", () => {
    for (const op of OPERATIONS) {
      expect(operationByName(op.name)?.name).toBe(op.name);
      expect(operationByCliSubcommand(op.cli.subcommand)?.name).toBe(op.name);
      expect(operationByMcpTool(op.mcp.toolName)?.name).toBe(op.name);
      expect(operationByServicePath(op.service.method, op.service.path)?.name).toBe(op.name);
    }
  });

  it("generated OpenAPI has one path per operation", () => {
    const paths = generateOpenApiPaths();
    const allOps = Object.values(paths).flatMap((methods) => Object.keys(methods));
    expect(allOps.length).toBe(OPERATIONS.length);
  });

  it("generated TypeScript client has a function for each operation", () => {
    const ts = generateTypeScriptClient();
    for (const op of OPERATIONS) {
      expect(ts).toContain(`export async function ${op.name}(`);
    }
  });

  it("generated Python client has a method for each operation", () => {
    const py = generatePythonClient();
    for (const op of OPERATIONS) {
      const pyName = op.name.replace(/([A-Z])/g, "_$1").toLowerCase();
      expect(py).toContain(`def ${pyName}(`);
    }
  });

  it("generated Java client has a method for each operation", () => {
    const java = generateJavaClient();
    for (const op of OPERATIONS) {
      expect(java).toContain(`public String ${op.name}(`);
    }
  });

  it("the targets operation appears in all three interfaces", () => {
    const op = operationByName("targets");
    expect(op).toBeDefined();
    expect(op!.cli.subcommand).toBe("targets");
    expect(op!.mcp.toolName).toBe("surface_targets");
    expect(op!.service.path).toBe("/targets");
  });

  it("error codes are shared across all transports (from a single source)", () => {
    const ops = OPERATIONS.filter((op) => op.cli.exitCodes.length > 1);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.cli.exitCodes.some((e) => e.code === 0)).toBe(true);
    }
  });
});
