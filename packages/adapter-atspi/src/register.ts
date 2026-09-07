/**
 * Registration (REQ-SURF-2, LLD §2.4).
 *
 * Registered on every platform, like the other desktop adapters: `yam surface
 * doctor` has to be able to say "atspi: this host is darwin" rather than "no
 * such adapter", which sends a reader looking for a missing install of Yam
 * instead of a missing accessibility bus.
 */
import { registerAdapter } from "@svatah/yam-surface";
import { createAtspiSurface } from "./surface.js";

export const ATSPI_ADAPTER = "atspi";

export function registerAtspiAdapter(): void {
  registerAdapter(ATSPI_ADAPTER, (config) => createAtspiSurface(config));
}
