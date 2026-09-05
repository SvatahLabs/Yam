import { defineConfig } from "tsup";

/**
 * One build for every Svatah package (LLD §1: ESM, Node 22 LTS, a single entry
 * point at `src/index.ts`). Packages reference this file with
 * `tsup --config ../../tsup.config.ts`, so `entry` and `outDir` resolve against
 * the package directory that tsup was invoked from.
 */
export default defineConfig({
  entry: ["src/index.ts"],
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
