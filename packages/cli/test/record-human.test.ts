/**
 * T14.8 — the human gateway (REQ-REC-12, LLD §11).
 *
 * A person is the grounder: the driven session's overlay asks for a click at
 * each unbound target. Here the click is scripted through `YAM_PICK`, module
 * (a)'s test affordance, so the path runs headless; the binding that results
 * says a person chose it, and verifies like any other.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";
import type { BindingFile } from "@svatah/yam-schema";
import { humanGateway, personCanPick } from "../src/gateway-for.js";
import { DIAGNOSTICS } from "../src/diagnostics.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");
let app: SampleServer;

beforeAll(async () => {
  app = await startSampleApp(0);
});
afterAll(async () => {
  await app?.close();
});

function scaffold(flow: string, adapter = "playwright"): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-human-"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(join(dir, "flows", "one.flow"), flow, "utf8");
  writeFileSync(
    join(dir, "yam.config.yaml"),
    `schemaVersion: "1.0.0"\nproject: "human-test"\nadapter: ${adapter}\napp: { baseUrl: "${app.origin}" }\nbindings: { dir: bindings, testIdAttributes: ["data-testid"] }\nrun: { headless: true, stepTimeoutMs: 10000, candidateTimeoutMs: 2000 }\n`,
    "utf8",
  );
  return dir;
}

function cli(args: readonly string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", CI: "true", ...env },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("exit", (code) => done({ code: code ?? 1, output }));
  });
}

describe("yam record --gateway human (REQ-REC-12)", () => {
  it("binds a target from a person's click, with human provenance, and the binding verifies", async () => {
    const dir = scaffold('story: One\n  Go to "/login"\n  Click the sign in button\n\ntest: One\n');
    const { code, output } = await cli(["record", ".", "--gateway", "human"], dir, {
      YAM_PICK: JSON.stringify({ "sign-in-button": "login-submit" }),
    });
    expect(output).toContain("recording as a person");
    expect(code).toBe(EXIT.ok);
    const file = join(dir, "bindings", "sign-in-button.yaml");
    expect(existsSync(file)).toBe(true);
    const binding = parseYaml(readFileSync(file, "utf8")) as BindingFile;
    const entry = binding.entries[0]!;
    expect(entry.provenance?.model).toBe("human");
    expect(entry.provenance?.promptVersion).toBe("pick");
    expect(entry.verified).toBe(true);
    expect(entry.candidates.some((one) => one.by === "testid")).toBe(true);
  }, 120_000);

  it("stops the session when the person presses Escape (nothing picked), writing nothing", async () => {
    const dir = scaffold('story: One\n  Go to "/login"\n  Click the sign in button\n\ntest: One\n');
    // A scripted pick that names an element the page does not have is what an
    // Escape looks like to the recorder: no reference came back.
    const { code, output } = await cli(["record", ".", "--gateway", "human"], dir, {
      YAM_PICK: JSON.stringify({ "sign-in-button": "no-such-test-id" }),
    });
    expect(code).not.toBe(EXIT.ok);
    expect(output).toContain("Nothing was picked");
    expect(existsSync(join(dir, "bindings", "sign-in-button.yaml"))).toBe(false);
  }, 120_000);

  it("refuses on an adapter that cannot take a click, naming it", async () => {
    const dir = scaffold('story: One\n  Go to "/login"\n\ntest: One\n', "http");
    const { code, output } = await cli(["record", ".", "--gateway", "human"], dir);
    expect(code).toBe(EXIT.usage);
    expect(output).toContain("The http adapter cannot take a click.");
    expect(output).toContain("--gateway anthropic");
  }, 60_000);

  it("is the default only for a person at a terminal with a display and no CI", () => {
    expect(personCanPick({ CI: "" }, true)).toBe(process.platform !== "linux");
    expect(personCanPick({ CI: "true" }, true)).toBe(false);
    expect(personCanPick({}, false)).toBe(false);
    expect(personCanPick({ DISPLAY: ":0" }, true)).toBe(true);
    expect(humanGateway().real).toBe(false);
    expect(DIAGNOSTICS.some((one) => one.code === "no-display")).toBe(true);
  });

  it("under CI with no gateway named, still refuses and names fake and the credential", async () => {
    const dir = scaffold('story: One\n  Go to "/login"\n\ntest: One\n');
    const { code, output } = await cli(["record", ".", "--all"], dir);
    expect(code).toBe(EXIT.modelUnavailable);
    expect(output).toContain("--gateway fake");
  }, 60_000);
});
