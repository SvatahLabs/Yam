/**
 * T14.4 — every row of the diagnostics catalogue, produced from the real
 * condition, with its sentence and its verb (REQ-CLI-5).
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { DIAGNOSTICS, diagnostic } from "../src/diagnostics.js";
import { reasonFor } from "../src/front-door.js";

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-diag-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text, "utf8");
  }
  return dir;
}

const BLANK = 'schemaVersion: "1.0.0"\napp: { baseUrl: "about:blank" }\n';

describe("the diagnostics catalogue (REQ-CLI-5)", () => {
  it("every row has a sentence and a verb, and none says anything internal", () => {
    expect(DIAGNOSTICS.length).toBe(10);
    for (const one of DIAGNOSTICS) {
      expect(one.message.length).toBeGreaterThan(8);
      expect(one.next.length).toBeGreaterThan(3);
      expect(`${one.message} ${one.next}`).not.toMatch(/REQ-|LLD|Draft|module \(/);
    }
  });

  it("no project here → init, from an empty directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-diag-empty-"));
    const { code, err } = await cli("run", dir);
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("No Yam project here. → yam init");
    const json = await cli("check", dir, "--json");
    expect(JSON.parse(json.out.trim())).toEqual(diagnostic("no-project"));
  });

  it("no flows yet → write one, from an emptied flows directory", async () => {
    const dir = project({ "yam.config.yaml": BLANK });
    mkdirSync(join(dir, "flows"), { recursive: true });
    const { code, err } = await cli("check", dir);
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("The project has no flows yet.");
    expect(err).toContain("yam help flows");
  });

  it("a target with no binding → record, under the failed step of a real run", async () => {
    const dir = project({
      "yam.config.yaml": BLANK,
      "flows/a.flow": 'story: One\n  Go to "about:blank"\n  Click the sign in button\n\ntest: One\n',
    });
    const { code, err } = await cli("run", dir, "--host", "none");
    expect(code).toBe(EXIT.failed);
    expect(err).toContain("✗ One · Click the sign in button");
    expect(err).toContain("No binding for `the sign in button`");
    expect(err).toContain("→ yam record");
  }, 60_000);

  it("a secret read from an unset variable → export it, said at the start of a run", async () => {
    delete process.env["YAM_DIAG_UNSET_SECRET"];
    const dir = project({
      "yam.config.yaml": BLANK,
      "data.yaml": "user:\n  password: ${YAM_DIAG_UNSET_SECRET}\n",
      "flows/a.flow": 'story: One\n  Go to "about:blank"\n\ntest: One\n',
    });
    const { code, err } = await cli("run", dir, "--host", "none");
    expect(code).toBe(EXIT.ok);
    expect(err).toContain("`user.password` reads `$YAM_DIAG_UNSET_SECRET`, which is not set. → export YAM_DIAG_UNSET_SECRET=");
  }, 60_000);

  it("no browser → playwright install, from a failure a launch produces", () => {
    const reason = reasonFor({
      class: "infrastructure",
      message: "browserType.launch: Executable doesn't exist at /nowhere/chromium-1234/chrome-mac/Chromium.app",
    });
    expect(reason.next).toBe("npx playwright install chromium");
  });

  it("a desktop host that is not ready → surface doctor, from the doctor's own line", () => {
    expect(reasonFor({ class: "infrastructure", message: "ax/accessibility refused — grant it to this terminal" }).next).toBe(
      "yam surface doctor --adapter ax",
    );
    expect(reasonFor({ class: "infrastructure", message: "uia/session: no window is owned by the process" }).next).toBe(
      "yam surface doctor --adapter uia",
    );
  });

  it("a resume whose plan moved → run without --resume, from a real checkpoint", async () => {
    const dir = project({
      "yam.config.yaml": `${BLANK}run: { checkpoints: true }\n`,
      "flows/a.flow": 'story: One\n  Go to "about:blank"\n  Go to "about:blank"\n\ntest: One\n',
    });
    const first = await cli("run", dir, "--host", "none", "--run-id", "first");
    expect(first.code).toBe(EXIT.ok);
    const checkpoints = join(dir, "runs", "first", "checkpoints");
    expect(existsSync(checkpoints)).toBe(true);
    // The second step's id, from the run's own results: its checkpoint exists.
    const results = readFileSync(join(dir, "runs", "first", "results.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as { stepId: string });
    const stepId = results[1]!.stepId;
    writeFileSync(join(dir, "flows", "a.flow"), 'story: One\n  Go to "about:blank"\n  Go to "about:blank"\n  Go to "about:blank"\n\ntest: One\n', "utf8");
    const resumed = await cli("run", dir, "--host", "none", "--resume", "first", "--from", stepId);
    expect(resumed.code).toBe(EXIT.hashMismatch);
    expect(resumed.err).toContain("The plan or the bindings changed since the checkpoint. → yam run, without --resume");
  }, 60_000);

  it("a story that is not idempotent against production → allow-side-effects or mark it", async () => {
    const dir = project({
      "yam.config.yaml": `${BLANK}environment: production\n`,
      "flows/a.flow": 'story: Book a slot\n  Go to "about:blank"\n\ntest: Book a slot\n',
    });
    const { code, err } = await cli("workflow", "run", "Book a slot", dir);
    expect(code).toBe(EXIT.refused);
    expect(err).toContain("`Book a slot` is not marked idempotent and this is production.");
    expect(err).toContain("--allow-side-effects");
  });
});
