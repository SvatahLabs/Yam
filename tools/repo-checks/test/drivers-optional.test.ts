/**
 * A driver is never the price of naming an adapter (PK-02, PK-04).
 *
 * `registerAllAdapters` names all eight on every platform, because
 * `yam surface doctor` has to be able to say "uia: not this host" on a Mac and
 * "playwright: not installed" on a machine that never wanted a browser. That is
 * only affordable if *naming* an adapter does not import its driver: `playwright`
 * is 19 MB and `webdriverio` is 4, against 6 MB for everything Yam wrote.
 *
 * Without this check the split closes again the first time somebody adds a
 * convenient top-level import, and nothing would fail — the install would just
 * quietly grow. That is the shape of every defect this repository has found by
 * checking a property rather than reading the code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

/** The packages that are big enough to be worth not installing. */
const DRIVERS = ["playwright", "webdriverio"] as const;

const sources = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
};

/** `import … from "x"` at the top level; `await import("x")` is the point. */
const staticImports = (text: string): string[] =>
  [...text.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1] as string);

describe("naming an adapter does not install its driver", () => {
  /**
   * Every module a file reaches by *static* import, transitively.
   *
   * The first version of this forbade a static import of a driver anywhere, and
   * failed `adapter-playwright/src/locate.ts` — which is correct code: that file
   * is only ever reached through `surface.ts`, which `register.ts` loads with
   * `await import`. A module behind a lazy boundary may import whatever it
   * needs; the rule is about what crosses the boundary, not about what is
   * inside it.
   */
  const reaches = (entry: string): Set<string> => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        return;
      }
      for (const specifier of staticImports(text)) {
        if (!specifier.startsWith(".")) {
          seen.add(specifier);
          continue;
        }
        const resolved = join(dirname(file), specifier.replace(/\.js$/, ".ts"));
        walk(resolved);
      }
    };
    walk(entry);
    return seen;
  };

  it("reaches no driver from the file that registers an adapter", () => {
    const offences: string[] = [];
    for (const pkg of readdirSync(fromRoot("packages")).filter((one) => one.startsWith("adapter-"))) {
      const entry = fromRoot("packages", pkg, "src", "register.ts");
      let reached: Set<string>;
      try {
        reached = reaches(entry);
      } catch {
        continue;
      }
      for (const driver of DRIVERS) {
        if ([...reached].some((one) => one === driver || one.startsWith(`${driver}/`))) {
          offences.push(`${pkg}: registering it reaches ${driver}`);
        }
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  /*
   * And the manifests agree with the code: a driver that is optional in one
   * place and required in another is installed anyway.
   */
  it("declares every driver optional wherever it is named", () => {
    const wrong: string[] = [];
    for (const pkg of readdirSync(fromRoot("packages"))) {
      let manifest: {
        dependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      };
      try {
        manifest = JSON.parse(readFileSync(fromRoot("packages", pkg, "package.json"), "utf8"));
      } catch {
        continue;
      }
      for (const driver of DRIVERS) {
        if (manifest.dependencies?.[driver] !== undefined) {
          wrong.push(`${pkg} has ${driver} as a hard dependency`);
        }
        const meta = manifest.peerDependenciesMeta?.[driver];
        if (meta !== undefined && meta.optional !== true) {
          wrong.push(`${pkg} declares ${driver} as a required peer`);
        }
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  /*
   * The base install is what a person gets from `npm i @svatah/yam`, and PK-01
   * says it needs no setup. An adapter package in its dependency list is fine —
   * they are Yam's own code and tiny. A *driver* in it is not.
   */
  it("keeps the CLI's dependency list free of drivers", () => {
    const cli = JSON.parse(readFileSync(fromRoot("packages/cli/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    for (const driver of DRIVERS) {
      expect(Object.keys(cli.dependencies ?? {}), driver).not.toContain(driver);
      expect(cli.peerDependenciesMeta?.[driver]?.optional, `${driver} is not an optional peer`).toBe(true);
    }
    /* undici stays, by decision (PK-06), and this is where that is recorded. */
    expect(Object.keys(cli.dependencies ?? {})).toContain("@svatah/yam-adapter-http");
  });
});
