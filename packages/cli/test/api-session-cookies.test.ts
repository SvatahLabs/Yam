/**
 * `Call the "x" API with the session cookies`, from the sentence to the header
 * (REQ-ADP-3).
 *
 * The phrase compiled to `withSessionCookies: true` and the run sent no browser
 * cookie: the API runner `yam run` builds was never shown the surface, and the
 * HTTP adapter has no idea a browser exists. This follows one sentence through
 * the grammar, the executor's `runStep`, and `projectRunners`' API runner, with
 * a fake browser surface and a fake `fetch`, and asserts on the request that
 * would have gone out — both that the browser's cookie is on it, and that the
 * sentence without the phrase leaves it off.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, Step } from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import { lowerStep, parseSentence } from "@svatah/yam-compiler";
import { runStep, Scope } from "@svatah/yam-runtime";
import { projectRunners } from "../src/commands/run.js";

const BASE = "http://127.0.0.1:4100";

/** One sentence, compiled the way a flow's line is. */
function compiled(text: string): Step {
  const parsed = parseSentence(text, { file: "bookings.flow", line: 1 });
  if (parsed.raw === undefined) throw new Error(`"${text}" did not parse.`);
  return lowerStep(
    parsed.raw,
    { id: "s1", storyName: "Bookings", line: 1, text, rule: "api" },
    {
      targets: new Map() as never,
      secrets: new Set(),
      file: "bookings.flow",
      line: 1,
      stepTimeoutMs: 5_000,
    },
  ).step;
}

/** A browser, as far as an API step can see one: its cookies, per URL. */
function browser(): AgentSurface & { cookies: ReturnType<typeof vi.fn> } {
  const refuse = async (): Promise<never> => {
    throw new Error("An API step touched the browser for something other than its cookies.");
  };
  return {
    kind: "web",
    cookies: vi.fn(async (url: string) =>
      url.startsWith(`${BASE}/`) ? { browser_session: "signed-in-as-atul" } : {},
    ),
    capabilities: () => ({}) as never,
    open: refuse,
    close: refuse,
    snapshot: refuse,
    locate: refuse,
    describe: refuse,
    act: refuse,
    read: refuse,
    check: refuse,
    screenshot: refuse,
    state: refuse,
    restore: refuse,
  } as unknown as AgentSurface & { cookies: ReturnType<typeof vi.fn> };
}

async function send(sentence: string): Promise<{ cookie: string | undefined; asked: unknown[] }> {
  const request = { name: "bookings", method: "GET", url: "/api/bookings" } as ApiRequest;
  const loaded = {
    config: { api: { dir: "apis" }, steps: { dir: "steps" } },
    project: { apis: { requests: new Map([["bookings", request]]) } },
    steps: { all: () => [] },
  };
  const sent: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
    sent.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ bookings: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const { api } = projectRunners(loaded as never, {
    baseUrl: BASE,
    cwd: mkdtempSync(join(tmpdir(), "yam-api-cookies-")),
    fetch: fetch as never,
  });
  const surface = browser();

  const outcome = await runStep(compiled(sentence), {
    surface,
    scope: new Scope(),
    resolve: async () => {
      throw new Error("An API step has no target to resolve.");
    },
    api,
    stepTimeoutMs: 5_000,
    screenshots: "never",
  });

  expect(outcome.status, JSON.stringify(outcome.failure)).toBe("passed");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.url).toBe(`${BASE}/api/bookings`);
  return { cookie: sent[0]!.headers["cookie"], asked: surface.cookies.mock.calls.map((call) => call[0]) };
}

describe('"with the session cookies" sends the browser\'s cookies (REQ-ADP-3)', () => {
  it("compiles the phrase to the flag the runner reads", () => {
    expect(compiled('Call the "bookings" API with the session cookies').args?.["withSessionCookies"]).toBe(
      true,
    );
  });

  it("puts the browser's cookie for the request's URL on the request", async () => {
    const { cookie, asked } = await send('Call the "bookings" API with the session cookies');
    expect(cookie).toBe("browser_session=signed-in-as-atul");
    // Asked with the request's own absolute URL, so the browser answers for
    // that host and no other.
    expect(asked).toEqual([`${BASE}/api/bookings`]);
  });

  it.each(['Call the "bookings" API', 'Call the "bookings" API without cookies'])(
    "leaves the browser out of a call that did not ask for it: %s",
    async (sentence) => {
      const { cookie, asked } = await send(sentence);
      expect(cookie).toBeUndefined();
      expect(asked).toEqual([]);
    },
  );
});
