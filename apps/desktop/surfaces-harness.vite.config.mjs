/**
 * The renderer build for `test/surfaces-dogfood.mjs` (T14 driven verification).
 *
 * Identical to `vite.renderer.config.ts`, plus one alias: the Node `crypto`
 * `createHash` that `@svatah/yam-schema`'s canonical hashing imports is stubbed
 * for the browser bundle. The Surfaces path never hashes — it only reads
 * `GET /targets` and `GET /sessions` and posts a connect — so the stub is never
 * called; it exists so a standalone browser build links without electron-forge.
 * This config is for the evidence harness only; the shipped renderer is built by
 * electron-forge from `vite.renderer.config.ts`.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: [{ find: /^crypto$/, replacement: join(here, "test", "harness-crypto-stub.mjs") }],
  },
});
