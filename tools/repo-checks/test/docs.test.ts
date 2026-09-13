/**
 * T13.5 — the documentation set (Draft 2.18).
 *
 * Three properties: every relative link under `docs/` resolves; every
 * published package has a generated reference page that names its exports;
 * and the generated pages are current, which `scripts/docs.mjs --check` is
 * the judge of.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".md") ? [join(dir, entry.name)] : [],
  );

describe("the documentation set (T13.5)", () => {
  const pages = walk(fromRoot("docs")).filter(
    (file) => !file.includes("/docs/spec/progress/") && !file.includes("/docs/spec/prompts/"),
  );

  it("has an index that reaches every kind of page", () => {
    const index = readFileSync(fromRoot("docs", "README.md"), "utf8");
    for (const dir of ["getting-started/", "guides/", "concepts/", "reference/generated/", "project/", "spec/"]) {
      expect(index, `docs/README.md does not link into ${dir}`).toContain(`](${dir}`);
    }
  });

  it("every relative link under docs/ resolves to a file", () => {
    const broken: string[] = [];
    for (const page of pages) {
      const text = readFileSync(page, "utf8");
      for (const match of text.matchAll(/\]\(([^)\s#]+)(#[^)]*)?\)/g)) {
        const target = match[1]!;
        if (/^[a-z]+:/.test(target)) continue; // http, mailto
        const path = resolve(dirname(page), target);
        if (!existsSync(path)) broken.push(`${relative(REPO_ROOT, page)} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("every workspace package has a generated reference page naming its exports", () => {
    const dirs = readdirSync(fromRoot("packages")).filter((dir) =>
      existsSync(fromRoot("packages", dir, "package.json")),
    );
    for (const dir of dirs) {
      const page = fromRoot("docs", "reference", "generated", "packages", `${dir}.md`);
      expect(existsSync(page), `no generated page for packages/${dir}`).toBe(true);
      const text = readFileSync(page, "utf8");
      const manifest = JSON.parse(readFileSync(fromRoot("packages", dir, "package.json"), "utf8")) as { name: string };
      expect(text).toContain(`# \`${manifest.name}\``);
      expect(text).toContain("## Exports");
    }
  });

  it("the generated pages are current (`pnpm docs:check`)", () => {
    // The script needs the built packages; the contract builds before it tests.
    const result = execFileSync(process.execPath, [fromRoot("scripts", "docs.mjs"), "--check"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(result).toContain("is current");
  });
});
