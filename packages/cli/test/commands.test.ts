/**
 * T2.10 — the module (b) commands (REQ-AGT-1, LLD §15).
 *
 * The compatibility milestone itself is `scripts/compatibility.mjs`, because it
 * needs a browser and an application. What is here is the command surface: that
 * each command exists, does what it says, and returns the exit code the table in
 * LLD §15 gives — which is the part CI and scripts depend on.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/index.js";
import { EXIT } from "@svatah/bindings-cli";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Run the CLI, collecting what it printed. */
async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

/** A throwaway project. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "svatah-cli-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text, "utf8");
  }
  return dir;
}

describe("help and unknown commands", () => {
  it("lists both halves of the command line", async () => {
    const { out } = await cli("help");
    expect(out).toContain("svatah compile");
    expect(out).toContain("svatah run");
    expect(out).toContain("svatah bindings list");
  });

  it("says which task builds a command that is not built yet", async () => {
    // "Not yet" and "never" are different answers, and a bare "unknown command"
    // gives neither.
    const { code, err } = await cli("record");
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("T3.3");
  });

  it("says plainly when a command does not exist", async () => {
    const { err } = await cli("frobnicate");
    expect(err).toContain('Unknown command "frobnicate"');
  });
});

describe("svatah init (REQ-AGT-1)", () => {
  it("writes a project that lints", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svatah-init-"));
    expect((await cli("init", dir)).code).toBe(EXIT.ok);

    for (const file of ["svatah.config.yaml", "flows/sign-in.flow", "data.yaml"]) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
    // The example flow it writes has to be a flow that compiles, or `init`
    // hands someone a project that is broken on the first command they run.
    expect((await cli("lint", dir)).code).toBe(EXIT.ok);
  });

  it("refuses to overwrite an existing project", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svatah-init-"));
    await cli("init", dir);
    const { code, err } = await cli("init", dir);
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("--force");
  });
});

describe("svatah lint and compile (REQ-COMP-7, 8)", () => {
  const good = {
    "flows/a.flow": 'story: One\n  Open "/"\n  Click the sign in button\n\ntest: One\n',
  };

  it("lints a clean project as clean", async () => {
    const { code } = await cli("lint", project(good));
    expect(code).toBe(EXIT.ok);
  });

  it("returns 2 on a compile error, and names the line (LLD §15)", async () => {
    const dir = project({
      "flows/a.flow": "story: One\n  Type {nope} into the username field\n\ntest: One\n",
    });
    const { code, err } = await cli("lint", dir);
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("E_VAR_UNDEFINED");
    expect(err).toContain("flows/a.flow:2");
  });

  it("returns 2 on a v2 flow, and points at migrate", async () => {
    const dir = project({
      "flows/a.flow": "story: One\n  user +clicks+ the ~sign in button~\n\ntest: One\n",
    });
    const { code, err } = await cli("lint", dir);
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("E_SIGIL");
    expect(err).toContain("svatah migrate");
  });

  it("writes a plan, and two compiles write the same bytes (REQ-COMP-7)", async () => {
    const dir = project(good);
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    expect((await cli("compile", dir, "--stable", "--out", a)).code).toBe(EXIT.ok);
    expect((await cli("compile", dir, "--stable", "--out", b)).code).toBe(EXIT.ok);
    expect(readFileSync(a, "utf8")).toBe(readFileSync(b, "utf8"));
  });

  it("writes no plan when the project does not compile", async () => {
    // A stale plan beside a broken project is worse than none: the next command
    // would run the last thing that worked.
    const dir = project({ "flows/a.flow": "story: One\n  Frobnicate the widget\n\ntest: One\n" });
    const out = join(dir, "plan.json");
    expect((await cli("compile", dir, "--out", out)).code).toBe(EXIT.compileErrors);
    expect(existsSync(out)).toBe(false);
  });
});

describe("svatah migrate (REQ-LANG-11, LLD §15)", () => {
  it("converts the frozen legacy project and writes a review", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svatah-migrated-"));
    const { code } = await cli("migrate", join(ROOT, "legacy", "src", "test", "resources"), dir);
    expect(code).toBe(EXIT.ok);
    expect(existsSync(join(dir, "flows", "simple.flow"))).toBe(true);
    expect(existsSync(join(dir, "migration-review.md"))).toBe(true);
  });

  it("returns 8 when a step could not be converted (LLD §15)", async () => {
    // The step is left in the flow as a comment; the exit code is what says the
    // output is not finished.
    const source = project({ "a.flow": "story: One\n+frobnicate+ the ~widget~\n" });
    const dir = mkdtempSync(join(tmpdir(), "svatah-migrated-"));
    const { code } = await cli("migrate", source, dir);
    expect(code).toBe(EXIT.unmapped);
    expect(readFileSync(join(dir, "flows", "a.flow"), "utf8")).toContain("TODO(migrate)");
  });

  it("needs both a source and a destination", async () => {
    expect((await cli("migrate", "only-one")).code).toBe(EXIT.usage);
  });
});

describe("svatah host generate (REQ-RUN-12)", () => {
  it("writes one spec per flow", async () => {
    const dir = project({
      "flows/a.flow": 'story: One\n  Open "/"\n\nstory: Two\n  Open "/x"\n\ntest: everything\n  One\n  Two\n',
    });
    const { code } = await cli("host", "generate", dir);
    expect(code).toBe(EXIT.ok);

    const spec = readFileSync(join(dir, ".svatah", "specs", "a.spec.ts"), "utf8");
    expect(spec).toContain('test("One"');
    expect(spec).toContain('test("Two"');
    expect(spec).toContain('mode: "serial"');
  });
});

describe("svatah doctor (REQ-AGT-1)", () => {
  it("reports what it found and what to do about it", async () => {
    const dir = project({ "flows/a.flow": 'story: One\n  Open "/"\n\ntest: One\n' });
    const { out } = await cli("doctor", dir);
    expect(out).toContain("Node");
    expect(out).toContain("adapters");
    expect(out).toContain("flows");
    // A check that only says "failed" sends the reader to a search engine.
    expect(out).toContain("→");
  });

  it("returns non-zero when something is wrong", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svatah-empty-"));
    const { code, out } = await cli("doctor", dir);
    expect(code).not.toBe(EXIT.ok);
    expect(out).toContain("no stories");
  });
});

describe("svatah run (LLD §15)", () => {
  it("refuses a host it does not have", async () => {
    const dir = project({ "flows/a.flow": 'story: One\n  Open "/"\n\ntest: One\n' });
    const { code, err } = await cli("run", dir, "--host", "selenium");
    expect(code).toBe(EXIT.usage);
    expect(err).toContain("--host");
  });

  it("returns 2 rather than running a project that does not compile", async () => {
    const dir = project({ "flows/a.flow": "story: One\n  Frobnicate it\n\ntest: One\n" });
    const { code, err } = await cli("run", dir);
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("nothing to run");
  });
});
