/**
 * One typed line, three kinds of target (SF-04).
 *
 * The CLI has `--url`, `--app` and `--attach`; a person typing one line has one
 * line. These are the shapes the reader must get right, and the ones it must not
 * guess at: an application name is the fallback, so anything that *is* an
 * address has to be recognised as one before it gets there.
 */
import { describe, expect, it } from "vitest";
import { actionById, fakeService, type FakeResponses } from "../src/index.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

/** Run `surface.connect` with `target` and answer with the body it posted. */
async function posted(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const service = fakeService(FIXTURES);
  const action = actionById("surface.connect");
  await action?.run(service, args);
  const call = service.calls.find((one) => one.method === "postSessions");
  return (call?.args[0] ?? {}) as Record<string, unknown>;
}

describe("the shape of what was typed names the target", () => {
  it("launches a browser for a URL", async () => {
    expect(await posted({ target: "https://example.com/checkout" })).toMatchObject({
      url: "https://example.com/checkout",
    });
  });

  it("joins a running browser for a DevTools endpoint", async () => {
    expect(await posted({ target: "127.0.0.1:9222" })).toMatchObject({ attach: "127.0.0.1:9222" });
    expect(await posted({ target: "ws://127.0.0.1:9222/devtools/browser/x" })).toMatchObject({
      attach: "ws://127.0.0.1:9222/devtools/browser/x",
    });
  });

  it("drives a running application for a name", async () => {
    expect(await posted({ target: "Calculator" })).toMatchObject({ app: "Calculator" });
    expect(await posted({ target: "Google Chrome" })).toMatchObject({ app: "Google Chrome" });
  });

  it("reads a bare host as a URL rather than as an application", async () => {
    expect(await posted({ target: "example.com" })).toMatchObject({ url: "https://example.com" });
    expect(await posted({ target: "localhost" })).toMatchObject({ url: "https://localhost" });
  });

  /* A flag the CLI passed is never re-read from the shape of something else. */
  it("prefers an explicit flag to the typed line", async () => {
    expect(await posted({ app: "Notepad", target: "https://example.com" })).toMatchObject({
      app: "Notepad",
    });
  });

  it("posts nothing at all when there is no target", async () => {
    expect(await posted({})).toEqual({});
  });
});

describe("the action says what it needs", () => {
  it("declares one input, so a renderer can ask for it", () => {
    const needs = actionById("surface.connect")?.needs ?? [];
    expect(needs).toHaveLength(1);
    expect(needs[0]?.name).toBe("target");
    /*
     * The label may not promise more than the field takes. It said "a browser,
     * app, device or API" while accepting a URL only.
     */
    expect(needs[0]?.label).toBe("URL, application name, or endpoint");
  });
});
