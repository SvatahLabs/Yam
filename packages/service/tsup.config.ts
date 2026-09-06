import { defineConfig } from "tsup";

/**
 * Two entry points, not the workspace default's one (T8.1).
 *
 * `src/runtime.ts` resolves the Node that runs `yam serve` (LLD §13.6). The
 * app's main process needs it and is bundled by Vite, so importing it from this
 * package's root would pull Fastify and the whole service into an Electron main
 * bundle that spawns the service rather than hosting it. A subpath export keeps
 * the app's import to the twelve-kilobyte thing it actually wants.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/runtime.ts"],
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
