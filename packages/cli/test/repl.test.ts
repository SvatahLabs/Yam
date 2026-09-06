/**
 * T4.5's Validate — "stdin-driven integration test for three sentences"
 * (REQ-RUN-11, LLD §15).
 *
 * Driven over stdin through the real executable, against a real browser and a
 * real application, because the whole claim is about a *session*: that three
 * sentences typed one after another act on the same page in order, and that what
 * the session leaves behind replays.
 *
 * The last part is the one that matters and the one a unit test cannot make:
 * the flow the REPL writes is fed back to `yam run`, with no model in the
 * loop, and has to pass.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, type SampleServer } from "sample-web";
import { EXIT } from "@svatah/yam-bindings-cli";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(ROOT, "evals", "fixtures");
const YAM = join(ROOT, "packages", "cli", "dist", "bin.js");

let app: SampleServer;
const projects: string[] = [];

/** A copy of the fixture project, with no flows: the REPL writes its own. */
function scaffold(options: { drop?: string[] } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-repl-"));
  projects.push(dir);
  cpSync(join(FIXTURES, "bindings"), join(dir, "bindings"), { recursive: true });
  cpSync(join(FIXTURES, "api"), join(dir, "api"), { recursive: true });
  cpSync(join(FIXTURES, "data.yaml"), join(dir, "data.yaml"));
  cpSync(join(FIXTURES, "yam.config.yaml"), join(dir, "yam.config.yaml"));
  for (const path of options.drop ?? []) rmSync(join(dir, path), { force: true });
  return dir;
}

function cli(
  args: readonly string[],
  cwd: string,
  stdin?: string,
): Promise<{ code: number; output: string; json: string }> {
  return new Promise((done) => {
    let output = "";
    let json = "";
    const child = spawn(process.execPath, [YAM, ...args], {
      cwd,
      env: {
        ...process.env,
        YAM_SAMPLE_PASSWORD: "qwerty123",
        YAM_SAMPLE_CARD_NUMBER: "5123456789012346",
        YAM_SAMPLE_CARD_CVV: "123",
        // The gateway is chosen by flag, never inherited.
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_AUTH_TOKEN: "",
      },
    });
    child.stdout.on("data", (chunk) => {
      json += String(chunk);
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output, json }));
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

const flowIn = (dir: string): string => {
  const flows = readdirSync(join(dir, "flows")).filter((name) => name.endsWith(".flow"));
  expect(flows, "the session wrote exactly one flow").toHaveLength(1);
  return join(dir, "flows", flows[0]!);
};

beforeAll(async () => {
  if (!existsSync(YAM)) throw new Error("Run `pnpm -r build` first.");
  app = await startSampleApp(0);
}, 180_000);

afterAll(async () => {
  await app.close();
  for (const dir of projects) rmSync(dir, { recursive: true, force: true });
});

describe("yam repl, three sentences over stdin (T4.5, REQ-RUN-11)", () => {
  it("performs them in order against one session and writes a flow that replays", async () => {
    const project = scaffold();
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin, "--json"],
      project,
      [
        "Click the sign in button",
        'Type "someone@example.com" into the username field',
        "The login button should be visible",
        ".exit",
      ].join("\n") + "\n",
    );

    expect(session.code, session.output).toBe(EXIT.ok);
    const summary = JSON.parse(session.json) as {
      flow: string;
      steps: Array<{ text: string; action: string }>;
    };
    expect(summary.steps.map((s) => s.action)).toEqual(["click", "type", "expect"]);

    /*
     * The three ran against *one* session, in order. The second could only have
     * typed into the username field because the first navigated there, and the
     * third could only have seen the login button for the same reason — so the
     * three passing is itself the assertion that the session is shared.
     */
    expect(session.output).toContain("✓ click home.sign-in-button");
    expect(session.output).toContain("✓ type login.username-field");
    expect(session.output).toContain("✓ expect login.login-button");

    const flow = readFileSync(flowIn(project), "utf8");
    expect(flow).toContain("story: REPL session");
    expect(flow).toContain("  Click the sign in button");
    expect(flow).toContain("test: REPL session");

    // The point of the file: it replays, deterministically, with no model.
    const replay = await cli(
      ["run", ".", "--host", "none", "--run-id", "replay", "--base-url", app.origin],
      project,
    );
    expect(replay.code, replay.output).toBe(EXIT.ok);
    expect(replay.output).toContain("3 passed, 0 failed");
  }, 300_000);

  it("reports a sentence the grammar refuses without ending the session", async () => {
    const project = scaffold();
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin, "--json"],
      project,
      ["Frobnicate the widget vigorously", "Click the sign in button", ".exit"].join("\n") + "\n",
    );

    expect(session.code, session.output).toBe(EXIT.ok);
    expect(session.output).toContain("E_NO_MATCH");
    // The session carried on: a sentence that did not compile is one to
    // rephrase, not a reason to lose the browser.
    expect(session.output).toContain("✓ click home.sign-in-button");
    expect((JSON.parse(session.json) as { steps: unknown[] }).steps).toHaveLength(1);
  }, 300_000);

  it("keeps a failed sentence out of the flow", async () => {
    // The flow is what the session did *successfully*; committing a step that
    // failed would produce a flow that fails on its first run.
    const project = scaffold();
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin, "--json"],
      project,
      ["The login button should be visible", "Click the sign in button", ".exit"].join("\n") + "\n",
    );

    // The first sentence names a button that is not on the home page.
    expect(session.output).toMatch(/✗ (locator|assertion|timeout)/);
    const flow = readFileSync(flowIn(project), "utf8");
    expect(flow).not.toContain("The login button should be visible");
    expect(flow).toContain("Click the sign in button");
  }, 300_000);
});

describe("grounding in a session (LLD §15)", () => {
  it("grounds an element nothing has recorded, and keeps it once the step passes", async () => {
    const project = scaffold({ drop: ["bindings/nav/dashboard-link.yaml"] });
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "fake", "--base-url", app.origin],
      project,
      ["Click the nav toggle", "Click the dashboard link", ".exit"].join("\n") + "\n",
    );

    expect(session.output).toContain('grounded "the dashboard link"');
    const written = readFileSync(join(project, "bindings", "dashboard-link.yaml"), "utf8");
    // REQ-REC-5: the step performed through it, so it is verified. A binding
    // that reached disk unverified is the thing that requirement forbids.
    expect(written).toContain("verified: true");
    expect(written).toContain('model: "fake:grounding-cases"');
  }, 300_000);

  it("rolls a binding back when the step it was grounded for fails", async () => {
    const project = scaffold();
    await cli(
      ["repl", ".", "--headless", "--gateway", "fake", "--base-url", app.origin],
      project,
      ["Click the completely imaginary widget", ".exit"].join("\n") + "\n",
    );
    expect(existsSync(join(project, "bindings", "completely-imaginary-widget.yaml"))).toBe(false);
  }, 300_000);

  it("says which of the two things is missing when there is no model", async () => {
    // "No model" and "the model could not find it" are different problems with
    // different answers, and an unbound target is the normal state of a phrase
    // nobody has recorded.
    const project = scaffold({ drop: ["bindings/nav/dashboard-link.yaml"] });
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin],
      project,
      ["Click the nav toggle", "Click the dashboard link", ".exit"].join("\n") + "\n",
    );
    expect(session.output).toContain("is not in the bindings store and there is no model");
    expect(session.output).toContain("ANTHROPIC_API_KEY");
    expect(session.output).toContain("--gateway fake");
  }, 300_000);
});

describe("the meta commands", () => {
  it("answers .url, .snapshot, .bindings and .flow", async () => {
    const project = scaffold();
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin],
      project,
      ["Click the sign in button", ".url", ".snapshot 5", ".bindings", ".flow", ".exit"].join("\n") + "\n",
    );

    expect(session.output).toContain("/login");
    expect(session.output).toContain("[ref=");
    expect(session.output).toContain("home.sign-in-button");
    expect(session.output).toContain("story: REPL session");
  }, 300_000);

  it("drops the last sentence on .undo, and says the page is not undone", async () => {
    const project = scaffold();
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin, "--json"],
      project,
      ["Click the sign in button", ".undo", ".exit"].join("\n") + "\n",
    );
    expect(session.output).toContain('dropped "Click the sign in button"');
    expect((JSON.parse(session.json) as { steps: unknown[] }).steps).toHaveLength(0);
  }, 300_000);

  it("names an unknown command rather than treating it as a sentence", async () => {
    const project = scaffold();
    const session = await cli(
      ["repl", ".", "--headless", "--gateway", "none", "--base-url", app.origin],
      project,
      [".frobnicate", ".exit"].join("\n") + "\n",
    );
    expect(session.output).toContain('unknown command ".frobnicate"');
  }, 300_000);
});
