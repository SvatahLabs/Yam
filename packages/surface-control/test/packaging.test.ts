import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("clean-installation packaging (T13, SF-20)", () => {
  it("package.json uses scoped @svatah/yam-surface-control name", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    expect(pkg.name).toBe("@svatah/yam-surface-control");
  });

  it("package.json publishes dist/, not src/", () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain("dist");
    expect(pkg.files).not.toContain("src");
  });

  it("no repository-specific paths in the built output", () => {
    const dist = join(PKG_ROOT, "dist", "index.js");
    let code: string;
    try {
      code = readFileSync(dist, "utf8");
    } catch {
      return; // dist not built yet; the gate script builds first
    }
    expect(code).not.toContain("/Users/");
    expect(code).not.toContain("/home/");
    expect(code).not.toContain("fixtures/");
    expect(code).not.toMatch(/fake.*gateway/i);
  });

  it("MCP docs use @svatah/yam, not bare yam", () => {
    const docsPath = join(PKG_ROOT, "..", "..", "docs", "mcp.md");
    const docs = readFileSync(docsPath, "utf8");
    const yamLines = docs.split("\n").filter((line) => /\byam\b/.test(line) && line.includes("npx"));
    for (const line of yamLines) {
      if (!line.includes("@svatah/yam")) {
        throw new Error(`Unscoped npx yam reference: ${line.trim()}`);
      }
    }
  });

  it("getting-started docs use @svatah/yam, not bare yam", () => {
    const docsPath = join(PKG_ROOT, "..", "..", "docs", "getting-started", "first-flow.md");
    const docs = readFileSync(docsPath, "utf8");
    const npxLines = docs.split("\n").filter((line) => line.includes("npx") && line.includes("yam"));
    for (const line of npxLines) {
      if (!line.includes("@svatah/yam")) {
        throw new Error(`Unscoped npx reference: ${line.trim()}`);
      }
    }
  });

  it("surface_targets is documented in mcp.md", () => {
    const docsPath = join(PKG_ROOT, "..", "..", "docs", "mcp.md");
    const docs = readFileSync(docsPath, "utf8");
    expect(docs).toContain("surface_targets");
  });
});
