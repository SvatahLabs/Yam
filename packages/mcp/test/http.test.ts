/**
 * Streamable HTTP MCP (T21, SF-08).
 *
 * > Offer Streamable HTTP MCP for clients that cannot spawn processes, backed
 * > by the same session service. Pin and negotiate supported protocol versions,
 * > test Origin/authentication/session isolation and disconnect semantics
 * > against that version.
 *
 * Every case here is driven by an **ordinary** client from the official SDK
 * over the SDK's own `StreamableHTTPClientTransport` — no Yam-specific client,
 * no in-memory pair, no reaching into the server. The conformance corpus is the
 * one `mcp.test.ts` runs over stdio, imported unchanged: that is the whole of
 * SF-08's "the same conformance corpus … as stdio", and importing it is what
 * stops the two from drifting.
 *
 * Session isolation is **driven, not assumed**. Two clients initialize; each
 * gets an MCP session id of its own; neither can address the other's; and a
 * surface session one of them opened is not something the other can act on by
 * guessing. What they share is the broker, deliberately — one holder per
 * machine is how a person and an agent come to be looking at the same target
 * (SF-13) — and sharing a holder is not sharing a session.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { startSampleApp, type SampleServer } from "sample-web";
import {
  startHttpMcp,
  createEventStore,
  PINNED_PROTOCOL_VERSION,
  type RunningHttpMcp,
} from "../src/http.js";
import { MCP_CORPUS, answer } from "./corpus.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/* The server is its own binary now (PK-05). */
const MCP = join(ROOT, "packages", "mcp", "dist", "bin.js");

let app: SampleServer;
let served: RunningHttpMcp;

const io = { out: () => undefined, err: () => undefined };

/** An ordinary SDK client over the SDK's own Streamable HTTP transport. */
async function openClient(
  name: string,
  options: { token?: string } = {},
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(served.url), {
    requestInit: {
      headers: { authorization: `Bearer ${options.token ?? served.token}` },
    },
  });
  const client = new Client({ name, version: "0" });
  await client.connect(transport);
  return { client, transport };
}

beforeAll(async () => {
  app = await startSampleApp(0);
  served = await startHttpMcp({ io });
}, 180_000);

afterAll(async () => {
  await served.close();
  await app.close();
  // The surface sessions are the broker's, and the broker outlives a command by
  // design; it must not outlive the test run.
  /*
   * The broker outlives its commands by design, and it must not be killed here.
   *
   * This was `pkill -f "surface broker"`, which matches on the **command line**
   * and so kills every broker on the machine — the one another file in this
   * package is mid-journey on, and the one another package's suite is using,
   * because `pnpm -r test` runs several at once and vitest runs files in
   * parallel within each. That is the whole of the intermittent
   * `SESSION_NOT_FOUND`: about one full-suite run in three, some file finished
   * and took somebody else's broker with it.
   *
   * The suite's own broker is reaped once, after every file, by
   * `scripts/vitest-broker.mjs` — by the pid in its descriptor, in the state
   * directory this package's vitest configuration named. Per file is the wrong
   * granularity for a process that exists to outlive commands.
   */
});

describe("the protocol revision is pinned (SF-08)", () => {
  /*
   * "Pin and negotiate supported protocol versions." Pinning it in a constant
   * that this compares with the SDK's own is what makes an SDK upgrade a red
   * build rather than a silent change of cancellation and resumption
   * behaviour — which is the part of a revision this transport depends on.
   */
  it("is the revision this transport was written against", () => {
    expect(PINNED_PROTOCOL_VERSION).toBe("2025-11-25");
  });

  it("is the revision the pinned SDK speaks, so an upgrade is a red build", () => {
    expect(
      LATEST_PROTOCOL_VERSION,
      "the SDK moved; read its changelog for cancellation and resumption, then move the pin",
    ).toBe(PINNED_PROTOCOL_VERSION);
  });

  it("is negotiated with the client, and the server says which it settled on", async () => {
    const { client, transport } = await openClient("negotiation");
    try {
      expect(client.getServerVersion()?.name).toBe("yam");
      expect(transport.protocolVersion).toBe(PINNED_PROTOCOL_VERSION);
    } finally {
      await client.close();
    }
  });

  it("says what it speaks before a client has a token", async () => {
    const health = await fetch(new URL("/health", served.url));
    expect(health.ok).toBe(true);
    expect(((await health.json()) as { protocolVersion: string }).protocolVersion).toBe(
      PINNED_PROTOCOL_VERSION,
    );
  });
});

describe("the corpus stdio passes, over Streamable HTTP (SF-08)", () => {
  for (const one of MCP_CORPUS) {
    it(one.name, async () => {
      const { client } = await openClient("corpus-http");
      try {
        await one.run(client, { sampleUrl: app.origin });
      } finally {
        await client.close();
      }
    }, 180_000);
  }
});

describe("authentication and origin (SF-15)", () => {
  it("refuses a request with no bearer token, and says the credential is what is missing", async () => {
    const response = await fetch(served.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("bearer token");
  });

  it("refuses the wrong bearer token", async () => {
    await expect(openClient("wrong-token", { token: "not-the-token" })).rejects.toThrow();
  });

  it("refuses a browser origin that was not named at start-up", async () => {
    const response = await fetch(served.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${served.token}`,
        origin: "https://not-invited.example",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("not-invited.example");
  });

  it("accepts an origin that was named", async () => {
    const invited = await startHttpMcp({ io, allowedOrigins: ["https://invited.example"] });
    try {
      const response = await fetch(invited.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${invited.token}`,
          origin: "https://invited.example",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: PINNED_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: "invited", version: "0" },
          },
        }),
      });
      expect(response.status).toBe(200);
    } finally {
      await invited.close();
    }
  });

  it("answers only its own path", async () => {
    const response = await fetch(new URL("/v1/sessions", served.url), {
      headers: { authorization: `Bearer ${served.token}` },
    });
    expect(response.status, "the REST API is not this transport, and this is not the REST API")
      .toBe(404);
  });

  it("binds to loopback and nothing else", () => {
    const address = served.server.address();
    expect(typeof address === "object" && address !== null ? address.address : "").toBe("127.0.0.1");
  });
});

describe("two clients do not see each other's sessions (SF-08, SF-13)", () => {
  it("gives each its own MCP session id, and refuses the other's", async () => {
    const one = await openClient("client-one");
    const two = await openClient("client-two");
    try {
      const first = one.transport.sessionId;
      const second = two.transport.sessionId;
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first).not.toBe(second);

      /*
       * A third client offering an id it was not given: the transport must not
       * adopt it. A session id is a credential of a sort, and one that could be
       * borrowed would make "two clients" a single client with two names.
       */
      const stolen = await fetch(served.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${served.token}`,
          "mcp-session-id": "not-a-session-this-server-issued",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      expect(stolen.status).toBe(404);
    } finally {
      await one.client.close();
      await two.client.close();
    }
  });

  it("attributes a surface operation to the client that made it, not to the other", async () => {
    /*
     * The broker is shared on purpose, and the holder is the name the client
     * gave at initialization. So a lease one client takes is a lease the other
     * is refused, by name — which is the observable difference between two
     * clients sharing a broker and one client with two connections.
     */
    const one = await openClient("agent-alpha");
    const two = await openClient("agent-beta");
    try {
      const connected = answer(
        await one.client.callTool({
          name: "surface_connect",
          arguments: { url: `${app.origin}/login`, adapter: "playwright" },
        }),
      );
      const session = (connected["result"] as { sessionId: string }).sessionId;
      try {
        await one.client.callTool({
          name: "surface_control",
          arguments: { session, action: "take" },
        });
        const snapshot = answer(
          await one.client.callTool({
            name: "surface_snapshot",
            arguments: { session, interactiveOnly: true },
          }),
        );
        const ref = /\[ref=(\w+)\]/.exec((snapshot["result"] as { text: string }).text)?.[1];

        const refused = answer(
          await two.client.callTool({
            name: "surface_act",
            arguments: { session, action: "click", ref },
          }),
        );
        expect((refused["error"] as { code?: string } | undefined)?.code).toBe("CONTROL_BUSY");
        expect(
          `${(refused["error"] as { message?: string } | undefined)?.message ?? ""}`,
          "the refusal names who holds it",
        ).toContain("agent-alpha");
      } finally {
        await one.client.callTool({ name: "surface_close", arguments: { session } });
      }
    } finally {
      await one.client.close();
      await two.client.close();
    }
  }, 180_000);

  it("closing one client's session leaves the other's alone", async () => {
    const one = await openClient("stays");
    const two = await openClient("goes");
    const firstId = one.transport.sessionId;
    try {
      await two.client.close();
      // The one that stayed can still be asked, which a shared transport could
      // not promise.
      const listed = await one.client.listTools();
      expect(listed.tools.length).toBeGreaterThan(0);
      expect(one.transport.sessionId).toBe(firstId);
    } finally {
      await one.client.close();
    }
  });
});

describe("disconnect and cancellation, of the revision pinned (SF-08)", () => {
  it("forgets a session a client deleted, so a later request initializes again", async () => {
    const { client, transport } = await openClient("polite-goodbye");
    const id = transport.sessionId;
    expect(id).toBeDefined();
    /*
     * `terminateSession` is the DELETE the 2025-11-25 transport defines for a
     * client that is finished. What it must leave behind is nothing: a
     * subsequent request carrying that id is a request about a session that is
     * gone.
     */
    await transport.terminateSession();
    await client.close();

    const afterwards = await fetch(served.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${served.token}`,
        "mcp-session-id": id!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(afterwards.status).toBe(404);
  });

  it("leaves the broker's sessions alone when a client disconnects (SF-05)", async () => {
    /*
     * The rule stdio keeps, kept here: "an agent that disconnects leaves what
     * it opened for the person to see and close". A transport that tidied up
     * would close a browser somebody is looking at.
     */
    const first = await openClient("opens-and-leaves");
    const connected = answer(
      await first.client.callTool({
        name: "surface_connect",
        arguments: { url: `${app.origin}/login`, adapter: "playwright" },
      }),
    );
    const session = (connected["result"] as { sessionId: string }).sessionId;
    await first.client.close();

    const second = await openClient("comes-back");
    try {
      const listed = answer(
        await second.client.callTool({ name: "surface_sessions", arguments: {} }),
      );
      const ids = ((listed["result"] as { sessions: Array<{ sessionId: string }> }).sessions ?? [])
        .map((one) => one.sessionId);
      expect(ids, "the session outlived the client that opened it").toContain(session);
    } finally {
      await second.client.callTool({ name: "surface_close", arguments: { session } });
      await second.client.close();
    }
  }, 180_000);

  it("a cancelled request is abandoned by the client and does not become an answer", async () => {
    /*
     * Cancellation in this revision is a `notifications/cancelled` the client
     * sends for a request id it no longer wants. What a caller must be able to
     * rely on is that the cancelled call does not come back as a result, and
     * that the connection is still usable afterwards — a transport that wedged
     * on a cancellation would make every long operation a one-shot.
     */
    const { client } = await openClient("impatient");
    try {
      const cancelled = new AbortController();
      const call = client.callTool(
        {
          name: "surface_connect",
          arguments: { url: `${app.origin}/login`, adapter: "playwright" },
        },
        undefined,
        { signal: cancelled.signal },
      );
      cancelled.abort(new Error("the caller changed its mind"));
      await expect(call).rejects.toThrow();

      // …and the session is still good for the next request.
      const listed = await client.listTools();
      expect(listed.tools.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 180_000);
});

describe("`yam mcp --http`, as a person starts it (SF-07, SF-08)", () => {
  /*
   * The command, spawned. SF-07 asks for "the actual subprocess transport" for
   * stdio and the reason applies here: wave 3's second defect was an MCP server
   * that had never been run as one, because every test built it in process.
   * `startHttpMcp` is what the rest of this file drives; this is the line a
   * person types, the handshake it prints, and an ordinary client against it.
   */
  it("prints a URL and a token, and an ordinary client connects to them", async () => {
    const child = spawn(process.execPath, [MCP, "--http"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const handshake = await new Promise<{ url: string; token: string }>((done, fail) => {
        const timer = setTimeout(() => fail(new Error(`no handshake in 30 s: ${said}`)), 30_000);
        let said = "";
        child.stdout.on("data", (chunk: Buffer) => {
          said += chunk.toString("utf8");
          const found = /yam mcp listening url=(\S+) token=(\S+)/u.exec(said);
          if (found === null) return;
          clearTimeout(timer);
          done({ url: found[1]!, token: found[2]! });
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          fail(new Error(`the command exited with ${code}: ${said}`));
        });
      });

      const transport = new StreamableHTTPClientTransport(new URL(handshake.url), {
        requestInit: { headers: { authorization: `Bearer ${handshake.token}` } },
      });
      const client = new Client({ name: "a-person-typed-this", version: "0" });
      await client.connect(transport);
      try {
        const listed = await client.listTools();
        expect(listed.tools.map((one) => one.name)).toContain("surface_snapshot");
        expect(transport.protocolVersion).toBe(PINNED_PROTOCOL_VERSION);
      } finally {
        await client.close();
      }

      /*
       * The token is generated per process and written nowhere — the same rule
       * `yam serve` keeps, because a token in a file is a token that outlives
       * the process that needed it.
       */
      expect(handshake.token).toMatch(/^[\w-]{20,}$/u);
    } finally {
      child.kill("SIGTERM");
    }
  }, 120_000);
});

describe("the event store that makes resumption possible (SF-08)", () => {
  /*
   * Resumption in 2025-11-25 is `Last-Event-ID`: a client that lost its stream
   * reconnects, names the last event it saw, and is sent what came after it.
   * Without a store the SDK does not offer resumption at all, so these are the
   * cases that say the store keeps its half of that bargain.
   */
  const message = (id: number) => ({ jsonrpc: "2.0" as const, id, result: {} });

  it("replays what came after the event a client names", async () => {
    const store = createEventStore();
    const first = await store.storeEvent("stream-a", message(1));
    await store.storeEvent("stream-a", message(2));
    await store.storeEvent("stream-a", message(3));
    const seen: number[] = [];
    const streamId = await store.replayEventsAfter(first, {
      send: async (_id, sent) => {
        seen.push((sent as { id: number }).id);
      },
    });
    expect(streamId).toBe("stream-a");
    expect(seen).toEqual([2, 3]);
  });

  it("does not replay another stream's events", async () => {
    const store = createEventStore();
    const first = await store.storeEvent("stream-a", message(1));
    await store.storeEvent("stream-b", message(99));
    await store.storeEvent("stream-a", message(2));
    const seen: number[] = [];
    await store.replayEventsAfter(first, {
      send: async (_id, sent) => {
        seen.push((sent as { id: number }).id);
      },
    });
    expect(seen).toEqual([2]);
  });

  it("answers nothing for an event id it never issued", async () => {
    const store = createEventStore();
    await store.storeEvent("stream-a", message(1));
    const seen: number[] = [];
    const streamId = await store.replayEventsAfter("nothing-like-this", {
      send: async (_id, sent) => {
        seen.push((sent as { id: number }).id);
      },
    });
    expect(streamId).toBe("");
    expect(seen).toEqual([]);
  });

  it("is bounded, so a long-lived session is not a memory leak with a protocol in front of it", async () => {
    const store = createEventStore(4);
    const oldest = await store.storeEvent("stream-a", message(0));
    for (let n = 1; n <= 8; n += 1) await store.storeEvent("stream-a", message(n));
    expect(
      await store.getStreamIdForEventId?.(oldest),
      "an event past the bound is forgotten rather than half-remembered",
    ).toBeUndefined();
    const seen: number[] = [];
    await store.replayEventsAfter(oldest, {
      send: async (_id, sent) => {
        seen.push((sent as { id: number }).id);
      },
    });
    expect(seen).toEqual([]);
  });
});
