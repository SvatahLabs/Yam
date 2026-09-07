import { defineConfig } from "tsup";

/**
 * Two entries, for one reason: **the renderer is a browser** (REQ-ADE-2).
 *
 * The shared `../../tsup.config.ts` builds one entry per package (LLD §1) with
 * `treeshake: false`, so `dist/index.js` is a single file carrying every module
 * of this package — including `canonical.ts`'s `import { createHash } from
 * "node:crypto"`. Any browser bundle that touched *anything* in this package
 * therefore pulled a Node built-in in with it, and Vite resolves `crypto` to
 * `__vite-browser-external`, which exports nothing.
 *
 * That is not hypothetical. `packages/screens` needs `offeredActions` to draw
 * the action inspector's forms (T15), the desktop's renderer bundles
 * `packages/screens`, and so `pnpm --filter @svatah/yam-desktop package` failed
 * to build the shipped renderer at all:
 *
 *   RollupError: "createHash" is not exported by "__vite-browser-external",
 *   imported by "…/@svatah/yam-schema/dist/index.js"
 *
 * It went unseen through wave 3 because the evidence harness aliased `crypto`
 * to a stub of its own and `shell.spec.ts` skips when there is no packaged
 * build — so the one thing neither could report was that there could not *be*
 * one. Wave 4 drives the packaged app, which is what surfaced it.
 *
 * `src/action-forms.ts` is the browser-safe half a screen model needs: the
 * action vocabulary as data, over `surface.ts` and zod and nothing else. It is
 * a second *build* entry, not a second public surface — `index.ts` still
 * re-exports every one of its names, so Node callers are unchanged and there is
 * still one place the vocabulary is defined.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/action-forms.ts"],
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
