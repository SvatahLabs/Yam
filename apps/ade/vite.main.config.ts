import { defineConfig } from "vite";

/**
 * The main process. Node, not a browser: `electron` and every `node:` module are
 * external so Vite bundles the ADE's own code and nothing else.
 *
 * `entryFileNames` is explicit because Forge looks for `.vite/build/main.js` and
 * the source is `src/main/index.ts`. Without it this and the preload build would
 * both write `index.js`, and the second would overwrite the first — which is
 * exactly what happened the first time.
 *
 * The output is CommonJS, which is Forge's own template layout and the reason
 * `apps/ade/package.json` has no `"type": "module"`: a sandboxed preload has no
 * ES module loader (Electron's security checklist requires the sandbox), so the
 * preload must be CJS, and having the two halves of one process disagree about
 * their module system buys nothing.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron", /^node:/],
      output: { entryFileNames: "main.js" },
    },
  },
});
