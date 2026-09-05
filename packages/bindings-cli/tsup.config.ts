import { defineConfig } from "tsup";
import base from "../../tsup.config.js";

/** Two entries: the library surface, and the `svatah-bindings` executable. */
export default defineConfig({
  ...(base as Record<string, unknown>),
  entry: ["src/index.ts", "src/bin.ts"],
  banner: { js: "" },
});
