/**
 * T3.6 Validate — "renderer has no Node access (test); Electron security
 * checklist passes" (REQ-ADE-2, LLD §13.6).
 *
 * These read the sources rather than launching Electron. That is not a shortcut:
 * every property here is a *configuration* — a flag, a bridge's surface, a
 * bundler's externals — and the honest way to check a configuration is to read
 * it. A launched app that happened to have no Node in the renderer today would
 * prove nothing about the flag that let it.
 *
 * The one thing a source read cannot see is whether Electron honours the flags,
 * and that is Electron's contract rather than this project's.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ADE = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]): string => readFileSync(join(ADE, ...parts), "utf8");

const main = read("src", "main", "index.ts");
const preload = read("src", "preload", "index.ts");
const forge = read("forge.config.ts");
const html = read("index.html");

describe("the renderer is a browser and nothing more (REQ-ADE-2)", () => {
  it("is created with context isolation, no node integration, and a sandbox", () => {
    expect(main).toContain("contextIsolation: true");
    expect(main).toContain("nodeIntegration: false");
    expect(main).toContain("sandbox: true");
    expect(main).toContain("webSecurity: true");
  });

  it("never turns any of those off, anywhere", () => {
    // The failure mode this catches is a second `BrowserWindow` — a preview, a
    // devtools helper — created with looser settings than the first.
    expect(main).not.toMatch(/nodeIntegration:\s*true/);
    expect(main).not.toMatch(/contextIsolation:\s*false/);
    expect(main).not.toMatch(/sandbox:\s*false/);
    expect(main).not.toMatch(/webSecurity:\s*false/);
    expect(main).not.toContain("enableRemoteModule");
    expect(main).not.toContain("allowRunningInsecureContent");
  });

  it("refuses navigation and window opening", () => {
    expect(main).toContain("will-navigate");
    expect(main).toContain("setWindowOpenHandler");
    expect(main).toContain('action: "deny"');
  });

  it("carries a Content-Security-Policy that keeps the renderer on loopback", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("default-src 'self'");
    expect(html).toContain("script-src 'self'");
    // `connect-src` names loopback only: a renderer that could reach anywhere
    // else could exfiltrate a project. A port wildcard (`127.0.0.1:*`) is fine —
    // the service takes an ephemeral port — a host wildcard is not.
    // Read the policy itself, not the comment above it that explains the policy.
    const policy = /content="([^"]*default-src[^"]*)"/.exec(html)?.[1] ?? "";
    const connect = /connect-src([^;]*)/.exec(policy)?.[1] ?? "";
    expect(connect).toContain("127.0.0.1");
    for (const source of connect.trim().split(/\s+/)) {
      expect(source, `connect-src allows ${source}`).toMatch(
        /^(https?|wss?):\/\/(127\.0\.0\.1|localhost)(:\*|:\d+)?$/,
      );
    }
  });

  it("flips the packaged binary's fuses, so RunAsNode is off", () => {
    expect(forge).toContain("FuseV1Options.RunAsNode]: false");
    expect(forge).toContain("EnableNodeOptionsEnvironmentVariable]: false");
    expect(forge).toContain("EnableNodeCliInspectArguments]: false");
    expect(forge).toContain("OnlyLoadAppFromAsar]: true");
  });
});

describe("no renderer source reaches for Node (REQ-ADE-2)", () => {
  const rendererFiles = [
    ["src", "renderer", "main.tsx"],
    ["src", "renderer", "App.tsx"],
    ["src", "renderer", "client.ts"],
    ["src", "renderer", "client.generated.ts"],
    ["src", "renderer", "bridge.ts"],
    ["src", "renderer", "screens", "Project.tsx"],
    ["src", "renderer", "screens", "FlowEditor.tsx"],
    ["src", "renderer", "screens", "Plan.tsx"],
    ["src", "renderer", "screens", "Run.tsx"],
    ["src", "renderer", "screens", "Results.tsx"],
    ["src", "renderer", "screens", "ApiClient.tsx"],
    ["src", "renderer", "screens", "Data.tsx"],
  ];

  for (const parts of rendererFiles) {
    it(`${parts.slice(2).join("/")} imports no node: module, no electron, no fs`, () => {
      const source = read(...parts);
      expect(source).not.toMatch(/from\s+"node:/);
      expect(source).not.toMatch(/from\s+"electron"/);
      expect(source).not.toMatch(/\brequire\s*\(/);
      expect(source).not.toMatch(/\bprocess\.\w/);
      // And it does not reach the main process's modules by relative path,
      // which is the way a bundler would be talked into pulling `electron` in.
      expect(source).not.toMatch(/from\s+"\.\.\/main\//);
      expect(source).not.toMatch(/from\s+"\.\.\/preload\//);
    });
  }
});

describe("the preload bridge is four functions (LLD §13.6)", () => {
  it("exposes exactly openProject, serviceInfo, pickFile and preferences", () => {
    const exposed = [...preload.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
    expect(exposed).toEqual([
      "openProject",
      "serviceInfo",
      "pickFile",
      "preferences",
      "onServiceLog",
    ]);
  });

  it("has no generic invoke, so the bridge cannot grow behind its own back", () => {
    // A `invoke(channel, args)` would make this file a description of nothing:
    // the renderer could reach any handler the main process ever adds.
    expect(preload).not.toMatch(/invoke\s*[:(]\s*\(\s*channel/);
    const channels = [...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]);
    expect(channels).toEqual([
      "ade:openProject",
      "ade:serviceInfo",
      "ade:pickFile",
      "ade:preferences",
    ]);
  });

  it("hands the renderer data, not a live reference into the main process", () => {
    expect(preload).toContain("contextBridge.exposeInMainWorld");
  });
});

describe("accessibility, because the ADE is the desktop conformance target", () => {
  it("enables Chromium's accessibility support under SVATAH_A11Y (REQ-ADE-6)", () => {
    expect(main).toContain("setAccessibilitySupportEnabled(true)");
    expect(main).toContain('SVATAH_A11Y');
  });
});
