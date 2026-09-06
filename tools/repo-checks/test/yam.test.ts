/**
 * Draft 2.18 — the product is Yam under the Svatah brand (T13.3, T13.4).
 *
 * Three things the rename has to keep true after it is done: the old name
 * survives only where it names the brand, the organisation, a kept fixture or
 * history; the documents' package count is the release set's and not a number
 * somebody typed; and every manifest says where the code lives.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

/** Forms of the old name that are allowed to remain, and why. */
const ALLOWED: ReadonlyArray<[RegExp, string]> = [
  [/@svatah\b/g, "the npm scope is the organisation"],
  [/"svatah"/g, "the legacy sample fixture's base name, and the brand as a path segment"],
  [/Svatah (is|as) the (brand|organisation)|the Svatah brand/g, "prose about the brand"],
  [/svatah\.com/g, "the brand's domain"],
  [/Svatah Labs|SvatahLabs/g, "the organisation"],
  [/svatahADE/g, "the prototype repository the ADE was designed from"],
  [/svatah[_-]yam/g, "the PyPI and Python client names carry the brand"],
  [/com[./]svatah[./]yam/g, "the Java package and the bundle id carry the brand"],
  [/svatah\.(flow|locator|data)/g, "the legacy sample fixtures keep their file names"],
  [/Workspace\/Svatah/g, "the implementer's machine path inside a recording"],
];

/** Files the check does not read: history, generated locks, binaries. */
const SKIPPED = (file: string): boolean =>
  file === "tools/repo-checks/test/yam.test.ts" || // this file names the forms it allows
  file === "pnpm-lock.yaml" ||
  file === "LICENSE" ||
  file.startsWith("docs/spec/progress/") ||
  file.startsWith("docs/spec/prompts/") ||
  /\.(png|woff2|jar|sha256)$/.test(file);

describe("the product is Yam (Draft 2.18)", () => {
  it("the old name survives only in its allowed forms", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((file) => file !== "" && !SKIPPED(file) && existsSync(fromRoot(file)));
    const leftovers: string[] = [];
    for (const file of files) {
      const text = readFileSync(fromRoot(file), "utf8");
      if (!/svatah/i.test(text)) continue;
      let stripped = text;
      for (const [form] of ALLOWED) stripped = stripped.replace(form, "");
      stripped.split("\n").forEach((line, index) => {
        if (/svatah/i.test(line)) leftovers.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(leftovers, "the old product name is still used as the product's name here").toEqual([]);
  });

  it("the umbrella package is @svatah/yam with the yam bin", () => {
    const cli = JSON.parse(readFileSync(fromRoot("packages", "cli", "package.json"), "utf8")) as {
      name: string;
      bin: Record<string, string>;
    };
    expect(cli.name).toBe("@svatah/yam");
    expect(Object.keys(cli.bin)).toEqual(["yam"]);
  });

  it("the documents' package count is the release set's", async () => {
    const lib = (await import(fromRoot("scripts", "lib", "release-packages.mjs"))) as {
      publishablePackages: () => string[];
    };
    const n = lib.publishablePackages().length;
    expect(n).toBeGreaterThan(0);
    expect(readFileSync(fromRoot("CHANGELOG.md"), "utf8")).toContain(`prints the ${n} exact`);
    expect(readFileSync(fromRoot(".github", "workflows", "release.yml"), "utf8")).toContain(
      `Publish the ${n} packages`,
    );
  });

  it("every manifest names the repository, the home page and the issue tracker", () => {
    const manifests = ["package.json"];
    for (const base of ["packages", "apps", "tools"]) {
      for (const dir of readdirSync(fromRoot(base))) {
        if (existsSync(fromRoot(base, dir, "package.json"))) manifests.push(join(base, dir, "package.json"));
      }
    }
    for (const file of manifests) {
      const m = JSON.parse(readFileSync(fromRoot(file), "utf8")) as {
        homepage?: string;
        repository?: { type: string; url: string; directory?: string };
        bugs?: { url: string };
      };
      expect(m.homepage, file).toBe("https://yam.svatah.com");
      expect(m.repository?.url, file).toBe("git+https://github.com/SvatahLabs/yam.git");
      expect(m.bugs?.url, file).toBe("https://github.com/SvatahLabs/yam/issues");
      if (file !== "package.json") expect(m.repository?.directory, file).toBe(file.slice(0, -"/package.json".length));
    }
  });
});
