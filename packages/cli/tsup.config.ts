import { defineConfig } from "tsup";
import base from "../../tsup.config.js";

/**
 * The CLI builds two entry points rather than the workspace's usual one: the
 * library surface at `src/index.ts`, and the `yam` executable at `src/bin.ts`
 * that `package.json`'s `bin` field points at.
 */
export default defineConfig({
  ...(base as Record<string, unknown>),
  entry: ["src/index.ts", "src/bin.ts"],
  /*
   * `@svatah/yam-mcp` is never bundled (PK-01, PK-05).
   *
   * `explore` reaches the server with `await import("@svatah/yam" + "-mcp")`,
   * and the concatenation was there to stop a bundler following it. esbuild
   * folds constant strings, so it followed it anyway — and then tried to bundle
   * a package that depends on *this* one, which is a circle it resolves by
   * reading `packages/cli/dist/index.js`. On a machine that had built before,
   * that file exists and the build succeeds while quietly pulling the six-
   * megabyte MCP SDK into the base install; on a clean checkout it does not
   * exist and the build fails outright.
   *
   * Saying it is external is the honest form of what the concatenation was
   * trying to express.
   */
  external: [...((base as { external?: string[] }).external ?? []), "@svatah/yam-mcp"],
  // The help topics, as markdown, beside the code that prints them (T14.3).
  publicDir: "public",
  banner: { js: "" },
});
