import { defineConfig } from "vite";

/**
 * The preload script: the only code that sees both sides (LLD §13.6).
 *
 * CommonJS, deliberately. A **sandboxed** preload — which this one is
 * (`sandbox: true`, Electron's security checklist) — runs in a restricted
 * context with no ES module loader, so an ESM preload does not load at all.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron", /^node:/],
      // `main/index.ts` loads it as `preload.js` beside itself.
      output: { entryFileNames: "preload.js" },
    },
  },
});
