/**
 * Adapter registration (LLD §1, REQ-SURF-2).
 *
 * The CLI is the only package allowed to import an `adapter-*` package, because
 * it is the only one that has to know which implementations exist. Everything
 * else reaches an adapter through `createSurface(config)`.
 *
 * Phase 1 ships one adapter. The others are Phase 2 and later; registering them
 * here as they arrive is the whole of what "adding an adapter" means.
 */
import { registerPlaywrightAdapter } from "@svatah/adapter-playwright";

let registered = false;

export function registerAllAdapters(): void {
  if (registered) return;
  registerPlaywrightAdapter();
  registered = true;
}
