import { defineConfig } from "tsup";

/**
 * The design system builds like every other package (LLD §1) with three
 * differences.
 *
 * The entry is a `.tsx`. React is external, because a renderer brings its own
 * and two copies of React in one window is a broken hook. And **Radix is
 * bundled**: it is an implementation detail of this package — nothing outside
 * imports `@radix-ui/*`, and `eslint.config.js` forbids a screen doing so — and
 * leaving it external made every consumer responsible for resolving Radix's own
 * transitive imports. Under pnpm's strict isolation the ADE's Vite build could
 * not: it found `@radix-ui/react-tabs` in this package's `node_modules` and then
 * failed on `@radix-ui/primitive`, which is nested one level further in.
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
  noExternal: [/^@radix-ui\//],
});
