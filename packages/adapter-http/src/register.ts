/**
 * Registration (REQ-SURF-2, LLD §2.4).
 *
 * The registry is how `config.adapter` selects an implementation without anything
 * above the surface importing one. Only the CLI calls this.
 *
 * `hasAdapter` first, like every other adapter: `registerAllAdapters` is reached
 * from two bundles at once — `yam explore` registers from the one inside
 * `bin.js`, then `@svatah/yam-mcp` registers from `@svatah/yam`'s own — and the
 * module-local flag that makes it idempotent is per bundle while the registry is
 * one Map. Without this the second caller threw "already registered" and took
 * `yam explore` down before it served a tool.
 */
import { hasAdapter, registerAdapter } from "@svatah/yam-surface";
import { createHttpSurface } from "./surface.js";

export const HTTP_ADAPTER = "http";

export function registerHttpAdapter(): void {
  if (hasAdapter(HTTP_ADAPTER)) return;
  registerAdapter(HTTP_ADAPTER, (config) => createHttpSurface(config));
}
