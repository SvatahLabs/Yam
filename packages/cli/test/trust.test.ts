/**
 * A project's own code runs only where somebody said it may (SF-15).
 *
 * `steps/` is code and loading a project imports it, so opening a repository
 * somebody else wrote used to run their code before anything had been asked.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadProject } from "../src/project.js";
import { projectTrust, revokeProject, trustedProjects, trustProject } from "../src/trust.js";

const saved = { CI: process.env["CI"], YAM_TRUST_PROJECT: process.env["YAM_TRUST_PROJECT"], YAM_TRUST_STORE: process.env["YAM_TRUST_STORE"] };
let dir: string;

/**
 * A temporary directory by its real path.
 *
 * `mkdtempSync` answers the short form on the Windows runner —
 * `C:\Users\RUNNER~1\…` — and a `~` in a path is percent-encoded by
 * `pathToFileURL`, which the test runner's own loader then cannot find. The
 * product imports the same file through Node and does not care; the test does.
 */
function temporaryDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

/** A project whose one step file writes a marker when it is imported. */
function projectWithCode(): { root: string; marker: string } {
  const root = temporaryDir("yam-trust-");
  const marker = join(root, "ran.txt");
  mkdirSync(join(root, "steps"), { recursive: true });
  mkdirSync(join(root, "flows"), { recursive: true });
  writeFileSync(join(root, "yam.config.yaml"), 'project: trust\napp:\n  baseUrl: "http://localhost:3000"\n', "utf8");
  writeFileSync(
    join(root, "steps", "mark.mjs"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport const nothing = 1;\n`,
    "utf8",
  );
  return { root, marker };
}

beforeEach(() => {
  dir = temporaryDir("yam-trust-store-");
  process.env["YAM_TRUST_STORE"] = join(dir, "trusted.json");
  delete process.env["CI"];
  delete process.env["YAM_TRUST_PROJECT"];
});

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("a project's step code (SF-15)", () => {
  it("is not run until the project is trusted, and the project says why", async () => {
    const { root, marker } = projectWithCode();
    const loaded = await loadProject(root);
    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(false);
    const untrusted = loaded.diagnostics.find((one) => one.code === ("W_STEP_UNTRUSTED" as never));
    expect(untrusted?.message).toContain(`yam trust ${root}`);
    // A warning: a project whose flows use no custom step still compiles and runs.
    expect(untrusted?.severity).toBe("warning");
    expect(projectTrust(root).because).toBe("untrusted");

    trustProject(root);
    expect(projectTrust(root).because).toBe("store");
    const trusted = await loadProject(root);
    // The diagnostics, so a load that did not import says why rather than
    // failing as a bare "expected false to be true".
    expect(existsSync(marker), JSON.stringify(trusted.diagnostics)).toBe(true);
  });

  it("is trusted by CI and by YAM_TRUST_PROJECT, and YAM_TRUST_PROJECT=0 wins over CI", () => {
    const { root } = projectWithCode();
    process.env["CI"] = "0";
    expect(projectTrust(root).runsCode).toBe(false);
    process.env["CI"] = "true";
    expect(projectTrust(root).because).toBe("CI");
    // Not for a process whose environment an agent host set.
    expect(projectTrust(root, { honourCi: false }).runsCode).toBe(false);
    process.env["YAM_TRUST_PROJECT"] = "0";
    expect(projectTrust(root).runsCode).toBe(false);
    process.env["YAM_TRUST_PROJECT"] = "1";
    expect(projectTrust(root).because).toBe("YAM_TRUST_PROJECT");
  });

  it("needs no trust when there is no code, and can be revoked", () => {
    const empty = temporaryDir("yam-trust-empty-");
    expect(projectTrust(empty)).toEqual({ runsCode: true, because: "no-code", code: [] });
    const { root } = projectWithCode();
    const stored = trustProject(root);
    expect(trustedProjects()).toContain(stored);
    expect(revokeProject(root)).toBe(true);
    expect(revokeProject(root)).toBe(false);
    expect(projectTrust(root).runsCode).toBe(false);
  });
});

describe("what an untrusted project would start (SF-15)", () => {
  it("counts a launched program and a Playwright config as code, and refuses to run them", async () => {
    const { untrustedRun } = await import("../src/project.js");
    const root = temporaryDir("yam-trust-launch-");
    mkdirSync(join(root, "flows"), { recursive: true });
    writeFileSync(
      join(root, "yam.config.yaml"),
      'project: launch\nadapter: uia\napp:\n  launch:\n    path: "/opt/evil/launcher"\n',
      "utf8",
    );
    writeFileSync(join(root, "playwright.config.ts"), "export default {};\n", "utf8");
    const loaded = await loadProject(root);
    expect(loaded.trust.runsCode).toBe(false);
    /*
     * The config's path as this platform resolves it, against the project
     * rather than the process: `/opt/evil/launcher` is `C:\opt\evil\launcher`
     * for a project on C:, and the Windows runner's own checkout is on D:.
     */
    const launcher = resolve(root, "/opt/evil/launcher");
    expect(loaded.trust.code).toEqual(expect.arrayContaining(["playwright.config.ts", `app.launch: ${launcher}`]));
    expect(untrustedRun(loaded)).toContain(launcher);
    expect(untrustedRun(loaded, "playwright")).toMatch(/playwright\.config\.ts/);
    trustProject(root);
    expect(untrustedRun(await loadProject(root))).toBeUndefined();
  });

  it("asks the status with the project's own steps directory", async () => {
    const root = temporaryDir("yam-trust-lib-");
    mkdirSync(join(root, "lib"), { recursive: true });
    mkdirSync(join(root, "flows"), { recursive: true });
    writeFileSync(join(root, "yam.config.yaml"), "project: lib\nsteps:\n  dir: lib\n", "utf8");
    writeFileSync(join(root, "lib", "one.mjs"), "export const x = 1;\n", "utf8");
    const { trustCommand } = await import("../src/commands/trust.js");
    const out: string[] = [];
    const code = await trustCommand(
      { command: ["trust", root], options: { status: true, json: true }, rest: [] },
      { out: (text: string) => out.push(text), err: () => undefined },
    );
    expect(code).toBe(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ runsCode: false, code: ["lib/one.mjs"] });
  });

  it("answers about the directory given after --status, not the current one", async () => {
    const { root } = projectWithCode();
    const { parseArgs } = await import("@svatah/yam-bindings-cli");
    const { trustCommand } = await import("../src/commands/trust.js");
    const out: string[] = [];
    const code = await trustCommand(parseArgs(["trust", "--status", root, "--json"]), {
      out: (text: string) => out.push(text),
      err: () => undefined,
    });
    expect(code).toBe(1);
    expect(JSON.parse(out[0]!)).toMatchObject({ root, runsCode: false, code: ["steps/mark.mjs"] });
  });
});
