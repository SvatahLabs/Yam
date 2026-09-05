/**
 * T2.12 — `@svatah/bindings-cli` is module (a), and is a command line
 * (REQ-PKG-1, 2, HLD §12, LLD §1, Draft 2.3).
 *
 * The point of the package is that someone who installed module (a) alone — the
 * store, model-free healing, the adapter and the `bind()` fixture — still has a
 * terminal. That only holds if its dependency tree stays inside module (a), and
 * if the executable is actually declared.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fromRoot } from "../src/repo.js";

interface Manifest {
  bin?: Record<string, string>;
  files?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const manifest = (pkg: string): Manifest =>
  JSON.parse(readFileSync(fromRoot("packages", pkg, "package.json"), "utf8")) as Manifest;

/** Module (b), which nothing in module (a) may reach (HLD §12, Draft 2.3). */
const MODULE_B = [
  "spec",
  "steps",
  "compiler",
  "gateway",
  "recorder",
  "runtime",
  "host-playwright",
  "trajectory",
  "workflow",
  "tool",
  "service",
  "migrate",
  "cli",
];

describe("@svatah/bindings-cli (T2.12)", () => {
  it("declares the svatah-bindings executable", () => {
    // The whole reason the package exists. A `bin` that is missing means module
    // (a) installs and then has no command line.
    const bin = manifest("bindings-cli").bin;
    expect(bin?.["svatah-bindings"]).toBe("./dist/bin.js");
  });

  it("publishes what the executable needs", () => {
    expect(manifest("bindings-cli").files).toContain("dist");
    expect(existsSync(fromRoot("packages", "bindings-cli", "dist", "bin.js"))).toBe(true);
  });

  it("reaches no module (b) package, through any dependency field", () => {
    const seen = new Set<string>();
    const queue = ["bindings-cli"];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const m = manifest(current);
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
        for (const specifier of Object.keys(m[field] ?? {})) {
          const match = /^@svatah\/([^/]+)$/.exec(specifier);
          if (match === null) continue;
          const next = match[1]!;
          if (seen.has(next) || !existsSync(fromRoot("packages", next, "package.json"))) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    expect([...seen].filter((p) => MODULE_B.includes(p))).toEqual([]);
  });

  it("depends on exactly what LLD §1 draws for it", () => {
    // `bindings-cli ─► bindings, healer, conformance, adapter-playwright,
    // surface, schema`. Written out, so widening it is a decision someone makes
    // in front of this comment.
    expect(Object.keys(manifest("bindings-cli").dependencies ?? {}).sort()).toEqual([
      "@svatah/adapter-playwright",
      "@svatah/bindings",
      "@svatah/conformance",
      "@svatah/healer",
      "@svatah/schema",
      "@svatah/surface",
    ]);
  });

  it("is what @svatah/cli mounts, rather than a second implementation", () => {
    // One implementation behind two executables. If the CLI re-implemented these
    // commands, `svatah bindings list` and `svatah-bindings bindings list` would
    // drift apart, which is exactly what a user would never expect.
    expect(manifest("cli").dependencies?.["@svatah/bindings-cli"]).toBeDefined();
    const cliSource = readFileSync(fromRoot("packages", "cli", "src", "cli.ts"), "utf8");
    expect(cliSource).toContain("runBindingsCommand");

    const commands = fromRoot("packages", "cli", "src", "commands");
    for (const moved of ["bindings.ts", "heal.ts", "surface.ts", "eval.ts"]) {
      expect(existsSync(join(commands, moved)), `${moved} is still in @svatah/cli`).toBe(false);
    }
  });
});

describe("the healer's Replayer plugin (LLD §10, §12, Draft 2.3)", () => {
  it("the healer defines it and does not import the runtime", () => {
    const m = manifest("healer");
    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      expect(Object.keys(m[field] ?? {})).not.toContain("@svatah/runtime");
    }
    expect(existsSync(fromRoot("packages", "healer", "src", "replayer.ts"))).toBe(true);
  });

  it("module (b) registers the runtime-backed one from the CLI", () => {
    const source = readFileSync(fromRoot("packages", "cli", "src", "replayer.ts"), "utf8");
    expect(source).toContain("registerReplayer");
    expect(source).toContain("runStory");
  });
});
