import { registerAdapter, hasAdapter } from "@svatah/surface";
import { createUiaSurface } from "./surface.js";

/** The name this adapter is selected by in `svatah.config.yaml` (LLD §2.4). */
export const UIA_ADAPTER_NAME = "uia";

/** Register the adapter. Idempotent, like every other registration. */
export function registerUiaAdapter(): void {
  if (hasAdapter(UIA_ADAPTER_NAME)) return;
  registerAdapter(UIA_ADAPTER_NAME, (config) => createUiaSurface(config as never));
}
