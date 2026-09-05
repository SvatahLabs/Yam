import { defineConfig } from "tsup";

/**
 * sample-web has two entry points: the library the suites import, and the CLI
 * `pnpm --filter sample-web start` runs. The shared root config assumes one, so
 * this app keeps its own.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  dts: { entry: "src/index.ts" },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: false,
});
