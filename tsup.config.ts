import { defineConfig } from "tsup";

/**
 * One build for every Yam package (LLD §1: ESM, Node 22 LTS, a single entry
 * point at `src/index.ts`). Packages reference this file with
 * `tsup --config ../../tsup.config.ts`, so `entry` and `outDir` resolve against
 * the package directory that tsup was invoked from.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  /*
   * The drivers are never bundled (P-W2-F5).
   *
   * A package that asks Playwright its version — which is how adapter readiness
   * is checked, since asking `npx` asks about the working directory rather than
   * about the install — makes esbuild try to *inline* Playwright, and
   * `playwright-core` has a conditional `require` of `chromium-bidi` that cannot
   * be resolved at bundle time. These are host drivers resolved at run time by
   * whoever has them installed; they are dependencies, not contents.
   */
  external: ["playwright", "playwright-core", "@playwright/test", "chromium-bidi"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: false,
});
