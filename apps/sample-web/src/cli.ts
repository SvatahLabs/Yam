/**
 * `pnpm --filter sample-web start` — serves the sample application on port 4173
 * (T0.5). `PORT` overrides it; 0 asks the OS for a free port.
 */
import { DEFAULT_PORT, startSampleApp } from "./server.js";
import { PAGES } from "./pages.js";
import { VARIANTS } from "./variants.js";

const port = process.env["PORT"] === undefined ? DEFAULT_PORT : Number(process.env["PORT"]);

const app = await startSampleApp(port);

console.log(`sample-web listening on ${app.origin}`);
console.log(`  ${PAGES.length} pages, ${VARIANTS.length} variants (?variant=1..${VARIANTS.length})`);
for (const page of PAGES) console.log(`  ${app.origin}${page.path}  — ${page.title}`);
console.log(`  ${app.origin}/api/active-count`);
console.log(`  ${app.origin}/api/variants`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
