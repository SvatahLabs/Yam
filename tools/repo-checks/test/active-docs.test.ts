/**
 * The active documentation says what shipped (T20, SF-02, SF-20, SF-21).
 *
 * Three of T20's Done conditions are about words rather than code — "no broken
 * copied command, unsupported universal claim or old Flows landing promise
 * remains in active docs" — and words rot silently. These are the checks that
 * make them fail loudly instead.
 *
 * "Active" means what a *user* reads: `README.md`, `docs/**` and `examples/**`,
 * minus `docs/spec/**` (the specification, which is allowed to describe what is
 * proposed) and `docs/reference/generated/**` (which is derived and checked by
 * `pnpm docs --check`).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fromRoot } from "../src/repo.js";

/** Every markdown file a user might read. */
function activeDocs(): string[] {
  const out: string[] = [];
  const skip = [fromRoot("docs/spec"), fromRoot("docs/reference/generated")];
  const walk = (dir: string): void => {
    if (skip.some((one) => dir === one)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === "node_modules") continue;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".md") && statSync(path).isFile()) out.push(path);
    }
  };
  walk(fromRoot("docs"));
  walk(fromRoot("examples"));
  out.push(fromRoot("README.md"));
  return out;
}

const docs = activeDocs().map((path) => ({
  path: relative(fromRoot("."), path),
  text: readFileSync(path, "utf8"),
}));

describe("no claim the product does not keep (T20)", () => {
  it("promises no Flows landing", () => {
    /*
     * SF-02 and T14: the app opens on Surfaces. A doc that still says it opens
     * into Flows is describing the product two waves ago.
     */
    const offenders = docs
      .filter((one) => /opens? into (the )?Flows/i.test(one.text))
      .map((one) => one.path);
    expect(offenders, `these still promise a Flows landing: ${offenders.join(", ")}`).toEqual([]);
  });

  it("claims no universal platform support", () => {
    /*
     * `requirements.md`: "'Any surface' means an extensible contract with an
     * honest, versioned support matrix. It does not mean every platform or
     * operation already works." The support matrix is the place to make a
     * claim, and it is generated from runs.
     */
    const offenders = docs
      .filter((one) => /\b(any|every|all) platforms?\b/i.test(one.text))
      .map((one) => one.path);
    expect(
      offenders,
      `these claim support for any/every platform: ${offenders.join(", ")}. ` +
        "Point at docs/reference/generated/support-matrix.md instead.",
    ).toEqual([]);
  });

  it("names no adapter that does not exist", () => {
    /*
     * The top-level README listed "OS accessibility (UIA, AX, AT-SPI)" among the
     * adapters implementing the surface. There is no AT-SPI adapter; SF-23 has
     * it as unimplemented and T23 as unstarted. A reader choosing a tool for a
     * Linux desktop would have chosen this one.
     */
    const adapters = readdirSync(fromRoot("packages")).filter((one) => one.startsWith("adapter-"));
    const known = new Set(adapters.map((one) => one.replace("adapter-", "")));
    for (const one of docs) {
      const mentionsUnimplemented = /AT-SPI/.test(one.text);
      if (!mentionsUnimplemented) continue;
      expect(
        /not implemented|unimplemented|no adapter implements/i.test(one.text),
        `${one.path} names AT-SPI, for which there is no adapter ` +
          `(${[...known].sort().join(", ")}), and does not say it is unimplemented`,
      ).toBe(true);
    }
  });

  it("puts no repository path or fixture gateway in a setup instruction", () => {
    /*
     * SF-20: "No repository path or fixture gateway appears in production
     * setup." Scoped to the pages a person follows to *install and start* —
     * a contributor page that runs `node packages/cli/dist/bin.js` from a
     * checkout is doing the right thing.
     */
    const setup = docs.filter(
      (one) =>
        one.path.startsWith("docs/getting-started/") ||
        one.path === "examples/surface-control/README.md" ||
        one.path === "docs/mcp.md",
    );
    expect(setup.length, "the setup pages moved; this check is now looking at nothing").toBeGreaterThan(0);
    for (const one of setup) {
      expect(one.text, `${one.path} runs the CLI from a checkout`).not.toMatch(
        /node packages\/cli\/dist/,
      );
      expect(one.text, `${one.path} names the fixture gateway`).not.toMatch(/evals\/grounding/);
      expect(one.text, `${one.path} uses the unscoped package name`).not.toMatch(
        /(?<![\w@/-])(npm install|npx)\s+(-y\s+)?yam(?![\w-])/,
      );
    }
  });
});

describe("the copied commands are the ones that ran (T20, SF-20)", () => {
  const coveragePath = fromRoot("docs/spec/surface-first/evidence/wave-4/coverage.json");

  it.skipIf(!existsSync(coveragePath))(
    "every shell command in the surface quick start was run from the packed artifact",
    () => {
      /*
       * The document is the test. `scripts/surface-quick-start.mjs` extracts
       * these commands at run time, installs the packed tarballs into a
       * directory outside this workspace and runs them there; `coverage.json`
       * records what each one answered. This asserts the two lists are the
       * same, so a command added to the document and never run is a red build
       * rather than an untested instruction.
       */
      const source = readFileSync(fromRoot("examples/surface-control/README.md"), "utf8");
      const written: string[] = [];
      for (const block of source.matchAll(/```bash\n([\s\S]*?)```/g)) {
        for (const raw of block[1]!.split("\n")) {
          const line = raw.trim();
          if (line !== "" && !line.startsWith("#")) written.push(line);
        }
      }

      const coverage = JSON.parse(readFileSync(coveragePath, "utf8")) as {
        quickStart: { commands?: Array<{ command: string; ok?: boolean; blocked?: string }> };
      };
      const ran = coverage.quickStart.commands ?? [];
      const ranCommands = new Set(ran.map((one) => one.command));

      const never = written.filter((one) => !ranCommands.has(one));
      expect(
        never,
        `these are in the document and were not run: ${never.join(" | ")}. ` +
          "Re-run `pnpm quick-start:surface` through `pnpm coverage`.",
      ).toEqual([]);

      const failed = ran.filter((one) => one.blocked === undefined && one.ok !== true);
      expect(
        failed.map((one) => one.command),
        "these copied commands failed when they were run",
      ).toEqual([]);
    },
  );
});
