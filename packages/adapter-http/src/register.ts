/**
 * Registration (REQ-SURF-2, LLD §2.4).
 *
 * The registry is how `config.adapter` selects an implementation without anything
 * above the surface importing one. Only the CLI calls this.
 */
import { registerAdapter } from "@svatah/surface";
import { createHttpSurface } from "./surface.js";

export const HTTP_ADAPTER = "http";

export function registerHttpAdapter(): void {
  registerAdapter(HTTP_ADAPTER, (config) => createHttpSurface(config));
}
