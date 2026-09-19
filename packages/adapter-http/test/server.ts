/**
 * A local echo server for the field matrix (T2.6 Validate).
 *
 * Every route answers with what it received, so a test asserts on the *request*
 * the adapter built rather than on a mock's recollection of it. That is the
 * difference between testing the adapter and testing the test: a header the
 * adapter never sent cannot appear here.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface EchoServer {
  readonly origin: string;
  /** The port, for a test that reaches the server under another name. */
  readonly port: number;
  close(): Promise<void>;
}

interface Echo {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res: ServerResponse, status: number, body: string, type: string): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

export async function startEchoServer(): Promise<EchoServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const echo: Echo = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : (v ?? "")]),
        ),
        body: await readBody(req),
      };

      if (url.pathname === "/login") {
        res.writeHead(200, {
          "content-type": "application/json",
          "set-cookie": ["session=abc123; Path=/; HttpOnly", "theme=dark; Path=/"],
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (url.pathname.endsWith("/set-cookie")) {
        // Every `c` is sent back as a Set-Cookie line, attributes and all, so a
        // test says exactly what a server set; under any path, so the path a
        // cookie defaults to can be chosen.
        res.writeHead(200, { "content-type": "application/json", "set-cookie": url.searchParams.getAll("c") });
        res.end(JSON.stringify(echo));
        return;
      }

      if (url.pathname === "/redirect") {
        res.writeHead(302, { location: "/echo" });
        res.end();
        return;
      }

      if (url.pathname === "/redirect-to") {
        // A redirect to wherever `to` says, another host included, for the
        // tests that follow a request to where it ended up.
        res.writeHead(302, { location: url.searchParams.get("to") ?? "/echo" });
        res.end();
        return;
      }

      if (url.pathname === "/slow") {
        // Slower than any timeout a test would set, so the timeout is what ends
        // the request rather than the loopback happening to be fast.
        setTimeout(() => send(res, 200, "eventually", "text/plain"), 2000);
        return;
      }

      if (url.pathname === "/text") {
        send(res, 200, "just text", "text/plain; charset=utf-8");
        return;
      }

      if (url.pathname === "/items") {
        send(
          res,
          200,
          JSON.stringify({
            activeCount: 3,
            items: [
              { id: "BK-1", total: 10 },
              { id: "BK-2", total: 20 },
            ],
            "odd key": { value: "here" },
          }),
          "application/json; charset=utf-8",
        );
        return;
      }

      if (url.pathname === "/status/418") {
        send(res, 418, JSON.stringify({ error: "teapot" }), "application/json");
        return;
      }

      send(res, 200, JSON.stringify(echo), "application/json; charset=utf-8");
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
  };
}
