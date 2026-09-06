/**
 * T2.12 — `@svatah/yam-bindings-cli` is module (a), and is a command line
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
import { fromRoot, dirOf } from "../src/repo.js";

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

describe("@svatah/yam-bindings-cli (T2.12)", () => {
  it("declares the yam-bindings executable", () => {
    // The whole reason the package exists. A `bin` that is missing means module
    // (a) installs and then has no command line.
    const bin = manifest("bindings-cli").bin;
    expect(bin?.["yam-bindings"]).toBe("./dist/bin.js");
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
          const next = dirOf(specifier);
          if (next === undefined) continue;
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
    const dependencies = Object.keys(manifest("bindings-cli").dependencies ?? {}).sort();
    expect(dependencies.filter((name) => name.startsWith("@svatah/"))).toEqual([
      "@svatah/yam-adapter-playwright",
      "@svatah/yam-bindings",
      "@svatah/yam-conformance",
      "@svatah/yam-healer",
      "@svatah/yam-schema",
      "@svatah/yam-surface",
    ]);

    /*
     * `yaml` is the third-party half, and there is exactly one of it: Draft 2.5
     * moves `yam.config.yaml` loading here, because LLD §15's base-URL
     * precedence is "applied identically by every command that opens a session"
     * and three of those commands — `bindings verify`, `surface conform`,
     * `eval` — are module (a)'s. A second config reader beside it is how the two
     * halves would come to disagree about what `config.app` says.
     */
    expect(dependencies.filter((name) => !name.startsWith("@svatah/"))).toEqual(["yaml"]);
  });

  it("is what @svatah/yam mounts, rather than a second implementation", () => {
    // One implementation behind two executables. If the CLI re-implemented these
    // commands, `yam bindings list` and `yam-bindings bindings list` would
    // drift apart, which is exactly what a user would never expect.
    expect(manifest("cli").dependencies?.["@svatah/yam-bindings-cli"]).toBeDefined();
    const cliSource = readFileSync(fromRoot("packages", "cli", "src", "cli.ts"), "utf8");
    expect(cliSource).toContain("runBindingsCommand");

    const commands = fromRoot("packages", "cli", "src", "commands");

    /*
     * Module (b) has an eval command of its own (T3.4) — `eval-grounding.ts`,
     * which needs the gateway and the recorder and therefore cannot live in
     * module (a). It is deliberately not named `eval.ts`: that name belongs to
     * the file that moved out, and reusing it would read like it moved back.
     */
    expect(existsSync(join(commands, "eval-grounding.ts"))).toBe(true);

    for (const moved of ["bindings.ts", "heal.ts", "surface.ts", "eval.ts"]) {
      expect(existsSync(join(commands, moved)), `${moved} is still in @svatah/yam`).toBe(false);
    }
  });
});

describe("the healer's Replayer plugin (LLD §10, §12, Draft 2.3)", () => {
  it("the healer defines it and does not import the runtime", () => {
    const m = manifest("healer");
    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      expect(Object.keys(m[field] ?? {})).not.toContain("@svatah/yam-runtime");
    }
    expect(existsSync(fromRoot("packages", "healer", "src", "replayer.ts"))).toBe(true);
  });

  it("module (b) registers the runtime-backed one from the CLI", () => {
    const source = readFileSync(fromRoot("packages", "cli", "src", "replayer.ts"), "utf8");
    expect(source).toContain("registerReplayer");
    expect(source).toContain("runStory");
  });
});
