/**
 * T6.6's Validate, against a synthesised prototype database (REQ-ADE-9,
 * LLD §13.5).
 *
 * > A captured prototype database converts to a project that compiles clean and
 * > whose story names and step counts match.
 *
 * ## Where the database came from, exactly
 *
 * `evals/migrate/ade-db` is **synthesised**, and it has to be said plainly: no
 * prototype database was available on the machine this was written on. What
 * makes it worth trusting anyway is that neither its *shape* nor its *content*
 * was invented.
 *
 * * The tables and columns are the prototype's own, read from
 *   `src/js/dbclient.js` in `github.com/a-t-u-l/svatahADE` — which is where the
 *   two JSON-inside-a-column fields and their key names (`locator identifier`,
 *   `variable name`) come from. Nothing else would tell you those keys have
 *   spaces in them.
 * * The flows and locators are the *real* legacy files from
 *   `evals/migrate/source`, HTML-escaped the way the prototype's
 *   contenteditable editor stored them.
 *
 * So what is synthetic is the packaging, and the packaging is exactly what the
 * importer reads. `scripts/build-ade-fixture.mjs` regenerates it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { EXIT } from "@svatah/bindings-cli";
import { readLegacyFlow } from "@svatah/migrate";
import type { Plan } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SVATAH = join(ROOT, "packages", "cli", "dist", "bin.js");
const DATABASE = join(ROOT, "evals", "migrate", "ade-db");
const LEGACY = join(ROOT, "evals", "migrate", "source", "sample");

const projects: string[] = [];

function cli(args: readonly string[], cwd = ROOT): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [SVATAH, ...args], { cwd });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-from-ade-"));
  projects.push(dir);
  return dir;
}

beforeAll(() => {
  if (!existsSync(SVATAH)) throw new Error("Run `pnpm -r build` first.");
});
afterAll(() => {
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("svatah migrate --from-ade (T6.6, REQ-ADE-9)", () => {
  it("writes a project directory from the database's four tables", async () => {
    const project = scratch();
    const result = await cli(["migrate", project, "--from-ade", DATABASE]);
    expect(result.code, result.output).toBe(EXIT.ok);

    // LLD §13.5's mapping, file by file.
    expect(existsSync(join(project, "svatah.config.yaml"))).toBe(true);
    expect(readdirSync(join(project, "flows")).sort()).toEqual([
      "execution.flow",
      "natural_language_login.flow",
      "simple.flow",
      "svatah.flow",
    ]);
    expect(existsSync(join(project, "data.yaml"))).toBe(true);
    expect(readdirSync(join(project, "api")).sort()).toEqual([
      "active-count.yaml",
      "create-booking.yaml",
    ]);
    expect(readdirSync(join(project, "bindings", "migrated")).length).toBeGreaterThan(5);

    /*
     * And the intermediates are gone. `.imported.locator` and `.imported.data`
     * are the prototype's own files, reconstructed so the v2 converter has
     * something to read; leaving them would put the old tool's locator file
     * beside the new bindings store, which is the second source of truth
     * ADR-17 rejected.
     */
    expect(existsSync(join(project, ".imported.locator"))).toBe(false);
    expect(existsSync(join(project, ".imported.data"))).toBe(false);
  }, 120_000);

  it("maps the prototype's config columns as LLD §13.5 says", async () => {
    const project = scratch();
    await cli(["migrate", project, "--from-ade", DATABASE]);
    const config = parseYaml(readFileSync(join(project, "svatah.config.yaml"), "utf8")) as {
      project: string;
      app: { baseUrl: string };
      run: { workers: number; browser?: string; screenshots: string };
    };

    expect(config.project).toBe("Zoomcar regression");
    expect(config.app.baseUrl).toBe("http://localhost:4173");
    // `threadCount` → `workers`, `url` → `baseUrl`, `takeStepScreenshot` →
    // `screenshots`. The prototype's `takeStepScreenshot` is a boolean and
    // `screenshots` is a policy: `true` means every step, which is `always`.
    expect(config.run.workers).toBe(3);
    expect(config.run.screenshots).toBe("always");
    // Selenium's `chrome` is Playwright's `chromium`.
    expect(config.run.browser).toBe("chromium");
  }, 120_000);

  it("turns the JSON-in-a-column locators into seed bindings", async () => {
    const project = scratch();
    await cli(["migrate", project, "--from-ade", DATABASE]);
    const binding = parseYaml(
      readFileSync(join(project, "bindings", "migrated", "username.yaml"), "utf8"),
    ) as { phrases: string[]; entries: Array<{ candidates: Array<{ by: string }>; verified: boolean }> };

    // The dictionary's phrase, article and all: `the username`.
    expect(binding.phrases).toContain("the username");
    // `id:username & xpath://input[@id='username'] & css selector:#username` —
    // three alternatives, three candidates, in the order they were written.
    expect(binding.entries[0]!.candidates.map((one) => one.by)).toEqual(["id", "xpath", "css"]);
    // Nothing has been resolved against a live page (REQ-REC-1).
    expect(binding.entries[0]!.verified).toBe(false);
  }, 120_000);

  it("keeps a password out of data.yaml, as an ordinary migration does", async () => {
    const project = scratch();
    await cli(["migrate", project, "--from-ade", DATABASE]);
    const data = readFileSync(join(project, "data.yaml"), "utf8");
    expect(data).toContain("${SVATAH_PASSWORD}");
    expect(data).not.toContain("qwerty123");
    expect(data).toMatch(/secrets:/);
  }, 120_000);

  it("compiles clean, which is T6.6's Validate", async () => {
    const project = scratch();
    await cli(["migrate", project, "--from-ade", DATABASE]);

    const compile = await cli(["compile", "."], project);
    expect(compile.code, compile.output).toBe(EXIT.ok);
    // A warning is allowed and expected: `${SVATAH_PASSWORD}` is unset, which
    // matters at run time and not at compile time. An *error* is not.
    expect(compile.output).not.toMatch(/\berror\b/);
  }, 180_000);

  it("preserves every story name and step count from the legacy flows", async () => {
    /*
     * The other half of T6.6's Validate, and the reason the fixture carries the
     * *real* legacy files: the counts are compared against the originals rather
     * than against a number written down here.
     */
    const project = scratch();
    await cli(["migrate", project, "--from-ade", DATABASE]);
    await cli(["compile", "."], project);

    const plan = JSON.parse(readFileSync(join(project, ".svatah", "plan.json"), "utf8")) as Plan;
    const compiled = new Map(plan.stories.map((one) => [one.name, one.steps.length]));

    let checked = 0;
    for (const name of ["simple", "svatah", "natural_language_login", "execution"]) {
      // `readLegacyFlow(text, file)`: the file name is what its diagnostics cite.
      const legacy = readLegacyFlow(
        readFileSync(join(LEGACY, `${name}.flow`), "utf8"),
        `${name}.flow`,
      );
      for (const block of legacy.blocks) {
        // A `compose:` or `test:` block names stories; it is not one.
        if (block.kind === "compose" || block.kind === "test") continue;
        const expected = block.steps.filter((step) => !step.commented).length;
        expect(compiled.has(block.name), `${name}: "${block.name}" is missing`).toBe(true);
        expect(compiled.get(block.name), `${name}: "${block.name}"`).toBe(expected);
        checked += 1;
      }
    }
    expect(checked).toBe(14);
  }, 180_000);

  it("says which tables it deliberately did not import", async () => {
    const project = scratch();
    await cli(["migrate", project, "--from-ade", DATABASE]);
    const review = readFileSync(join(project, "migration-review.md"), "utf8");

    // REQ-ADE-9: "Results and screenshots from the prototype are not imported."
    // The database has both, and the report names them rather than the import
    // passing over them in silence.
    expect(review).toContain("results");
    expect(review).toContain("images");
    expect(existsSync(join(project, "runs"))).toBe(false);
    expect(review).toMatch(/deliberately left behind/i);
  }, 120_000);

  it("imports the project you name when the database holds several", async () => {
    const project = scratch();
    const result = await cli(["migrate", project, "--from-ade", DATABASE, "--project", "Smoke"]);
    expect(result.code, result.output).toBe(EXIT.ok);

    const config = parseYaml(readFileSync(join(project, "svatah.config.yaml"), "utf8")) as {
      project: string;
      run: { browser?: string };
    };
    expect(config.project).toBe("Smoke");
    // Its browser is `internet explorer`, which has no Playwright equivalent, so
    // the setting is left out rather than passed through to fail at run time.
    expect(config.run.browser).toBeUndefined();
    expect(readFileSync(join(project, "migration-review.md"), "utf8")).toContain(
      "no Playwright equivalent",
    );
  }, 120_000);

  it("refuses a name the database does not hold, and says what it does", async () => {
    const project = scratch();
    const result = await cli(["migrate", project, "--from-ade", DATABASE, "--project", "Nope"]);
    expect(result.code).not.toBe(EXIT.ok);
    expect(result.output).toContain("Zoomcar regression");
    expect(result.output).toContain("Smoke");
  }, 120_000);
});
