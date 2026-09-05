/**
 * Start the sample application and tell the tests where it is.
 *
 * A real project would not have this: it would point `baseURL` at an application
 * it already runs. It exists so the example works from a clean checkout with no
 * ports to arrange.
 *
 * Port 4173 is tried first because it is the port T0.5 fixes the sample
 * application at; if it is busy the OS picks one. Either way the committed
 * bindings resolve, because a binding's context pattern is the *path* —
 * `/login`, not `http://127.0.0.1:65431/login` (LLD §3.5, Draft 2.3). A store
 * that named a port would work on the run that recorded it and on no other.
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
