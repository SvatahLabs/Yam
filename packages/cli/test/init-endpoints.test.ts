/**
 * Draft 2.22 (REQ-CLI-11) — a project is configured, not assumed: `yam init`
 * takes the local endpoint and any remote ones, and `--endpoint` selects one
 * everywhere the config is read.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { EXIT, loadConfig } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { parseEndpoint, renderConfig } from "../src/commands/init.js";
import { projectState } from "../src/front-door.js";

async function cli(argv: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string; err: string }> {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let out = "";
  let err = "";
  try {
    const code = await main(argv, { out: (t) => (out += `${t}\n`), err: (t) => (err += `${t}\n`) });
    return { code, out, err };
  } finally {
    process.env = saved;
  }
}

describe("yam init configures the project (REQ-CLI-11)", () => {
  it("never points a new project at the sample application", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-init-ep-"));
    const { code, err } = await cli(["init", dir, "--yes"]);
    expect(code).toBe(EXIT.ok);
    const config = readFileSync(join(dir, "yam.config.yaml"), "utf8");
    expect(config).not.toContain("4173");
    expect(config).toContain("set this to where your application runs");
    expect(err).toContain("set app.baseUrl");
    expect(readFileSync(join(dir, "flows", "front-page.flow"), "utf8")).toContain('Go to "/"');
  });

  it("takes the local URL and the remote endpoints from the flags", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-init-ep-"));
    const { code, err } = await cli([
      "init", dir, "--name", "planner", "--url", "http://localhost:3000",
      "--endpoint", "staging=https://staging.planner.example@staging",
      "--endpoint", "production=https://planner.example@production",
    ]);
    expect(code).toBe(EXIT.ok);
    const config = parseYaml(readFileSync(join(dir, "yam.config.yaml"), "utf8")) as {
      project: string; app: { baseUrl: string }; endpoints: Record<string, { baseUrl: string; environment: string }>;
    };
    expect(config.project).toBe("planner");
    expect(config.app.baseUrl).toBe("http://localhost:3000");
    expect(config.endpoints["staging"]).toEqual({ baseUrl: "https://staging.planner.example", environment: "staging" });
    expect(config.endpoints["production"]).toEqual({ baseUrl: "https://planner.example", environment: "production" });
    expect(err).toContain("endpoints: staging, production (--endpoint <name>)");
    expect((await cli(["lint", dir])).code).toBe(EXIT.ok);
  });

  it("refuses a malformed --endpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-init-ep-"));
    const { code, err } = await cli(["init", dir, "--url", "http://localhost:3000", "--endpoint", "nonsense"]);
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("name=url");
  });

  it("parses name=url and name=url@kind", () => {
    expect(parseEndpoint("staging=https://s.example")).toEqual({ name: "staging", baseUrl: "https://s.example", environment: "test" });
    expect(parseEndpoint("prod=https://p.example@production")?.environment).toBe("production");
    expect(parseEndpoint("bad")).toBeUndefined();
    expect(renderConfig({ name: "x", adapter: "playwright", endpoints: [] })).toContain("# endpoints:");
  });
});

describe("--endpoint selects an endpoint everywhere the config is read", () => {
  const project = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "yam-endpoint-"));
    writeFileSync(join(dir, "yam.config.yaml"), [
      'schemaVersion: "1.0.0"',
      'project: "planner"',
      "environment: test",
      "adapter: playwright",
      'app: { baseUrl: "http://localhost:3000" }',
      "endpoints:",
      '  staging: { baseUrl: "https://staging.example", environment: staging }',
      '  production: { baseUrl: "https://example.com", environment: production, storageState: "prod-state.json" }',
      "",
    ].join("\n"), "utf8");
    return dir;
  };

  it("applies the endpoint's base URL, storage state and environment kind", () => {
    const dir = project();
    expect(loadConfig(dir, {}).config.app.baseUrl).toBe("http://localhost:3000");
    const staging = loadConfig(dir, { YAM_ENDPOINT: "staging" }).config;
    expect(staging.app.baseUrl).toBe("https://staging.example");
    expect(staging.environment).toBe("staging");
    const production = loadConfig(dir, { YAM_ENDPOINT: "production" }).config;
    expect(production.app.baseUrl).toBe("https://example.com");
    expect(production.app.storageState).toBe("prod-state.json");
    expect(production.environment).toBe("production");
    expect(production.endpoint).toBe("production");
  });

  it("names the endpoints it knows when asked for one it does not", () => {
    const dir = project();
    expect(() => loadConfig(dir, { YAM_ENDPOINT: "qa" })).toThrow(/No endpoint named "qa"; the config declares "staging", "production"/);
  });

  it("the flag reaches the front door, which shows the endpoint", async () => {
    const dir = project();
    const { code, out } = await cli(["status", dir, "--endpoint", "staging", "--json"], { YAM_ENDPOINT: undefined });
    expect(code).toBe(EXIT.ok);
    const state = JSON.parse(out) as { endpoint: { name: string; baseUrl: string; environment: string; others: string[] } };
    expect(state.endpoint).toEqual({ name: "staging", baseUrl: "https://staging.example", environment: "staging", others: ["production"] });
    const text = await cli(["status", dir], { YAM_ENDPOINT: undefined });
    expect(text.out).toContain("app       http://localhost:3000 · test (also: staging, production)");
    const state2 = await projectState(dir);
    expect(state2.endpoint?.others).toEqual(["staging", "production"]);
  });
});
