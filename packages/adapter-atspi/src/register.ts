/**
 * Registration (REQ-SURF-2, LLD §2.4).
 *
 * Registered on every platform, like the other desktop adapters: `yam surface
 * doctor` has to be able to say "atspi: this host is darwin" rather than "no
 * such adapter", which sends a reader looking for a missing install of Yam
 * instead of a missing accessibility bus.
 *
 * `hasAdapter` first, for the reason the HTTP adapter's registration records:
 * two bundles reach `registerAllAdapters` in one process and the registry is
 * shared between them, so registering has to be idempotent against the registry
 * rather than against a module-local flag.
 */
import { hasAdapter, registerAdapter } from "@svatah/yam-surface";
import { createAtspiSurface } from "./surface.js";

export const ATSPI_ADAPTER = "atspi";

export function registerAtspiAdapter(): void {
  if (hasAdapter(ATSPI_ADAPTER)) return;
  registerAdapter(ATSPI_ADAPTER, (config) => createAtspiSurface(config));
}
