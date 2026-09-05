import type { SampleServer } from "sample-web";

export default async function globalTeardown(): Promise<void> {
  const app = (globalThis as Record<string, unknown>)["__sampleApp"] as SampleServer | undefined;
  await app?.close().catch(() => undefined);
}
