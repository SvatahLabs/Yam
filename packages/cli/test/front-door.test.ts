/**
 * T14.1 — `yam` says where you are and what is next (REQ-CLI-1, LLD §15.1).
 *
 * One test per state, in the order the next verb is decided, each asserting
 * the verb; then the two the task names on real projects, and the JSON form.
 */
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { findProjectRoot, nextVerb, projectState, type ProjectState } from "../src/front-door.js";

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

const empty = (): string => mkdtempSync(join(tmpdir(), "yam-front-door-"));

/** A copy of the fixture project, without its runs, in a temporary directory. */
function fixtureCopy(): string {
  const dir = empty();
  cpSync(FIXTURES, dir, {
    recursive: true,
    filter: (source) => !source.includes(`${join(FIXTURES, "runs")}`) && !source.includes(`${join(FIXTURES, ".yam")}`),
  });
  rmSync(join(dir, "runs"), { recursive: true, force: true });
  rmSync(join(dir, ".yam"), { recursive: true, force: true });
  return dir;
}

const base: ProjectState = {
  project: { root: "/p", name: "p" },
  flows: { files: 1, stories: 1, errors: 0 },
  plan: "current",
  unbound: [],
  proposals: [],
};

describe("the next verb, in LLD §15.1's order", () => {
  it("no project → init", () => {
    expect(nextVerb({ flows: { files: 0, stories: 0, errors: 0 }, plan: "missing", unbound: [], proposals: [] }).verb).toBe("yam init");
  });
  it("read errors → check", () => {
    expect(nextVerb({ ...base, flows: { files: 1, stories: 1, errors: 2 } }).verb).toBe("yam check");
    expect(nextVerb({ ...base, problem: "bad yaml" }).verb).toBe("yam check");
  });
  it("a proposal waiting → review it, before the plan is looked at", () => {
    const next = nextVerb({ ...base, plan: "missing", proposals: ["2026-09-07T10-00-00"] });
    expect(next.verb).toBe("review proposals/2026-09-07T10-00-00");
  });
  it("no flows → write a flow", () => {
    expect(nextVerb({ ...base, flows: { files: 0, stories: 0, errors: 0 } }).verb).toBe("write a flow");
  });
  it("plan missing or stale → check", () => {
    expect(nextVerb({ ...base, plan: "missing" }).verb).toBe("yam check");
    expect(nextVerb({ ...base, plan: "stale" }).verb).toBe("yam check");
  });
  it("unbound targets → record, naming the first phrase", () => {
    const next = nextVerb({ ...base, unbound: [{ id: "login.username-field", phrase: "the username field" }] });
    expect(next.verb).toBe("yam record --all");
    expect(next.because).toContain("the username field");
  });
  it("a locator failure → heal", () => {
    expect(
      nextVerb({
        ...base,
        lastRun: { runId: "r", verdict: "failed", passed: 1, failed: 1, skipped: 0, failureClass: "locator", failedStep: "Sign in · Click" },
      }).verb,
    ).toBe("yam heal");
  });
  it("any other failure → run, naming the step", () => {
    const next = nextVerb({
      ...base,
      lastRun: { runId: "r", verdict: "failed", passed: 1, failed: 1, skipped: 0, failureClass: "assertion", failedStep: "Sign in · The heading" },
    });
    expect(next.verb).toBe("yam run");
    expect(next.because).toContain("Sign in · The heading");
  });
  it("no run yet → run", () => {
    expect(nextVerb(base).verb).toBe("yam run");
  });
  it("healed → heal, to review the repair", () => {
    expect(nextVerb({ ...base, lastRun: { runId: "r", verdict: "healed", passed: 2, failed: 0, skipped: 0 } }).verb).toBe("yam heal");
  });
  it("green → run", () => {
    const next = nextVerb({ ...base, lastRun: { runId: "r", verdict: "passed", passed: 2, failed: 0, skipped: 0 } });
    expect(next.verb).toBe("yam run");
    expect(next.because).toContain("Green");
  });
});

describe("`yam` with no arguments (REQ-CLI-1)", () => {
  it("in an empty directory exits 0 and names init", async () => {
    const dir = empty();
    const { code, out } = await cli("status", dir);
    expect(code).toBe(EXIT.ok);
    expect(out).toContain("No Yam project here.");
    expect(out).toContain("yam init");
  });

  it("finds the project from a directory below it", () => {
    const dir = fixtureCopy();
    mkdirSync(join(dir, "flows", "deeper"), { recursive: true });
    expect(findProjectRoot(join(dir, "flows", "deeper"))).toBe(dir);
    expect(findProjectRoot(empty())).toBeUndefined();
  });

  it("on the fixture project: check when there is no plan, run once it is current, record after a binding is removed", async () => {
    const dir = fixtureCopy();

    let state = await projectState(dir);
    expect(state.project?.name).toBe("yam-fixtures");
    expect(state.flows.stories).toBeGreaterThan(0);
    expect(state.plan).toBe("missing");
    expect(nextVerb(state).verb).toBe("yam check");

    expect((await cli("compile", dir)).code).toBe(EXIT.ok);
    expect(existsSync(join(dir, ".yam", "plan.inputs.json"))).toBe(true);
    state = await projectState(dir);
    expect(state.plan).toBe("current");
    expect(state.unbound).toEqual([]);
    expect(nextVerb(state).verb).toBe("yam run");

    // Editing a flow makes the plan stale.
    const flow = join(dir, "flows", "simple.flow");
    writeFileSync(flow, `${readFileSync(flow, "utf8")}\n// edited\n`, "utf8");
    state = await projectState(dir);
    expect(state.plan).toBe("stale");
    expect(nextVerb(state).verb).toBe("yam check");
    expect((await cli("compile", dir)).code).toBe(EXIT.ok);

    // Removing a binding leaves a target unbound.
    const binding = join(dir, "bindings", "home", "sign-in-button.yaml");
    expect(existsSync(binding)).toBe(true);
    rmSync(binding);
    state = await projectState(dir);
    expect(state.plan).toBe("current");
    expect(state.unbound.map((one) => one.id)).toContain("home.sign-in-button");
    const next = nextVerb(state);
    expect(next.verb).toBe("yam record --all");

    const { code, out } = await cli("status", dir);
    expect(code).toBe(EXIT.ok);
    expect(out).toContain("yam-fixtures");
    expect(out).toContain("next      yam record");
  });

  it("--json round-trips the state with its next step", async () => {
    const dir = fixtureCopy();
    const { code, out } = await cli("status", dir, "--json");
    expect(code).toBe(EXIT.ok);
    const parsed = JSON.parse(out) as ProjectState & { next: { verb: string; because: string } };
    expect(parsed.project?.name).toBe("yam-fixtures");
    expect(parsed.plan).toBe("missing");
    expect(parsed.next.verb).toBe("yam check");
  });
});
