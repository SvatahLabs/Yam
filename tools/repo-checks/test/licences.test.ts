/**
 * T0.2 Validate — "licence check passes".
 * Refs: REQ-PKG-3, REQ-NFR-10.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

describe("licences (REQ-PKG-3)", () => {
  it("every installed dependency is permissively licensed", () => {
    const out = execFileSync("node", [fromRoot("scripts", "check-licenses.mjs")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(out).toContain("Licence check OK");
  });

  it("the project itself is Apache-2.0 and ships the licence text", () => {
    const root = JSON.parse(readFileSync(fromRoot("package.json"), "utf8")) as { license: string };
    expect(root.license).toBe("Apache-2.0");
    const text = readFileSync(fromRoot("LICENSE"), "utf8");
    expect(text).toContain("Apache License");
    expect(text).toContain("Version 2.0, January 2004");
  });

  it("every workspace package declares Apache-2.0", () => {
    for (const group of ["packages", "apps"]) {
      const base = fromRoot(group);
      if (!existsSync(base)) continue;
      for (const name of readdirSync(base)) {
        const manifest = join(base, name, "package.json");
        if (!existsSync(manifest)) continue;
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as { name: string; license?: string };
        expect(pkg.license, `${pkg.name} must declare a licence`).toBe("Apache-2.0");
      }
    }
  });
});
