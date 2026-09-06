/**
 * Adapter registration for module (a) (LLD §1, REQ-SURF-2).
 *
 * A command line is one of the few things allowed to import an `adapter-*`
 * package, because it is the thing that has to know which implementations exist.
 * Everything else reaches one through `createSurface(config)`.
 *
 * This one registers Playwright and nothing else. Module (a) is what a plain
 * Playwright user installs (REQ-PKG-1), and the other adapters live in module
 * (b)'s dependency tree; `@svatah/yam` registers all of them.
 */
import { registerPlaywrightAdapter } from "@svatah/yam-adapter-playwright";

let registered = false;

export function registerAllAdapters(): void {
  if (registered) return;
  registerPlaywrightAdapter();
  registered = true;
}
