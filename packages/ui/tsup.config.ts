import { defineConfig } from "tsup";

/**
 * The design system builds like every other package (LLD §1) with two
 * differences: the entry is a `.tsx`, and React is external because a renderer
 * brings its own — two copies of React in one window is a broken hook.
 */
export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node22",
  platform: "neutral",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: false,
  external: ["react", "react-dom", "react/jsx-runtime"],
});
