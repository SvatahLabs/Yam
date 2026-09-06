import { defineConfig } from "tsup";

/**
 * `yam ui` builds like every other package (LLD §1), with a `.tsx` entry and
 * React external — the CLI mounts this, and two copies of React in one process
 * is a broken hook.
 */
export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: false,
  splitting: false,
  external: ["react", "react/jsx-runtime", "ink"],
});
