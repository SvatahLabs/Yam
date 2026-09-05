import { registerAdapter, hasAdapter } from "@svatah/surface";
import { createAxSurface } from "./surface.js";

/** The name this adapter is selected by in `svatah.config.yaml` (LLD §2.4). */
export const AX_ADAPTER_NAME = "ax";

/**
 * Register the adapter. Idempotent, because the registry refuses a silent
 * replacement and a process may reach this from both the CLI and a test.
 */
export function registerAxAdapter(): void {
  if (hasAdapter(AX_ADAPTER_NAME)) return;
  registerAdapter(AX_ADAPTER_NAME, (config) => createAxSurface(config as never));
}
