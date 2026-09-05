import { createServer, type Server, type ServerResponse } from "node:http";
import { APP_CSS, CANVAS_JS, PAGES, pageFor } from "./pages.js";
import { applyVariant, VARIANTS } from "./variants.js";

/** The port LLD §16 and T0.5 fix for the sample application. */
export const DEFAULT_PORT = 4173;

/**
 * The sample web application (T0.5).
 *
 * Deliberately a plain `node:http` server with no framework: the suites that run
 * against it must not be measuring a framework's behaviour, and a foreign runtime
 * implementer should be able to stand it up from the source alone.
 */
export interface SampleServer {
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

/** How many builds `GET /api/active-count` reports (REQ-LANG-8's "active count" API). */
const ACTIVE_COUNT = 3;

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

/** `?variant=N` — 0 (or absent) is the baseline; 1..20 are the deliberate changes. */
export function parseVariant(raw: string | null): number {
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= VARIANTS.length ? n : 0;
}

export function createSampleApp(): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
    const variant = parseVariant(url.searchParams.get("variant"));

    if (path === "/app.css") return send(res, 200, APP_CSS, "text/css; charset=utf-8");
    if (path === "/canvas.js") return send(res, 200, CANVAS_JS, "text/javascript; charset=utf-8");

    if (path === "/api/active-count") {
      return send(
        res,
        200,
        JSON.stringify({ activeCount: ACTIVE_COUNT, updatedAt: "2026-09-02T10:00:00.000Z" }),
        "application/json; charset=utf-8",
      );
    }

    if (path === "/api/variants") {
      return send(
        res,
        200,
        JSON.stringify(
          VARIANTS.map(({ id, title, kind, summary, breaks, pages }) => ({
            id,
            title,
            kind,
            summary,
            breaks,
            pages,
          })),
          null,
          2,
        ),
        "application/json; charset=utf-8",
      );
    }

    const page = pageFor(path);
    if (page === undefined) {
      return send(
        res,
        404,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><h1 data-testid="not-found">Not found</h1><p>No page at <code>${path.replace(/[<&]/g, "")}</code>.</p></body></html>`,
        "text/html; charset=utf-8",
      );
    }

    send(res, 200, applyVariant(page.html, page.path, variant), "text/html; charset=utf-8");
  });
}

/** Start the app. Port 0 asks the OS for a free port, which is what the tests use. */
export function startSampleApp(port: number = DEFAULT_PORT): Promise<SampleServer> {
  const server = createSampleApp();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actual = typeof address === "object" && address !== null ? address.port : port;
      resolve({
        server,
        port: actual,
        origin: `http://127.0.0.1:${actual}`,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((err) => (err ? fail(err) : done())),
          ),
      });
    });
  });
}

export { PAGES };
