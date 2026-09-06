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
import { registerHttpAdapter } from "@svatah/adapter-http";
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
  /*
   * The HTTP adapter as a *surface*, not only as the `api` runner (T12.7).
   *
   * `createSurface` has taken `http` since LLD §2.4 was written and nothing
   * registered one, so `adapter: http` in a config answered "No adapter
   * registered under \"http\"" — which reads like a missing install and is not.
   * The self suite's HTTP side is the first project to open a session on it
   * (LLD §13.9): a flow whose every step is `Call the "…" API` or `Wait for the
   * "…" API to answer …` needs a session of some kind, and this is the one it
   * needs.
   */
  registerHttpAdapter();
  registered = true;
}
