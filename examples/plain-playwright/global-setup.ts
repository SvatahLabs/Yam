/**
 * Start the sample application and tell the tests where it is.
 *
 * A real project would not have this: it would point `baseURL` at an application
 * it already runs. It exists so the example works from a clean checkout with no
 * ports to arrange.
 *
 * Port 4173 is tried first — it is the port T0.5 fixes the sample application at,
 * and the committed bindings under `bindings/` record their context against it,
 * so the store reads as something a person wrote rather than as a machine's
 * ephemeral port. If it is busy the OS picks one; the bindings still resolve,
 * because an entry whose URL pattern does not match is still the entry for the
 * element (LLD §6.3).
 */
import { startSampleApp, DEFAULT_PORT, type SampleServer } from "sample-web";

export default async function globalSetup(): Promise<void> {
  if (process.env["SVATAH_BASE_URL"] !== undefined) return;

  let app: SampleServer;
  try {
    app = await startSampleApp(DEFAULT_PORT);
  } catch {
    app = await startSampleApp(0);
  }

  process.env["SVATAH_BASE_URL"] = app.origin;
  (globalThis as Record<string, unknown>)["__sampleApp"] = app;
}
