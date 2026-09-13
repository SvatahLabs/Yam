/**
 * What a publish would actually put on the registry.
 *
 * Three facts, each of which was false when this file was written, and none of
 * which any existing check could see. They are grouped because they share a
 * cause: the release set, the licence and the script names are each derived
 * from something, and nothing compared the derivation to the claim.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromRoot } from "../src/repo.js";

interface ReleaseLib {
  publishablePackages: () => string[];
}

const releaseSet = async (): Promise<string[]> =>
  (
    (await import(fromRoot("scripts", "lib", "release-packages.mjs"))) as unknown as ReleaseLib
  ).publishablePackages();

/** Every package under `packages/` that npm would accept, by name. */
function publishableManifests(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  for (const dir of readdirSync(fromRoot("packages"))) {
    const manifest = fromRoot("packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name: string; private?: boolean };
    if (parsed.private === true) continue;
    out.push({ name: parsed.name, dir });
  }
  return out;
}

/**
 * The pages a user reads before they have the product. A package named here
 * with an install command is a promise that the registry has it.
 */
const USER_FACING = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/setup.md",
  "docs/features.md",
  "docs/examples.md",
  "docs/api.md",
  "docs/mcp.md",
  "docs/developer-guide.md",
];

describe("a publish puts on the registry what the documents promise", () => {
  /*
   * `@svatah/yam-mcp` is why this exists.
   *
   * The release set is a closure over a few roots, so a package gets in by
   * being depended upon. Nothing depends on the MCP server: `@svatah/yam` must
   * not, because that is a cycle and it would put the MCP SDK into every `yam`
   * install, so `yam explore` reaches it by a computed specifier instead. The
   * closure therefore did not contain it, while the README, five guides and the
   * command's own error message all told a person to install it. Publishing
   * would have made every one of those a 404, and nothing would have noticed
   * until somebody ran the command.
   */
  it("every package a user-facing page says to install is in the release set", async () => {
    const set = new Set(await releaseSet());
    const promised = new Map<string, string[]>();
    for (const page of USER_FACING) {
      const text = readFileSync(fromRoot(page), "utf8");
      for (const pattern of [
        /npm install (?:--save-dev |-g )?(@svatah\/[a-z-]+)/g,
        /npx -y (@svatah\/[a-z-]+)/g,
        /"args": \["-y", "(@svatah\/[a-z-]+)"/g,
      ]) {
        for (const match of text.matchAll(pattern)) {
          const name = match[1] as string;
          promised.set(name, [...(promised.get(name) ?? []), page]);
        }
      }
    }
    expect(promised.size, "no page names a package to install — the patterns have rotted").toBeGreaterThan(0);
    const missing = [...promised.entries()].filter(([name]) => !set.has(name));
    expect(
      missing.map(([name, pages]) => `${name} (promised by ${pages.join(", ")})`),
      "a page tells a user to install a package the release set does not publish",
    ).toEqual([]);
  });

  it("the generated reference offers no install the release set cannot honour", async () => {
    const set = new Set(await releaseSet());
    const dir = fromRoot("docs", "reference", "generated", "packages");
    const offered: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const match = /^- Install: `npm install (@svatah\/[a-z-]+)`/m.exec(readFileSync(join(dir, file), "utf8"));
      if (match !== null && !set.has(match[1] as string)) offered.push(`${file}: ${match[1] as string}`);
    }
    expect(offered).toEqual([]);
  });

  /*
   * Apache-2.0 §4(a): "You must give any other recipients of the Work a copy of
   * this License." Every manifest carried `"license": "Apache-2.0"` and not one
   * package directory carried the text, so every tarball would have shipped the
   * label without the licence. npm includes a `LICENSE` whether or not `files`
   * lists it, so the file existing is the whole fix — and its absence is
   * invisible to a manifest check, which is why this reads the directory.
   */
  it("every publishable package ships the licence it claims", () => {
    const packages = publishableManifests();
    expect(packages.length).toBeGreaterThan(30);
    const root = readFileSync(fromRoot("LICENSE"), "utf8");
    const wrong: string[] = [];
    for (const { name, dir } of packages) {
      const licence = fromRoot("packages", dir, "LICENSE");
      if (!existsSync(licence)) wrong.push(`${name}: no LICENSE`);
      else if (readFileSync(licence, "utf8") !== root) wrong.push(`${name}: LICENSE differs from the root's`);
    }
    expect(wrong).toEqual([]);
  });

  /*
   * `pnpm docs` is why this exists.
   *
   * pnpm hands a fixed list of commands straight to npm before it ever looks at
   * `package.json`, and `docs` is on it. So `pnpm docs` opened a home page,
   * printed nothing and exited 0, and `scripts/docs.mjs` never ran — while the
   * banner on all 73 generated pages, the contributing guide and the developer
   * guide each told a contributor to run exactly that. CI never caught it,
   * because CI calls `docs:check`, and pnpm forwards no name with a colon in it.
   *
   * The rule is only about that list. `test` and `publish` are npm commands too
   * and are *not* forwarded: pnpm implements them, and `pnpm test` runs the
   * script as anybody would expect. Checking "is it an npm command" would have
   * failed the repository's own `test` script for no reason.
   */
  it("no root script has a name pnpm hands to npm", () => {
    const scripts = Object.keys(
      (JSON.parse(readFileSync(fromRoot("package.json"), "utf8")) as { scripts: Record<string, string> }).scripts,
    );
    const shadowed = scripts.filter((name) => PASSED_THROUGH_TO_NPM.has(name));
    expect(shadowed, "pnpm forwards these to npm, so the script never runs").toEqual([]);
  });

  it("the shadowing check bites: `docs` is the name it was written for", () => {
    // The exact name, and the exact shape of the mistake: a colon-free script
    // whose name is on pnpm's list. If this stops holding, the rule above is
    // guarding nothing and should be deleted rather than left to look busy.
    expect(PASSED_THROUGH_TO_NPM.has("docs")).toBe(true);
    expect(["docs:build", "docs:check"].some((name) => PASSED_THROUGH_TO_NPM.has(name))).toBe(false);
    // The names pnpm implements itself, which the rule must not flag.
    for (const own of ["test", "publish", "run", "build", "lint"]) {
      expect(PASSED_THROUGH_TO_NPM.has(own), `${own} is pnpm's own`).toBe(false);
    }
  });
});

/**
 * The commands pnpm passes straight to npm, from its own source: the `switch`
 * at the top of `pnpm.cjs`, under the comment "commands that are passed through
 * to npm". Copied rather than read at run time because pnpm is installed a
 * dozen ways and none of them is a stable path, and because a list that only
 * grows is safe here: a name pnpm adds later would be a false pass, and the
 * bite case above holds the one that actually happened.
 */
const PASSED_THROUGH_TO_NPM = new Set([
  "access",
  "adduser",
  "bugs",
  "deprecate",
  "dist-tag",
  "docs",
  "edit",
  "find",
  "home",
  "info",
  "issues",
  "login",
  "logout",
  "owner",
  "ping",
  "prefix",
  "profile",
  "pkg",
  "repo",
  "s",
  "se",
  "search",
  "set-script",
  "show",
  "star",
  "stars",
  "team",
  "token",
  "unpublish",
  "unstar",
  "v",
  "version",
  "view",
  "whoami",
  "xmas",
]);
