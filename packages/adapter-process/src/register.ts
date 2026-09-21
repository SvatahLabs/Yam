/**
 * Registration (REQ-SURF-2, LLD §2.4).
 *
 * The registry is how `config.adapter` selects an implementation without
 * anything above the surface importing one. Only the CLI calls this.
 *
 * `hasAdapter` first, for the reason the HTTP adapter's registration records:
 * two bundles reach `registerAllAdapters` in one process and the registry is
 * shared between them, so registering has to be idempotent against the registry
 * rather than against a module-local flag.
 */
import { hasAdapter, registerAdapter } from "@svatah/yam-surface";
import { createProcessSurface } from "./surface.js";

export const PROCESS_ADAPTER = "process";

export function registerProcessAdapter(): void {
  if (hasAdapter(PROCESS_ADAPTER)) return;
  registerAdapter(PROCESS_ADAPTER, (config) => createProcessSurface(config));
}
