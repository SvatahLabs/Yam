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
});
