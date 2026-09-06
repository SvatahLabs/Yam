/**
 * Draft 2.23 (REQ-REC-13) — `yam record` alone records a flow from what a
 * person does. The person is scripted through `YAM_OBSERVE`, the adapter's
 * test affordance, which performs the actions through Playwright so the
 * in-page observer sees the same events a person's hands would make.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";
import type { BindingFile } from "@svatah/yam-schema";
import { flowFileFor, personCanDrive } from "../src/commands/capture.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");
let app: SampleServer;

beforeAll(async () => {
  app = await startSampleApp(0);
});
afterAll(async () => {
  await app?.close();
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-capture-"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(
    join(dir, "yam.config.yaml"),
    `schemaVersion: "1.0.0"\nproject: "capture-test"\nadapter: playwright\napp: { baseUrl: "${app.origin}" }\nbindings: { dir: bindings, testIdAttributes: ["data-testid"] }\nrun: { headless: true, stepTimeoutMs: 10000, candidateTimeoutMs: 2000 }\n`,
    "utf8",
  );
  return dir;
}

function cli(args: readonly string[], cwd: string, env: Record<string, string> = {}): Promise<{ code: number; output: string }> {
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "", CI: "true", YAM_OBSERVE: "", ...env },
    });
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("exit", (code) => done({ code: code ?? 1, output }));
  });
}

describe("yam record records a flow from what a person does (REQ-REC-13)", () => {
  it("writes the sentences, the bindings and a secret input, and the flow checks and replays", async () => {
    const dir = project();
    const actions = [
      { action: "goto", url: "/login" },
      { action: "fill", selector: "[data-testid=username]", value: "someone@example.com" },
      { action: "fill", selector: "[data-testid=password]", value: "secret-1" },
      { action: "click", selector: "[data-testid=login-submit]" },
    ];
    const { code, output } = await cli(["record", ".", "--name", "Sign in"], dir, { YAM_OBSERVE: JSON.stringify(actions) });
    expect(output, output).toContain("wrote flows/sign-in.flow");
    expect(code).toBe(EXIT.ok);

    const flow = readFileSync(join(dir, "flows", "sign-in.flow"), "utf8");
    expect(flow).toContain("story: Sign in");
    expect(flow).toContain("inputs: password: secret");
    expect(flow).toContain('Go to "/"');
    expect(flow).toContain('Go to "/login"');
    expect(flow).toContain('Type "someone@example.com" into the username field');
    expect(flow).toContain("Type {input.password} into the password field");
    expect(flow).toContain("Click the sign in button");
    expect(flow).not.toContain("secret-1");
    expect(flow).toContain("test: Sign in");

    const files = readdirSync(join(dir, "bindings", "login"));
    expect(files.sort()).toEqual(["password-field.yaml", "sign-in-button.yaml", "username-field.yaml"]);
    const binding = parseYaml(readFileSync(join(dir, "bindings", "login", "sign-in-button.yaml"), "utf8")) as BindingFile;
    expect(binding.id).toBe("login.sign-in-button");
    expect(binding.phrases).toEqual(["the sign in button"]);
    expect(binding.entries[0]?.provenance?.model).toBe("human");
    expect(binding.entries[0]?.provenance?.promptVersion).toBe("capture");
    expect(binding.entries[0]?.candidates.some((one) => one.by === "testid")).toBe(true);

    const checked = await cli(["check", "."], dir);
    expect(checked.output).toContain("plan written");
    expect(checked.code).toBe(EXIT.ok);
    const ran = await cli(["run", ".", "--no-check", "--input", "password=secret-1"], dir);
    expect(ran.output, ran.output).toMatch(/passed, 0 failed/);
    expect(ran.code).toBe(EXIT.ok);
  }, 180_000);

  it("refuses without a person at a terminal, and names the other way in", async () => {
    const dir = project();
    const { code, output } = await cli(["record", "."], dir);
    expect(code).toBe(EXIT.usage);
    expect(output).toContain("needs a person at a terminal");
    expect(output).toContain("yam record --flow <file>");
  }, 60_000);

  it("names flow files after the story without overwriting", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-capture-"));
    expect(flowFileFor(dir, "Sign in")).toBe("sign-in.flow");
    writeFileSync(join(dir, "sign-in.flow"), "", "utf8");
    expect(flowFileFor(dir, "Sign in")).toBe("sign-in-2.flow");
    expect(flowFileFor(dir, "???")).toBe("recorded.flow");
    expect(personCanDrive({ YAM_OBSERVE: "[]", CI: "true" })).toBe(true);
    expect(existsSync(join(dir, "sign-in.flow"))).toBe(true);
  });
});
