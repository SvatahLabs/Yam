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

/**
 * The packages Draft 2.11 requires and HLD §12's layout block does not list.
 *
 * Draft 2.11 adds the builder surfaces — `@svatah/screens` (LLD §13.7),
 * `@svatah/ui-tokens` and `@svatah/ui` (§13.7's design system), `@svatah/sdk`
 * (§13.8) and `@svatah/tui` (REQ-TUI-1) — and states each of them by name in
 * the LLD and in `tasks.md`'s Phase 9. It does not extend §12's layout block,
 * which was last touched in Draft 2.3.
 *
 * Phase 9's working rule is "where a mockup and the LLD disagree, the LLD wins";
 * the same reading applies to the HLD, whose §13 *does* list Phase 9 and every
 * requirement id these packages exist for. So the five are named here, each
 * with the section that requires it, and the check still fails on a sixth
 * package nobody wrote down. The drift is recorded under Deviations in
 * `docs/spec/progress/phase-9.md`.
 */
const DRAFT_2_11_PACKAGES: ReadonlyArray<{ name: string; because: string }> = [
  { name: "screens", because: "LLD §13.7, REQ-ADE-10: the headless screen model" },
  { name: "ui-tokens", because: "LLD §13.7, REQ-ADE-12: the design tokens, both themes" },
  { name: "ui", because: "LLD §13.7, REQ-ADE-12: the React components on Radix primitives" },
  { name: "sdk", because: "LLD §13.8, REQ-SDK-1: the generated TypeScript client" },
  { name: "tui", because: "LLD §13.7, REQ-TUI-1: `svatah ui`, the terminal cockpit" },
];

describe("repository layout (HLD §12)", () => {
  const fromHld = hldPackages();
  const expected = [...fromHld, ...DRAFT_2_11_PACKAGES.map((one) => one.name)];

  it("HLD §12 lists the expected number of packages", () => {
    // 24 through Draft 2.2; Draft 2.3 splits `playwright-test` into the module
    // (a) `bind()` package, `bindings-cli`, and the module (b) `host-playwright`.
    expect(fromHld.length).toBe(26);
  });

  it("names every Draft 2.11 package the LLD requires, with the section", () => {
    for (const one of DRAFT_2_11_PACKAGES) {
      expect(one.because, one.name).toMatch(/LLD §13\.[78]/);
      expect(fromHld, `${one.name} is in HLD §12 now; drop it from the list`).not.toContain(one.name);
    }
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

  it("the Java conformance runtime lives under runtimes/java (T6.4, REQ-STD-3)", () => {
    /*
     * Not under `packages/`, which is the pnpm workspace, and not under
     * `legacy/`, which is the *frozen* Selenium project. It is a live
     * deliverable that must build with `./gradlew` and depend on nothing in the
     * workspace — which is the whole claim of REQ-STD-3, and would stop being
     * checkable the moment it could reach a `@svatah/*` package.
     */
    expect(isDir(fromRoot("runtimes", "java"))).toBe(true);
    expect(existsSync(fromRoot("runtimes", "java", "build.gradle"))).toBe(true);
    expect(existsSync(fromRoot("runtimes", "java", "gradlew"))).toBe(true);
    expect(
      existsSync(fromRoot("runtimes", "java", "src", "main", "java", "dev", "svatah", "runtime")),
    ).toBe(true);

    const gradle = readFileSync(fromRoot("runtimes", "java", "build.gradle"), "utf8");
    // Playwright for Java and Jackson, which LLD §14 names.
    expect(gradle).toMatch(/com\.microsoft\.playwright:playwright/);
    expect(gradle).toMatch(/jackson-databind/);
    // JDK 17, which the phase requires (REQ-PKG-3, REQ-NFR-7).
    expect(gradle).toMatch(/JavaLanguageVersion\.of\(17\)/);
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
