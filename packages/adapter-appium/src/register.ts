import { registerAdapter, hasAdapter } from "@svatah/yam-surface";
import { createAppiumSurface } from "./surface.js";

/** The name this adapter is selected by in `yam.config.yaml` (LLD §2.4). */
export const APPIUM_ADAPTER_NAME = "appium";

/**
 * Register the adapter. Idempotent, because the registry refuses a silent
 * replacement and a process may reach this from both the CLI and a test.
 */
export function registerAppiumAdapter(): void {
  if (hasAdapter(APPIUM_ADAPTER_NAME)) return;
  registerAdapter(APPIUM_ADAPTER_NAME, (config) => createAppiumSurface(config));
}
