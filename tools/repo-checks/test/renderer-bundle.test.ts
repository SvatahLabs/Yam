/**
 * The renderer is a browser, and the packaged application can be built (T18).
 *
 * Wave 3 shipped a desktop that `pnpm --filter @svatah/yam-desktop package`
 * could not build at all:
 *
 *   RollupError: "createHash" is not exported by "__vite-browser-external",
 *   imported by "…/@svatah/yam-schema/dist/index.js"
 *
 * `@svatah/yam-schema` is built as one bundled entry with `treeshake: false`,
 * so its `canonical.ts` — which imports `node:crypto` — is in the same file as
 * everything else in the package. `packages/screens` needs `offeredActions` to
 * draw the action inspector's forms, the renderer bundles `packages/screens`,
 * and Vite maps a bare `crypto` to `__vite-browser-external`, which exports
 * nothing.
 *
 * Two things kept it invisible for a whole wave, and this file is aimed at
 * both:
 *
 *   * the evidence harness had a Vite config of its own that aliased `crypto`
 *     to a stub, so the bundle it linked was not the bundle the product ships;
 *   * `apps/desktop/test/shell.spec.ts` skips when there is no packaged build,
 *     so "there could not be one" was reported as "nothing to check".
 *
 * Packaging takes minutes and needs Electron, so it is not run here. What is
 * asserted is the *cause*: the built `@svatah/yam-screens` — everything the
 * renderer pulls from the workspace — imports no Node built-in, and the two
 * Vite configs are the same.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fromRoot } from "../src/repo.js";

/** Every specifier a built ESM file imports. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/^\s*(?:import|export)[^'"]*from\s*["']([^"']+)["']/gm)].map(
    (one) => one[1]!,
  );
}

const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((one) => `node:${one}`),
]);

describe("the renderer can be bundled for a browser (T18, REQ-ADE-2)", () => {
  const screens = fromRoot("packages/screens/dist/index.js");

  it.skipIf(!existsSync(screens))(
    "the screen model imports no Node built-in, so a browser bundle links",
    () => {
      const offending = importsOf(screens).filter((one) => NODE_BUILTINS.has(one));
      expect(
        offending,
        `packages/screens/dist/index.js imports ${offending.join(", ")}. The renderer bundles ` +
          "this package; a Node built-in here is a desktop that cannot be packaged. Import the " +
          "browser-safe entry (`@svatah/yam-schema/action-forms`) rather than the barrel.",
      ).toEqual([]);
    },
  );

  it("publishes a browser-safe entry for the action vocabulary", () => {
    const pkg = JSON.parse(
      readFileSync(fromRoot("packages/schema/package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };
    expect(
      pkg.exports["./action-forms"],
      "`@svatah/yam-schema/action-forms` is what a screen model imports instead of the barrel; " +
        "the barrel carries `canonical.ts`'s node:crypto.",
    ).toBeDefined();
  });

  const shipped = fromRoot("apps/desktop/vite.renderer.config.ts");
  const harness = fromRoot("apps/desktop/surfaces-harness.vite.config.mjs");

  it("the evidence harness builds the same bundle the product ships", () => {
    /*
     * Compared by what they *configure*, not by their prose: both are read for
     * their `resolve` block, and the harness must add nothing. An alias here is
     * exactly what hid the defect above — a harness that links a bundle the
     * product does not is a harness reporting on something nobody runs.
     */
    const aliasIn = (file: string): boolean => /alias\s*:/.test(readFileSync(file, "utf8"));
    expect(
      aliasIn(harness),
      `${harness} configures a module alias. The shipped renderer is built from ` +
        `${shipped} without one, so anything aliased here is a difference between the ` +
        "evidence and the product.",
    ).toBe(false);
    expect(aliasIn(shipped)).toBe(false);
  });

  it("no crypto stub survives in the desktop's test directory", () => {
    expect(
      existsSync(fromRoot("apps/desktop/test/harness-crypto-stub.mjs")),
      "the stub is what made an unbuildable renderer look buildable; it is deleted, not disabled",
    ).toBe(false);
  });
});
