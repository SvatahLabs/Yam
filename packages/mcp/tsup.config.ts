import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: true,
  external: ["playwright", "playwright-core", "@playwright/test", "chromium-bidi", "webdriverio"],
});
