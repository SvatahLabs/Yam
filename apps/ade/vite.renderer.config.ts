import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The renderer. A browser, and nothing more.
 *
 * No Node built-ins are made available and none are polyfilled: the renderer
 * reaches the outside world through the service over HTTP and through the
 * preload bridge, and `test/renderer-isolation.test.ts` asserts that is still
 * true (REQ-ADE-2).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    /*
     * One React in the window (T9.4).
     *
     * `@svatah/yam-ui` declares React as a peer dependency *and* a devDependency, so
     * pnpm gives it its own copy under `packages/ui/node_modules/react` — and
     * Vite, resolving through the workspace link, bundled that one beside the
     * ADE's. Two Reacts share no dispatcher, so the first hook in a design-system
     * component threw `Cannot read properties of null (reading 'useState')` and
     * the window rendered nothing.
     *
     * `dedupe` makes every `react` specifier resolve to the ADE's copy, which is
     * what a peer dependency means.
     */
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
});
