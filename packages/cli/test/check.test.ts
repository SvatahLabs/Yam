/**
 * T14.2 — `check`, the plan's currency, `heal` on the last run, and the reason
 * under a failed step (REQ-CLI-3, REQ-CLI-6).
 */
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { noteCheck, planStaleness, reasonFor, writeLastRun } from "../src/front-door.js";
import { loadProject } from "../src/project.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

function fixtureCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-check-"));
  cpSync(FIXTURES, dir, {
    recursive: true,
    filter: (source) => !source.startsWith(join(FIXTURES, "runs")) && !source.startsWith(join(FIXTURES, ".yam")),
  });
  rmSync(join(dir, "runs"), { recursive: true, force: true });
  rmSync(join(dir, ".yam"), { recursive: true, force: true });
  return dir;
}

describe("yam check (REQ-CLI-3)", () => {
  it("lints and compiles in one verb and says what it wrote", async () => {
    const dir = fixtureCopy();
    const { code, err } = await cli("check", dir);
    expect(code).toBe(EXIT.ok);
    expect(err).toMatch(/plan written: \d+ steps, tier 0 \d+, tier 1 \d+, tier 2 \d+, tier 3 \d+ → /);
    expect(existsSync(join(dir, ".yam", "plan.json"))).toBe(true);
    expect(existsSync(join(dir, ".yam", "plan.inputs.json"))).toBe(true);
    expect(planStaleness(await loadProject(dir))).toBe("current");
  });

  it("an edited flow makes the plan stale, and run says it checked", async () => {
    const dir = fixtureCopy();
    await cli("check", dir);
    const flow = join(dir, "flows", "simple.flow");
    writeFileSync(flow, `${readFileSync(flow, "utf8")}\n// edited\n`, "utf8");
    const loaded = await loadProject(dir);
    expect(planStaleness(loaded)).toBe("stale");
    const lines: string[] = [];
    noteCheck(loaded, { out: () => undefined, err: (text) => lines.push(text) });
    expect(lines).toEqual(["plan was stale; checked"]);
  });

  it("--no-check on a stale plan is the stale-plan diagnostic, naming check", async () => {
    const dir = fixtureCopy();
    await cli("check", dir);
    const flow = join(dir, "flows", "simple.flow");
    writeFileSync(flow, `${readFileSync(flow, "utf8")}\n// edited\n`, "utf8");
    const { code, err } = await cli("run", dir, "--host", "none", "--no-check");
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("The plan is older than the flows.");
    expect(err).toContain("yam check");
    expect(existsSync(join(dir, "runs"))).toBe(false);
  });

  it("--no-check with no plan names check too", async () => {
    const dir = fixtureCopy();
    const { code, err } = await cli("run", dir, "--host", "none", "--no-check");
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("There is no plan yet.");
    expect(err).toContain("yam check");
  });
});

describe("yam heal with no arguments (REQ-CLI-6)", () => {
  it("names run when there is no run to heal", async () => {
    const dir = fixtureCopy();
    const { code, err } = await cli("heal", "--project", dir);
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("There is no run to heal yet.");
    expect(err).toContain("yam run");
  });

  it("heals the run .yam/last-run names", async () => {
    const dir = fixtureCopy();
    const runDir = join(dir, "runs", "last123");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "results.jsonl"), "", "utf8");
    writeLastRun(dir, { runId: "last123", directory: join("runs", "last123") });
    const { err } = await cli("heal", "--project", dir, "--runs", join(dir, "runs"));
    expect(err).toContain("healing the last run, last123");
  });
});

describe("the reason under a failed step", () => {
  it("names record for a missing binding, heal for a binding that stopped resolving", () => {
    expect(reasonFor({ class: "locator", message: "No binding for `the username field` (login.username-field)." })).toEqual({
      message: "No binding for `the username field` (login.username-field).",
      next: "yam record",
    });
    expect(reasonFor({ class: "locator", message: 'Could not resolve "x": 3 candidates tried, none matched exactly one element.\n  detail' }).next).toBe("yam heal");
  });
  it("names the variable for an unset secret, the browser install for a missing browser, nothing for an assertion", () => {
    expect(reasonFor({ class: "data", message: "user.password reads ${YAM_INPUT_PASSWORD}, which is not set." }).next).toContain("export YAM_INPUT_PASSWORD=");
    expect(reasonFor({ class: "infrastructure", message: "browserType.launch: Executable doesn't exist at /x/chromium" }).next).toBe("npx playwright install chromium");
    expect(reasonFor({ class: "assertion", message: "expected visible" }).next).toBeUndefined();
  });
});
