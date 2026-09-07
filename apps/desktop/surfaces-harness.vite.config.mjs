/**
 * The renderer build for `test/surfaces-dogfood.mjs` (the browser-hosted
 * evidence, T14–T17).
 *
 * **Identical to `vite.renderer.config.ts`.** It exists only so a standalone
 * browser build can be produced without electron-forge, and it must stay
 * identical: it once carried an alias stubbing the Node `crypto` that
 * `@svatah/yam-schema`'s bundled barrel imports, and that alias is exactly what
 * hid a shipped renderer which could not be built at all (see
 * `packages/schema/tsup.config.ts`). A harness that links a bundle the product
 * does not is a harness reporting on something nobody runs.
 *
 * `tools/repo-checks/test/renderer-bundle.test.ts` keeps the two the same.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
});
