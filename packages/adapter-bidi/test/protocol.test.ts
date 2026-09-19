/**
 * The parts of the BiDi adapter that need no browser (T4.1, LLD §7.3).
 *
 * The value codec, the ref scheme, the error table and the endpoint search. They
 * are unit-testable precisely because the adapter is thin: everything above them
 * is a command table, and everything below is a WebSocket.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DialogError,
  LocateError,
  NavigationError,
  ScriptError,
  SessionError,
  TimeoutError,
  UnsupportedError,
} from "@svatah/yam-surface";
import { BidiError } from "../src/client.js";
import {
  bidiAvailable,
  findGecko,
  isDriverHostedSession,
  openEndpoint,
  BIDI_BROWSER_ENV,
  BIDI_URL_ENV,
} from "../src/launch.js";
import { BidiSession, fromRemoteValue, RefSpace, toLocalValue } from "../src/session.js";
import { keyValue } from "../src/input.js";
import { cookiesFor as sharedCookiesFor } from "@svatah/yam-surface";
import { BIDI_CAPABILITIES, cookiesFor, type BidiCookie } from "../src/surface.js";

describe("the value codec (LLD §7.3)", () => {
  it("round-trips every JSON shape through BiDi's tagged form", () => {
    const cases: unknown[] = [
      "a string",
      42,
      true,
      null,
      [1, "two", false],
      { a: 1, b: { c: ["d"] } },
      {},
      [],
    ];
    for (const value of cases) {
      expect(fromRemoteValue(toLocalValue(value)), JSON.stringify(value)).toEqual(value);
    }
  });

  it("tags undefined rather than dropping it", () => {
    // BiDi has no "absent"; a missing argument has to be spelled, or the
    // argument list shifts and the function reads the wrong parameter.
    expect(toLocalValue(undefined)).toEqual({ type: "undefined" });
    expect(fromRemoteValue({ type: "undefined" })).toBeUndefined();
  });

  it("reads a remote map as an object, because that is what a caller meant", () => {
    expect(
      fromRemoteValue({
        type: "map",
        value: [
          [{ type: "string", value: "k" }, { type: "number", value: 1 }],
        ],
      }),
    ).toEqual({ k: 1 });
  });

  it("reads a remote set as an array", () => {
    expect(fromRemoteValue({ type: "set", value: [{ type: "number", value: 7 }] })).toEqual([7]);
  });
});

describe("the ref scheme (LLD §2.2)", () => {
  it("separates walker refs from minted handles", () => {
    // Two arrays, not one: a caller that resolved a binding and then took a
    // snapshot before acting would otherwise find its reference pointing at
    // whatever the walk put at that index — an action on the wrong element
    // rather than an error.
    expect(RefSpace.decode("r12")).toEqual({ from: "registry", index: 12 });
    expect(RefSpace.decode("h0")).toEqual({ from: "handle", index: 0 });
  });

  it("refuses a reference it never issued", () => {
    for (const ref of ["e3", "x1", "r", "r-1", "rabc", ""]) {
      expect(() => RefSpace.decode(ref), ref).toThrow(LocateError);
    }
  });
});

describe("BiDi errors become the surface's typed errors (LLD §2.3, §8.4)", () => {
  /*
   * The executor classifies a failure from the error's *type*, never from its
   * message (LLD §8.4), so this table is what lets a BiDi failure and a
   * Playwright failure of the same kind produce the same `FailureClass`.
   */
  const table: ReadonlyArray<[string, new (...args: never[]) => Error]> = [
    ["no such element", LocateError],
    ["no such node", LocateError],
    ["invalid selector", LocateError],
    ["element not interactable", LocateError],
    ["no such alert", DialogError],
    ["unexpected alert open", DialogError],
    ["no such frame or window", NavigationError],
    ["no such history entry", NavigationError],
    ["javascript error", ScriptError],
    // The browser cannot do this at all, which is neither a script's failure
    // nor something to retry (SF-11).
    ["unsupported operation", UnsupportedError],
    ["unknown command", UnsupportedError],
    ["session not created", SessionError],
    ["invalid session id", SessionError],
    ["timeout", TimeoutError],
    ["script timeout", TimeoutError],
  ];

  for (const [code, Kind] of table) {
    it(`maps "${code}" onto ${Kind.name}`, () => {
      const error = new BidiError(code, "something went wrong").asSurfaceError();
      expect(error).toBeInstanceOf(Kind);
      expect(error.message).toContain("something went wrong");
    });
  }

  it("falls back to ScriptError for a code with no row", () => {
    // "The protocol refused and we do not have a category for why" is an honest
    // answer; guessing at a class the executor would act on is not.
    expect(new BidiError("a code from a future draft", "…").asSurfaceError()).toBeInstanceOf(
      ScriptError,
    );
  });
});

/*
 * `cookiesFor` is the rule a browser applies when it sends a request, applied
 * to the jar `storage.getCookies` answers (REQ-ADP-3). It decides what an API
 * call "with the session cookies" carries, so a cookie offered to the wrong
 * host or path is a credential sent somewhere it was never meant to go.
 */
describe("the cookies a browser would send to a URL (REQ-ADP-3)", () => {
  const cookie = (name: string, domain: string, extra: Partial<BidiCookie> = {}): BidiCookie => ({
    name,
    value: { type: "string", value: `${name}-value` },
    domain,
    path: "/",
    ...extra,
  });

  it("sends a host-only cookie to its host alone, and a domain cookie to subdomains too", () => {
    const jar = [cookie("host", "app.example.com"), cookie("domain", ".example.com")];
    expect(cookiesFor("https://app.example.com/", jar)).toEqual({ host: "host-value", domain: "domain-value" });
    expect(cookiesFor("https://example.com/", jar)).toEqual({ domain: "domain-value" });
    expect(cookiesFor("https://api.app.example.com/", jar)).toEqual({ domain: "domain-value" });
    expect(cookiesFor("https://example.org/", jar)).toEqual({});
    // A suffix that is not at a dot is another domain.
    expect(cookiesFor("https://notexample.com/", jar)).toEqual({});
  });

  it("sends a cookie only under its path, at a slash", () => {
    const jar = [cookie("admin", "127.0.0.1", { path: "/admin" })];
    expect(cookiesFor("http://127.0.0.1/admin", jar)).toEqual({ admin: "admin-value" });
    expect(cookiesFor("http://127.0.0.1/admin/users?x=1", jar)).toEqual({ admin: "admin-value" });
    expect(cookiesFor("http://127.0.0.1/administrator", jar)).toEqual({});
    expect(cookiesFor("http://127.0.0.1/", jar)).toEqual({});
  });

  it("sends a Secure cookie only over https", () => {
    const jar = [cookie("secret", "example.com", { secure: true })];
    expect(cookiesFor("http://example.com/", jar)).toEqual({});
    expect(cookiesFor("https://example.com/", jar)).toEqual({ secret: "secret-value" });
  });

  it("lets the longer path win a name both paths set, and decodes a base64 value", () => {
    const jar = [
      cookie("session", "example.com", { path: "/api", value: { type: "string", value: "narrow" } }),
      cookie("session", "example.com", { path: "/", value: { type: "string", value: "wide" } }),
      cookie("blob", "example.com", { value: { type: "base64", value: Buffer.from("bytes").toString("base64") } }),
    ];
    expect(cookiesFor("https://example.com/api/x", jar)).toEqual({ session: "narrow", blob: "bytes" });
    expect(cookiesFor("https://example.com/other", jar)).toEqual({ session: "wide", blob: "bytes" });
  });

  /*
   * The rule moved to the surface package so the Playwright and HTTP adapters
   * send what this one does; this export is kept, and answers exactly what
   * the shared rule answers for the same cookies once their values are read.
   */
  it("answers what the rule every adapter shares answers", () => {
    const jar = [
      cookie("host", "app.example.com"),
      cookie("domain", ".example.com", { path: "/api" }),
      cookie("secret", ".example.com", { secure: true }),
      cookie("blob", "app.example.com", { value: { type: "base64", value: Buffer.from("bytes").toString("base64") } }),
    ];
    const plain = jar.map((one) => ({
      name: one.name,
      value: one.value.type === "base64" ? Buffer.from(one.value.value, "base64").toString("utf8") : one.value.value,
      domain: one.domain,
      ...(one.path === undefined ? {} : { path: one.path }),
      ...(one.secure === undefined ? {} : { secure: one.secure }),
    }));
    for (const url of [
      "https://app.example.com/api/items",
      "http://app.example.com/api",
      "https://api.example.com/apiary",
      "https://example.com/",
    ]) {
      expect(cookiesFor(url, jar), url).toEqual(sharedCookiesFor(url, plain));
    }
  });
});

describe("key names (LLD §7.3)", () => {
  it("maps the flow language's key names onto WebDriver's codepoints", () => {
    expect(keyValue("Enter")).toBe("\uE007");
    expect(keyValue("Tab")).toBe("\uE004");
    expect(keyValue("ArrowDown")).toBe("\uE015");
    expect(keyValue("Escape")).toBe("\uE00C");
  });

  it("passes a single character through", () => {
    expect(keyValue("a")).toBe("a");
    expect(keyValue("é")).toBe("é");
  });

  it("refuses a name it does not know, and says what it does know", () => {
    // Silently typing the literal string "Entre" is worse than refusing it.
    expect(() => keyValue("Entre")).toThrow(/not a key this adapter knows/);
    expect(() => keyValue("Entre")).toThrow(/Enter/);
  });
});

describe("capabilities declare what BiDi cannot do (LLD §2.4, §7.3)", () => {
  it("claims dialogs, frames, windows, upload, drag, screenshot and restore", () => {
    expect(BIDI_CAPABILITIES).toMatchObject({
      dialogs: true,
      frames: true,
      windows: true,
      upload: true,
      drag: true,
      screenshot: true,
      restore: true,
    });
  });

  it("declares tracing false rather than writing something else with that name", () => {
    // "capability flags declare what BiDi cannot do rather than emulating it."
    // Playwright's trace viewer is a Playwright artefact, not a protocol feature.
    expect(BIDI_CAPABILITIES.trace).toBe(false);
  });

  it("declares webmcp false, which is REQ-ADP-9 and P2 for every adapter", () => {
    expect(BIDI_CAPABILITIES.webmcp).toBe(false);
  });
});

describe("finding an endpoint (LLD §7.3)", () => {
  it("prefers an endpoint someone else is hosting", async () => {
    // The route for stock Chrome and Edge, whose remote agent speaks CDP: their
    // driver hosts the BiDi mapper and Yam connects to it.
    const endpoint = await openEndpoint({
      env: { [BIDI_URL_ENV]: "ws://127.0.0.1:4444/session" },
    });
    expect(endpoint.url).toBe("ws://127.0.0.1:4444/session");
    expect(endpoint.describedAs).toContain("ws://127.0.0.1:4444/session");
    // A bare `/session` is a *server*: no session exists there yet.
    expect(endpoint.hosted).toBe(false);
    // Nothing was launched, so nothing is closed.
    await expect(endpoint.close()).resolves.toBeUndefined();
  });

  it("knows a driver-hosted session from a BiDi server (P4-F3, LLD §7.3)", async () => {
    const endpoint = await openEndpoint({
      env: { [BIDI_URL_ENV]: "ws://127.0.0.1:9515/session/a1b2c3" },
    });
    expect(endpoint.hosted).toBe(true);
    expect(endpoint.describedAs).toContain("driver-hosted");
  });

  it("decides on the path, since that is all the two shapes differ by", () => {
    // A session, created through a driver with `webSocketUrl: true`.
    expect(isDriverHostedSession("ws://127.0.0.1:9515/session/a1b2c3")).toBe(true);
    expect(isDriverHostedSession("ws://127.0.0.1:9515/session/a1b2c3/")).toBe(true);
    expect(isDriverHostedSession("wss://grid.example.com/wd/hub/session/xyz")).toBe(true);
    // A server, waiting to be asked for one.
    expect(isDriverHostedSession("ws://127.0.0.1:4444/session")).toBe(false);
    expect(isDriverHostedSession("ws://127.0.0.1:4444/session/")).toBe(false);
    expect(isDriverHostedSession("ws://127.0.0.1:9222/")).toBe(false);
    // Not a URL at all: not a session, and not a crash either.
    expect(isDriverHostedSession("not a url")).toBe(false);
  });
});

/**
 * Both attach shapes, against exchanges recorded from real drivers (P4-F3).
 *
 * "Both attach shapes are tested against recorded exchanges" (Draft 2.6,
 * LLD §7.3). The two JSON files under `test/exchanges/` are what chromedriver
 * 152 and Firefox 153's remote agent actually answered, captured by
 * `BidiClient`'s traffic hook — including chromedriver's refusal of
 * `session.new`, which is the defect this pins down:
 *
 *     session.new → session not created: session already exists
 *
 * The adapter used to send that as its first message on the route its own README
 * documents, so attaching to stock Chrome failed on contact (Phase 4
 * verification, F3). The test is not "does the adapter cope with the error" — it
 * is that the message is never sent.
 */
describe("attaching to the two endpoint shapes (P4-F3, LLD §7.3)", () => {
  const HERE = dirname(fileURLToPath(import.meta.url));

  type Recorded = Record<string, { result?: unknown; error?: string }>;

  function exchange(name: string): Recorded {
    return JSON.parse(readFileSync(join(HERE, "exchanges", `${name}.json`), "utf8")) as Recorded;
  }

  /**
   * A `BidiClient` that answers from a recording and remembers what it was asked.
   *
   * `BidiSession.open` takes the client, so replaying at this level tests the
   * whole opening sequence — which message goes first, what the browser is
   * learned from, what the session ends up knowing — without a browser.
   */
  function replay(recorded: Recorded): {
    client: Parameters<typeof BidiSession.open>[0];
    sent: string[];
  } {
    const sent: string[] = [];
    const client = {
      async call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        const key =
          method === "session.subscribe"
            ? `session.subscribe:${(params["events"] as string[] | undefined)?.[0] ?? ""}`
            : method;
        sent.push(key);
        const answer = recorded[key];
        if (answer === undefined) throw new Error(`nothing recorded for ${key}`);
        if (answer.error !== undefined) throw new Error(answer.error);
        return answer.result;
      },
      on(): void {},
    };
    return { client: client as unknown as Parameters<typeof BidiSession.open>[0], sent };
  }

  const options = { testIdAttributes: ["data-testid"], ignoreAttributes: [], timeoutMs: 5_000 };

  it("attaches to chromedriver's session without creating a second one", async () => {
    const { client, sent } = replay(exchange("chromedriver-attach"));
    const session = await BidiSession.open(client, { ...options, hosted: true });

    // The whole of the defect, in one assertion.
    expect(sent).not.toContain("session.new");
    // And the recording *does* hold chromedriver's refusal, so this would fail
    // rather than pass vacuously if the message came back.
    expect(exchange("chromedriver-attach")["session.new"]?.error).toContain(
      "session already exists",
    );

    // `session.status` is what it asks instead, and what it learns from.
    expect(sent[0]).toBe("session.status");
    expect(session.describedBrowser).toContain("152.0.7977.82");

    // And it is a working session: the context tree was read.
    expect(session.windows).toEqual(["1A3B20C181A78EF8DC8CDBD12DAB5F13"]);
  });

  it("still creates a session on a bare BiDi server", async () => {
    const { client, sent } = replay(exchange("firefox-server"));
    const session = await BidiSession.open(client, { ...options, hosted: false });

    expect(sent).toContain("session.new");
    expect(sent).not.toContain("session.status");
    // Firefox names itself in `session.new`'s capabilities, so the report gets
    // the browser and the version rather than a build string.
    expect(session.describedBrowser).toBe("firefox 153.0");
    expect(session.windows).toEqual(["ea02a15e-b4d5-42fd-a38d-167ad444c9e5"]);
  });

  it("spends a launched browser's startup budget on opening the session, and nothing after", async () => {
    /*
     * Firefox says it is listening before its first window is ready, and the
     * first subscription waits for that window. On the Windows runner that
     * wait once outlasted the thirty-second command timeout. The opening
     * commands of a browser the adapter launched get the startup budget; an
     * attached browser has finished starting, so it keeps the command timeout.
     */
    const recorded = exchange("firefox-server");
    const asked: Array<{ method: string; timeoutMs: number | undefined }> = [];
    const client = {
      async call(method: string, params: Record<string, unknown> = {}, options: { timeoutMs?: number } = {}) {
        asked.push({ method, timeoutMs: options.timeoutMs });
        const key =
          method === "session.subscribe" ? `session.subscribe:${(params["events"] as string[])[0]}` : method;
        const answer = recorded[key];
        if (answer?.error !== undefined) throw new Error(answer.error);
        return answer?.result ?? {};
      },
      on(): void {},
    } as unknown as Parameters<typeof BidiSession.open>[0];

    await BidiSession.open(client, { ...options, hosted: false, setupTimeoutMs: 60_000 });
    expect(asked.map((one) => one.method)).toContain("session.subscribe");
    expect(asked.filter((one) => one.timeoutMs !== 60_000)).toEqual([]);

    asked.length = 0;
    await BidiSession.open(client, { ...options, hosted: false });
    expect(asked.every((one) => one.timeoutMs === undefined)).toBe(true);
  });

  it("loses only the event a browser does not have", async () => {
    // Gecko refuses `browsingContext.navigationAborted`, and the recording holds
    // that refusal. One subscription per call is what keeps the refusal from
    // taking the dialog subscription down with it.
    expect(
      exchange("firefox-server")["session.subscribe:browsingContext.navigationAborted"]?.error,
    ).toContain("not a valid event name");

    const { client, sent } = replay(exchange("firefox-server"));
    await BidiSession.open(client, { ...options, hosted: false });
    expect(sent).toContain("session.subscribe:browsingContext.userPromptOpened");
    expect(sent).toContain("session.subscribe:browsingContext.navigationAborted");
  });

  /*
   * "No browser" means none installed on this machine either (`systemPaths: []`).
   * An empty `HOME` hides Playwright's caches and nothing else, and a CI runner
   * has Firefox where a person would install it.
   */
  it("says what to do when there is neither an endpoint nor a browser", async () => {
    await expect(
      openEndpoint({ env: { HOME: join(tmpdir(), "definitely-not-a-home") }, systemPaths: [] }),
    ).rejects.toThrow(/YAM_BIDI_URL|pnpm browsers/);
  });

  it("takes the binary YAM_BIDI_BROWSER names, when it exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-gecko-"));
    const binary = join(dir, "firefox");
    writeFileSync(binary, "#!/bin/sh\n", "utf8");
    expect(findGecko({ [BIDI_BROWSER_ENV]: binary })).toBe(binary);
  });

  it("ignores a YAM_BIDI_BROWSER that names nothing", () => {
    // A stale path in an environment file should fall through to the search,
    // not make the adapter refuse to start.
    const found = findGecko(
      {
        [BIDI_BROWSER_ENV]: join(tmpdir(), "no-such-firefox"),
        HOME: join(tmpdir(), "definitely-not-a-home"),
      },
      [],
    );
    expect(found).toBeUndefined();
  });

  it("searches the system install locations it is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-gecko-"));
    const binary = join(dir, "firefox");
    writeFileSync(binary, "#!/bin/sh\n", "utf8");
    const home = join(tmpdir(), "definitely-not-a-home");
    expect(findGecko({ HOME: home }, [join(dir, "not-installed"), binary])).toBe(binary);
    expect(bidiAvailable({ HOME: home }, [binary])).toBe(true);
  });

  it("reports availability from the two things that could provide it", () => {
    expect(bidiAvailable({ [BIDI_URL_ENV]: "ws://host/session" })).toBe(true);
    expect(bidiAvailable({ HOME: join(tmpdir(), "definitely-not-a-home") }, [])).toBe(false);
  });
});
