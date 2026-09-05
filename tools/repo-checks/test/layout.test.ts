/**
 * T0.1 Validate — "HLD §12 matches the layout"; T0.2 — "pnpm workspace with every
 * package in HLD §12".
 *
 * The expected directory list is parsed out of the HLD's own §12 code block, so the
 * test fails if the layout and the design document ever drift apart in either
 * direction.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fromRoot } from "../src/repo.js";

/** Directory names listed under `packages/` in HLD §12's layout block. */
function hldPackages(): string[] {
  const hld = readFileSync(fromRoot("docs", "spec", "hld.md"), "utf8");
  const section = hld.split("## 12. Repository layout")[1];
  expect(section, "HLD §12 must exist").toBeTruthy();
  const block = section!.split("```")[1];
  expect(block, "HLD §12 must contain a layout code block").toBeTruthy();

  const names: string[] = [];
  let inPackages = false;
  for (const line of block!.split("\n")) {
    if (/^\s{2}packages\/\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s{4}([a-z0-9-]+)\/\s/.exec(line);
      if (m) {
        names.push(m[1]!);
        continue;
      }
      if (line.trim() !== "") break;
    }
  }
  return names;
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

describe("repository layout (HLD §12)", () => {
  const expected = hldPackages();

  it("HLD §12 lists the expected number of packages", () => {
    // 24 through Draft 2.2; Draft 2.3 splits `playwright-test` into the module
    // (a) `bind()` package, `bindings-cli`, and the module (b) `host-playwright`.
    expect(expected.length).toBe(26);
  });

  it.each(expected)("packages/%s exists and is a buildable workspace package", (name) => {
    const dir = fromRoot("packages", name);
    expect(isDir(dir), `packages/${name} is missing`).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe(`@svatah/${name}`);
    expect(pkg.scripts.build).toBeTruthy();
    expect(pkg.scripts.test).toBeTruthy();
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
  });

  it("has no package under packages/ that HLD §12 does not list", () => {
    const actual = readdirSync(fromRoot("packages")).filter((n) =>
      isDir(fromRoot("packages", n)),
    );
    expect(actual.sort()).toEqual([...expected].sort());
  });

  it("has the non-package directories HLD §12 names", () => {
    for (const dir of [
      "apps/sample-web",
      "evals/compiler",
      "evals/grounding",
      "evals/healing",
      "evals/conformance",
      "docs/spec",
      "legacy",
    ]) {
      expect(isDir(fromRoot(dir)), `${dir} is missing`).toBe(true);
    }
  });

  it("the frozen Java project lives under legacy/ and nowhere else", () => {
    expect(existsSync(fromRoot("legacy", "build.gradle"))).toBe(true);
    expect(existsSync(fromRoot("legacy", "src", "main", "java"))).toBe(true);
    expect(existsSync(fromRoot("build.gradle"))).toBe(false);
    expect(existsSync(fromRoot("src"))).toBe(false);
  });

  it("the abandoned parser experiments are frozen outside the Java source set", () => {
    const experiments = fromRoot("legacy", "experiments");
    expect(isDir(experiments)).toBe(true);
    expect(existsSync(join(experiments, "PARSER_IMPROVEMENTS.md"))).toBe(true);
    // They must not be compiled: legacy/build.gradle uses the default source set only.
    expect(existsSync(fromRoot("legacy", "src", "main", "java", "com", "svatah", "automator", "parser", "StepParser.java"))).toBe(false);
  });

  it("legacy/build.gradle declares no CoreNLP, ONNX Runtime or Guava dependency", () => {
    const gradle = readFileSync(fromRoot("legacy", "build.gradle"), "utf8");
    expect(gradle).not.toMatch(/stanford-corenlp/);
    expect(gradle).not.toMatch(/onnxruntime/);
    expect(gradle).not.toMatch(/com\.google\.guava/);
  });
});
