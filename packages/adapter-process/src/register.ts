/**
 * Registration (REQ-SURF-2, LLD §2.4).
 *
 * The registry is how `config.adapter` selects an implementation without
 * anything above the surface importing one. Only the CLI calls this.
 */
import { registerAdapter } from "@svatah/yam-surface";
import { createProcessSurface } from "./surface.js";

export const PROCESS_ADAPTER = "process";

export function registerProcessAdapter(): void {
  registerAdapter(PROCESS_ADAPTER, (config) => createProcessSurface(config));
}
