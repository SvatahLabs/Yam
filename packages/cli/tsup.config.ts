import { defineConfig } from "tsup";
import base from "../../tsup.config.js";

/**
 * The CLI builds two entry points rather than the workspace's usual one: the
 * library surface at `src/index.ts`, and the `svatah` executable at `src/bin.ts`
 * that `package.json`'s `bin` field points at.
 */
export default defineConfig({
  ...(base as Record<string, unknown>),
  entry: ["src/index.ts", "src/bin.ts"],
  banner: { js: "" },
});
