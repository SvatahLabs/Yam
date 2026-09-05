import { registerAdapter, hasAdapter } from "@svatah/surface";
import { createBidiSurface } from "./surface.js";

/** The name this adapter is selected by in `svatah.config.yaml` (LLD §2.4). */
export const BIDI_ADAPTER_NAME = "bidi";

/**
 * Register the adapter. Idempotent, because the registry refuses a silent
 * replacement and a process may reach this from both the CLI and a test.
 */
export function registerBidiAdapter(): void {
  if (hasAdapter(BIDI_ADAPTER_NAME)) return;
  registerAdapter(BIDI_ADAPTER_NAME, (config) => createBidiSurface(config));
}
