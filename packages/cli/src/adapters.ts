/**
 * Adapter registration (LLD §1, REQ-SURF-2).
 *
 * The CLI is the only package allowed to import an `adapter-*` package, because
 * it is the only one that has to know which implementations exist. Everything
 * else reaches an adapter through `createSurface(config)`.
 *
 * Registering an adapter here is the whole of what "adding an adapter" means:
 * Phase 1 shipped Playwright, Phase 4 adds BiDi (T4.1) and Appium (T4.2), and
 * neither the compiler, the executor, the recorder nor the healer changed a line
 * to accommodate either. That is the claim REQ-SURF-2 makes, and this file is
 * where it is either true or not.
 */
import { registerPlaywrightAdapter } from "@svatah/adapter-playwright";
import { registerBidiAdapter } from "@svatah/adapter-bidi";

let registered = false;

export function registerAllAdapters(): void {
  if (registered) return;
  registerPlaywrightAdapter();
  registerBidiAdapter();
  registered = true;
}
