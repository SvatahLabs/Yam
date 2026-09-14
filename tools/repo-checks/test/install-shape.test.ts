/**
 * What a person actually installs (PK-01, PK-12, PK-N2).
 *
 * The numbers in `docs/spec/packaging/README.md` are the reason the shape is two
 * installables and not a carve-up of thirty-six packages: everything Yam wrote is
 * about six megabytes, and the weight is four third-party packages. A claim like
 * "~9 MB" that has quietly become fifteen is worse than no claim, so it is
 * measured here rather than written down once.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fromRoot } from "../src/repo.js";

const manifest = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fromRoot(path), "utf8")) as Record<string, unknown>;

describe("the base install", () => {
  const cli = manifest("packages/cli/package.json");
  const deps = Object.keys((cli["dependencies"] ?? {}) as Record<string, string>);

  it("carries no driver and no MCP SDK", () => {
    for (const heavy of ["playwright", "webdriverio", "@modelcontextprotocol/sdk"]) {
      expect(deps, `the base installs ${heavy}`).not.toContain(heavy);
    }
  });

  /*
   * `undici` stays, by the owner's decision of 2026-09-12 (PK-06). It is three
   * megabytes for a surface people reach for, and a prompt would cost more. It
   * is asserted so that a later size review has to argue with the decision
   * rather than quietly reverse it.
   */
  it("carries undici, by decision", () => {
    expect(deps).toContain("@svatah/yam-adapter-http");
    const http = manifest("packages/adapter-http/package.json");
    expect(Object.keys((http["dependencies"] ?? {}) as Record<string, string>)).toContain("undici");
  });

  it("carries every adapter that needs nothing", () => {
    for (const free of ["ax", "uia", "atspi", "bidi", "process", "http"]) {
      expect(deps, `the base is missing the ${free} adapter`).toContain(`@svatah/yam-adapter-${free}`);
    }
  });
});

describe("the MCP server is separate", () => {
  it("owns the SDK, and depends on the CLI rather than duplicating it", () => {
    const mcp = manifest("packages/mcp/package.json");
    const deps = Object.keys((mcp["dependencies"] ?? {}) as Record<string, string>);
    expect(deps).toContain("@modelcontextprotocol/sdk");
    expect(deps).toContain("@svatah/yam");
    expect(Object.keys((mcp["bin"] ?? {}) as Record<string, string>)).toEqual(["yam-mcp"]);
  });

  /*
   * And `yam mcp` is gone from the command line, not aliased. Two entry points
   * to one server is how the app and the CLI ended up with two copies of
   * everything else (REQ-TUI-1, Draft 2.26).
   */
  it("leaves no `mcp` subcommand behind", () => {
    const help = readFileSync(fromRoot("packages/cli/src/help.ts"), "utf8");
    expect(help).not.toContain('name: "mcp"');
    /*
     * And not in the *words* either.
     *
     * The structural half of this passed while `yam help`'s own first screen
     * still ended "More, one level down: yam bindings · workflow · tool · mcp ·
     * …" — so the front door advertised a command that answers "it has moved".
     * A check that reads a source marker and not the sentence a person reads is
     * a check of the shape of the fix rather than of the fix.
     */
    const front = /More, one level down:([^`\n]*)/.exec(help)?.[1] ?? "";
    expect(front, "the top-level help still lists mcp").not.toMatch(/(^|·)\s*mcp\s*(·|$)/);
  });
});

describe("the contract is depended on, not implemented twice", () => {
  it("drives nothing", () => {
    const contract = manifest("packages/contract/package.json");
    expect(Object.keys((contract["dependencies"] ?? {}) as Record<string, string>).sort()).toEqual([
      "@svatah/yam-schema",
      "zod",
    ]);
  });
});

describe("the packed tarball is the size the specification claims", () => {
  /*
   * `npm pack --dry-run` rather than a publish: nothing is published, and the
   * owner's standing instruction is that nothing will be without their word.
   * This measures the package's own contents, which is the half a registry
   * cannot change.
   */
  it("packs the CLI at about six megabytes, which is what the shape assumes", () => {
    const printed = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      // `npm` is a `.cmd` shim on Windows, which only a shell starts.
      shell: process.platform === "win32",
      cwd: fromRoot("packages/cli"),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const [packed] = JSON.parse(printed) as Array<{ unpackedSize: number; entryCount: number }>;
    /*
     * A throw, not `expect(...).toBeDefined()`.
     *
     * The matcher asserts at run time and narrows nothing at compile time, so
     * every use below was `possibly undefined` and `pnpm -r typecheck` said so.
     * The check ran green the whole while, which is how a type error lives in a
     * passing test.
     */
    if (packed === undefined) throw new Error("`npm pack --json` printed no package");
    /*
     * Eight, calibrated from six-point-one.
     *
     * I asserted two before measuring, which is a number I made up: the
     * specification's own figure is "everything Yam wrote, about six megabytes",
     * and the CLI bundles most of it. The threshold is the measurement plus
     * room, so that a driver creeping back in — nineteen megabytes for
     * Playwright, six for the SDK — fails here rather than shipping.
     */
    const megabytes = packed.unpackedSize / 1_000_000;
    expect(megabytes, `the CLI packs ${megabytes.toFixed(1)} MB`).toBeLessThan(8);
  }, 120_000);
});
