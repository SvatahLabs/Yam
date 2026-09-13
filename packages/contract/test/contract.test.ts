/**
 * The contract, which three installables agree on (PK-07).
 *
 * `@svatah/yam`, `@svatah/yam-mcp` and the application that stages the first all
 * reach one broker, and each checks the broker's fingerprint before it will talk
 * to it. That check is only worth having if the fingerprint is a property of the
 * *shape* — so that two builds at different versions interoperate while the
 * contract has not moved, and refuse each other the moment it has.
 */
import { describe, expect, it } from "vitest";
import { OPERATIONS, SURFACE_TOOL_NAMES, SURFACE_CLI_SUBCOMMANDS, catalogueFingerprint } from "../src/index.js";

describe("the fingerprint", () => {
  it("is the same every time it is asked", () => {
    expect(catalogueFingerprint()).toBe(catalogueFingerprint());
    expect(catalogueFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  /*
   * The property the whole three-installable story rests on: a version bump
   * that does not change an operation, a flag, a tool name or a path must not
   * change the fingerprint, or every patch release would orphan every session
   * on the machine.
   */
  it("is derived from the shape, and names nothing else", () => {
    const source = catalogueFingerprint.toString();
    for (const forbidden of ["version", "process.env", "Date", "random"]) {
      expect(source, `the fingerprint reads ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("every operation is reachable on all three surfaces", () => {
  it("gives each one a CLI subcommand, an MCP tool and a service path", () => {
    const missing: string[] = [];
    for (const op of OPERATIONS) {
      if (!op.cli?.subcommand) missing.push(`${op.name}: no CLI subcommand`);
      if (!op.mcp?.toolName) missing.push(`${op.name}: no MCP tool`);
      if (!op.service?.path || !op.service?.method) missing.push(`${op.name}: no service route`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });

  it("gives no two operations the same name on any surface", () => {
    for (const [what, names] of [
      ["operation", OPERATIONS.map((o) => o.name)],
      ["MCP tool", SURFACE_TOOL_NAMES],
      ["CLI subcommand", SURFACE_CLI_SUBCOMMANDS],
    ] as const) {
      expect(new Set(names).size, `two operations share a ${what}`).toBe(names.length);
    }
  });

  /*
   * The contract must not depend on anything that drives a surface. A package
   * describing the contract *and* opening a browser would not be a contract, and
   * it is what made `@svatah/yam-mcp` impossible to build small.
   */
  it("depends on nothing that drives anything", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = Object.keys(manifest.dependencies ?? {});
    for (const driver of ["playwright", "webdriverio", "undici", "@modelcontextprotocol/sdk"]) {
      expect(deps, `the contract depends on ${driver}`).not.toContain(driver);
    }
    expect(deps.sort()).toEqual(["@svatah/yam-schema", "zod"]);
  });
});
