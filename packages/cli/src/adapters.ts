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
import { registerAppiumAdapter } from "@svatah/adapter-appium";
import { registerAxAdapter } from "@svatah/adapter-ax";
import { registerUiaAdapter } from "@svatah/adapter-uia";

let registered = false;

export function registerAllAdapters(): void {
  if (registered) return;
  registerPlaywrightAdapter();
  registerBidiAdapter();
  registerAppiumAdapter();
  /*
   * The desktop adapters are registered on every platform, not only on their
   * own (T6.1, T6.2). `svatah surface doctor` has to be able to say "ax: not
   * macOS" on Windows, and `createSurface({ adapter: "uia" })` has to fail with
   * the adapter's own message about the host rather than with "no such
   * adapter", which would send someone looking for a missing install.
   */
  registerAxAdapter();
  registerUiaAdapter();
  registered = true;
}
