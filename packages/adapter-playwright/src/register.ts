import { registerAdapter, hasAdapter } from "@svatah/yam-surface";
import { createRequire } from "node:module";

/**
 * Whether this adapter can reach its driver, asked from *here* (PK-03).
 *
 * Resolution depends on where you ask from. A probe living in another package
 * asks a different question and gets a different answer under a strict
 * `node_modules` layout — which is how the first version reported a driver
 * missing on a machine that had it. Only the adapter is standing in the right
 * place.
 */
const resolved = (): boolean => {
  try {
    /*
     * The package, not its `package.json`: `webdriverio` does not export the
     * manifest, so resolving it threw `ERR_PACKAGE_PATH_NOT_EXPORTED` on a
     * machine where the driver was installed and the adapter reported it
     * missing. `resolve` loads nothing, so this stays as cheap as naming it.
     */
    createRequire(import.meta.url).resolve("playwright");
    return true;
  } catch {
    return false;
  }
};

/** The name this adapter is selected by in `yam.config.yaml` (LLD §2.4). */
export const PLAYWRIGHT_ADAPTER_NAME = "playwright";

/**
 * Register the adapter. Idempotent, because the registry refuses a silent
 * replacement and a process may reach this from both the CLI and a test host.
 */
export function registerPlaywrightAdapter(): void {
  if (hasAdapter(PLAYWRIGHT_ADAPTER_NAME)) return;
  /*
   * The driver is resolved on first use, not at load (PK-02, PK-04).
   *
   * `./surface.js` imports `playwright` at the top, so importing it here made
   * a 19-megabyte dependency the price of *naming* this adapter — and naming it
   * is what `yam surface doctor` has to do on a machine that has not installed
   * it, to say so. Registration is the name; the import is the connection.
   */
  registerAdapter(
    PLAYWRIGHT_ADAPTER_NAME,
    async (config) => {
    let made;
    try {
      made = await import("./surface.js");
    } catch (cause) {
      throw new Error(
        `The playwright adapter needs \`playwright\`, which is not installed. ` +
          "Run `npm i playwright && npx playwright install chromium`. " +
          `(${cause instanceof Error ? cause.message : String(cause)})`,
      );
    }
    return await made.createPlaywrightSurface(config);
    },
    { name: "playwright", resolved: resolved(), install: "npm i playwright && npx playwright install chromium" },
  );
}
