/**
 * T14.5 — the tmux workspace (REQ-TUI-2).
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { sessionNameFor, tmuxAvailable } from "../src/commands/workspace.js";
import { tailLine } from "../src/commands/runs.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");

async function cli(argv: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number; out: string; err: string }> {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
  let out = "";
  let err = "";
  try {
    const code = await main(argv, {
      out: (text) => (out += `${text}\n`),
      err: (text) => (err += `${text}\n`),
    });
    return { code, out, err };
  } finally {
    process.env = saved;
  }
}

function fixtureCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-ws-"));
  cpSync(FIXTURES, dir, { recursive: true, filter: (s) => !s.startsWith(join(FIXTURES, "runs")) && !s.startsWith(join(FIXTURES, ".yam")) });
  rmSync(join(dir, "runs"), { recursive: true, force: true });
  rmSync(join(dir, ".yam"), { recursive: true, force: true });
  return dir;
}

const sessions: string[] = [];
afterAll(() => {
  for (const one of sessions) spawnSync("tmux", ["kill-session", "-t", `=${one}`]);
});

describe("yam ui --tmux (REQ-TUI-2)", () => {
  it("names the session for the project", () => {
    expect(sessionNameFor("/tmp/My Project!")).toBe("yam-My-Project");
    expect(sessionNameFor("/")).toMatch(/^yam-/);
  });

  it.skipIf(!tmuxAvailable())("builds one session with the four panes over one service, and attaches rather than starting a second", async () => {
    const dir = fixtureCopy();
    const session = sessionNameFor(dir);
    sessions.push(session);
    const first = await cli(["workspace", dir, "--detach"], { EDITOR: "cat", YAM_SERVICE_URL: undefined, YAM_SERVICE_TOKEN: undefined });
    expect(first.code).toBe(EXIT.ok);
    expect(first.out.trim()).toBe(session);
    expect(first.err).toContain("the cockpit, a shell, the run's events, the editor");

    const panes = spawnSync("tmux", ["list-panes", "-t", `=${session}:yam`, "-F", "#{pane_start_command}"], { encoding: "utf8" }).stdout.trim().split("\n");
    expect(panes.length).toBe(4);
    expect(panes.some((one) => one.includes(" ui "))).toBe(true);
    expect(panes.some((one) => one.includes("runs tail"))).toBe(true);
    expect(panes.some((one) => one.includes("cat"))).toBe(true);
    expect(panes.filter((one) => one.trim() === "").length).toBe(1); // the shell

    const env = spawnSync("tmux", ["show-environment", "-t", `=${session}`], { encoding: "utf8" }).stdout;
    expect(env).toMatch(/^YAM_SERVICE_URL=http:\/\/127\.0\.0\.1:\d+$/m);
    expect(env).toMatch(/^YAM_SERVICE_TOKEN=\S+$/m);

    const serves = () => spawnSync("sh", ["-c", `pgrep -f "serve ${dir}" | wc -l`], { encoding: "utf8" }).stdout.trim();
    expect(serves()).toBe("1");

    const second = await cli(["ui", dir, "--tmux", "--detach"]);
    expect(second.code).toBe(EXIT.ok);
    expect(second.err).toContain(`attaching to the workspace ${session}`);
    expect(serves()).toBe("1");

    // The cockpit's quit ends the session: kill its pane and the session goes.
    spawnSync("tmux", ["kill-session", "-t", `=${session}`]);
    expect(spawnSync("tmux", ["has-session", "-t", `=${session}`]).status).not.toBe(0);
  }, 60_000);

  it.skipIf(!tmuxAvailable())("opens at the terminal's size, with the cockpit wide enough for its inspector", async () => {
    /*
     * `new-session -d` takes tmux's default 80×24, so the cockpit's pane after
     * the splits was 40 columns — under its own 60-column minimum, which is how
     * a fresh workspace came up truncated with the inspector collapsed
     * (Draft 2.24). The session is born at the terminal's size instead, and the
     * cockpit takes the larger half.
     */
    const dir = fixtureCopy();
    const session = sessionNameFor(dir);
    sessions.push(session);
    const { code } = await cli(["workspace", dir, "--detach"], {
      EDITOR: "",
      YAM_SERVICE_URL: undefined,
      YAM_SERVICE_TOKEN: undefined,
      COLUMNS: "220",
      LINES: "56",
    });
    expect(code).toBe(EXIT.ok);

    const size = (target: string, format: string): string =>
      spawnSync("tmux", ["display-message", "-p", "-t", target, format], { encoding: "utf8" }).stdout.trim();

    // A test's stdout is a pipe, so the command falls back to tmux's default:
    // what is asserted is the share, which is what left the inspector out.
    const width = Number(size(`=${session}:yam`, "#{window_width}"));
    const cockpit = Number(size(`=${session}:yam.0`, "#{pane_width}"));
    expect(width).toBeGreaterThan(0);
    expect(cockpit / width).toBeGreaterThan(0.5);
    spawnSync("tmux", ["kill-session", "-t", `=${session}`]);
  }, 60_000);

  it("without tmux, opens the cockpit alone and says so", async () => {
    const dir = fixtureCopy();
    const bin = mkdtempSync(join(tmpdir(), "yam-nopath-"));
    const { code, out, err } = await cli(["ui", dir, "--tmux", "--json"], { PATH: bin });
    expect(code).toBe(EXIT.ok);
    expect(err).toContain("needs tmux");
    expect(JSON.parse(out)).toBeTruthy();
  }, 60_000);
});

describe("yam runs tail", () => {
  it("refuses without a service to follow, naming the workspace", async () => {
    const { code, err } = await cli(["runs", "tail"], { YAM_SERVICE_URL: undefined, YAM_SERVICE_TOKEN: undefined });
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("yam ui --tmux");
  });

  it("prints one line per event in the run report's marks", () => {
    expect(tailLine({ kind: "run.started", runId: "r1" })).toBe("run r1 started");
    expect(tailLine({ kind: "step.result", result: { status: "passed", story: "Sign in", text: "Click the button" } })).toBe("  ✓ Sign in · Click the button");
    expect(tailLine({ kind: "step.result", result: { status: "failed", story: "Sign in", text: "Click", failure: { message: "No binding for `x` (a.b).\nmore" } } })).toBe("  ✗ Sign in · Click\n      No binding for `x` (a.b).");
    expect(tailLine({ kind: "run.summary", summary: { runId: "r1", totals: { passed: 2, failed: 0, skipped: 1 }, exitCode: 0 } })).toBe("run r1: 2 passed, 0 failed, 1 skipped (exit 0)");
    expect(tailLine({ kind: "record.started" })).toBeUndefined();
  });
});

describe("the workspace is a convenience, not a trap (TV-12, TV-T16)", () => {
  it("does not kill the session when the cockpit quits", () => {
    /*
     * It used to `kill-session`, which took the person's shell and their editor
     * with it — everything they had typed in the pane beside it, because they
     * pressed `q` in the pane above.
     */
    const source = readFileSync(new URL("../src/commands/workspace.ts", import.meta.url), "utf8");
    const cockpit = source.slice(source.indexOf("const cockpit ="), source.indexOf("new-window"));
    expect(cockpit).not.toContain("kill-session");
  });

  it("turns the mouse on in the session rather than in a person's own configuration", () => {
    const source = readFileSync(new URL("../src/commands/workspace.ts", import.meta.url), "utf8");
    expect(source).toContain('"mouse", "on"');
  });

  it("names its panes, so which is which does not depend on reading their output", () => {
    const source = readFileSync(new URL("../src/commands/workspace.ts", import.meta.url), "utf8");
    for (const name of ["cockpit", "shell", "events"]) {
      expect(source, `no pane is called ${name}`).toContain(`"${name}"`);
    }
    expect(source).toContain("pane-border-status");
  });
});
