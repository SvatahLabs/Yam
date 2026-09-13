/**
 * The workspace builds from a clean checkout (PK-02, and the only checkout
 * anybody installing has).
 *
 * `pnpm -r build` orders packages by their workspace dependencies — *unless the
 * graph has a cycle*, and then it gives up ordering and builds the members of
 * the cycle at once. That is not a warning anybody sees; it is two `tsup` runs
 * racing, and the one that needs the other's `index.d.ts` loses about as often
 * as it wins.
 *
 * It happened here. `@svatah/yam-mcp` depends on `@svatah/yam`, and
 * `@svatah/yam` declared `@svatah/yam-mcp` back — as a dev dependency so the
 * explore tests could resolve it, and as an optional peer to say "install this
 * if you want that feature". Either alone closes the circle. On the machine
 * that had built before, `packages/cli/dist/index.d.ts` was already there and
 * everything passed; on a clean checkout `pnpm -r build` failed. Found by
 * merging to master and running the install steps rather than writing them.
 *
 * A cycle through a **dev** dependency is the ordinary way a monorepo says "this
 * package's tests use that one", and it is still a cycle as far as the build
 * order is concerned. So the rule is about the whole graph, and the fix for a
 * real one is to move the link to the workspace root — which is not part of the
 * build — rather than to exempt it here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fromRoot } from "../src/repo.js";

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

/** Every workspace package that `pnpm -r` would run a script in. */
function workspace(): Map<string, { dir: string; manifest: Manifest }> {
  const found = new Map<string, { dir: string; manifest: Manifest }>();
  for (const group of ["packages", "apps", "tools", "examples"]) {
    const base = fromRoot(group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base)) {
      const path = join(base, entry, "package.json");
      if (!existsSync(path)) continue;
      const manifest = JSON.parse(readFileSync(path, "utf8")) as Manifest;
      if (manifest.name !== undefined) found.set(manifest.name, { dir: join(group, entry), manifest });
    }
  }
  return found;
}

/**
 * The edges `pnpm` orders on: anything that names another workspace package.
 *
 * Peers included, and that is the point — an *optional* peer on a package that
 * depends on you is still a circle, and pnpm treats it as one.
 */
function edges(manifest: Manifest, members: ReadonlySet<string>): string[] {
  const all = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  };
  return Object.keys(all).filter((one) => members.has(one));
}

describe("the workspace has a build order (PK-02)", () => {
  const members = workspace();
  const names = new Set(members.keys());

  it("has no cycle among its packages", () => {
    const cycles: string[] = [];
    const state = new Map<string, "open" | "done">();

    const walk = (name: string, path: readonly string[]): void => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "open") {
        const from = path.indexOf(name);
        cycles.push([...path.slice(from < 0 ? 0 : from), name].join(" → "));
        return;
      }
      state.set(name, "open");
      for (const next of edges(members.get(name)!.manifest, names)) walk(next, [...path, name]);
      state.set(name, "done");
    };

    for (const name of names) walk(name, []);
    expect(cycles, cycles.join("\n")).toEqual([]);
  });

  it("would find the cycle that was there: shown to bite", () => {
    /*
     * `@svatah/yam` ⇄ `@svatah/yam-mcp`, as the manifests read before this was
     * written. A rule that cannot find the cycle it was written for is a rule
     * that found nothing.
     */
    const fake = new Map<string, Manifest>([
      ["@svatah/yam", { name: "@svatah/yam", peerDependencies: { "@svatah/yam-mcp": "workspace:*" } }],
      ["@svatah/yam-mcp", { name: "@svatah/yam-mcp", dependencies: { "@svatah/yam": "workspace:*" } }],
    ]);
    const fakeNames = new Set(fake.keys());
    const state = new Map<string, "open" | "done">();
    let found = 0;
    const walk = (name: string): void => {
      if (state.get(name) === "done") return;
      if (state.get(name) === "open") {
        found += 1;
        return;
      }
      state.set(name, "open");
      for (const next of edges(fake.get(name)!, fakeNames)) walk(next);
      state.set(name, "done");
    };
    for (const name of fakeNames) walk(name);
    expect(found, "the rule cannot see a two-package cycle").toBeGreaterThan(0);
  });

  it("counts a package only when `pnpm -r` would build it", () => {
    /* If this found nothing, the rule above would pass by walking an empty graph. */
    expect(members.size, "no workspace packages were found").toBeGreaterThan(20);
    const buildable = [...members.values()].filter((one) => one.manifest.scripts?.["build"] !== undefined);
    expect(buildable.length, "no package has a build script").toBeGreaterThan(20);
  });
});
