import { registerAdapter, hasAdapter } from "@svatah/surface";
import { createPlaywrightSurface } from "./surface.js";

/** The name this adapter is selected by in `svatah.config.yaml` (LLD §2.4). */
export const PLAYWRIGHT_ADAPTER_NAME = "playwright";

/**
 * Register the adapter. Idempotent, because the registry refuses a silent
 * replacement and a process may reach this from both the CLI and a test host.
 */
export function registerPlaywrightAdapter(): void {
  if (hasAdapter(PLAYWRIGHT_ADAPTER_NAME)) return;
  registerAdapter(PLAYWRIGHT_ADAPTER_NAME, (config) => createPlaywrightSurface(config));
}
