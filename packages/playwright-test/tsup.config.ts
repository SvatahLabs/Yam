import { defineConfig } from "tsup";

/**
 * Two entry points, because two callers need very different halves (PK-04).
 *
 * `bind()` and its fixture need Playwright. The *grounder registry* — three
 * functions over a map — needs nothing but Yam's own types, and it is the only
 * part `@svatah/yam` uses. One entry point meant the CLI imported a barrel that
 * re-exported the fixture, so `npm i @svatah/yam` installed a 19-megabyte
 * browser driver to reach three functions.
 *
 * The shared config is copied rather than spread: it exports the result of
 * `defineConfig`, which is not an object that carries its own `entry` through a
 * spread — the first attempt built one entry point and said nothing.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/grounder.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: false,
  /*
   * Split, which this repository does not do anywhere else and must here.
   *
   * Two entry points bundling one module give two copies of its state, and the
   * grounder registry *is* state: the CLI wrote to the copy in `grounder.js`
   * while everything importing the barrel read the copy in `index.js`, so
   * registering a grounder appeared to do nothing. Splitting emits one shared
   * chunk that both entries point at, which is one registry again.
   */
  splitting: true,
  /*
   * The self-reference is external, so the barrel *points at* the grounder
   * entry instead of inlining a second copy of its registry (PK-04).
   */
  external: [
    "playwright",
    "playwright-core",
    "@playwright/test",
    "chromium-bidi",
  ],
});
