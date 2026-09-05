/**
 * T3.7 Validate — "a review confirms no ADE-only logic", made mechanical.
 *
 * The screen rule is: "every screen renders a service response or a project file
 * and nothing the CLI cannot produce." A review can confirm that once. This
 * confirms it on every commit, which is the difference between a rule and a
 * remark.
 *
 * ## What it reads
 *
 * The renderer's sources. Every call a screen makes must be a method on the
 * generated client — which is generated from the service's own OpenAPI document,
 * so a method exists only if a route does — and every value a screen displays
 * carries the endpoint it came from (`fromEndpoint`). A screen that computed
 * something the service does not publish would have to either call something
 * that is not there, which does not compile, or display a value with no origin,
 * which this catches.
 *
 * The verification contract calls "a static check over the generated client
 * usage" acceptable. This is that check.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENDPOINTS } from "../src/renderer/client.generated.js";

const ADE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCREENS = join(ADE, "src", "renderer", "screens");

const screens = readdirSync(SCREENS)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, source: readFileSync(join(SCREENS, name), "utf8") }));

/** Everything the generated client offers, plus the two hand-written additions. */
const CALLABLE = new Set([
  ...ENDPOINTS.map((one) => one.id),
  // `subscribe` is `GET /events/sse` — a stream rather than a request, which a
  // generator over paths cannot express — and `screenshot` is the one route
  // whose answer is bytes rather than JSON.
  "subscribe",
  "screenshot",
]);

describe("every screen calls only what the service publishes (T3.7)", () => {
  it("has a screen for each of the seven REQ-ADE-3 names", () => {
    expect(screens.map((one) => one.name).sort()).toEqual([
      "ApiClient.tsx",
      "Data.tsx",
      "FlowEditor.tsx",
      "Plan.tsx",
      "Project.tsx",
      "Results.tsx",
      "Run.tsx",
    ]);
  });

  for (const screen of screens) {
    it(`${screen.name} calls no method the generated client does not have`, () => {
      const called = [...screen.source.matchAll(/\bclient\s*\n?\s*\.\s*(\w+)\s*\(/g)].map(
        (match) => match[1]!,
      );
      expect(called.length, "a screen that calls nothing renders nothing").toBeGreaterThan(0);
      for (const method of called) {
        expect(CALLABLE.has(method), `${screen.name} calls client.${method}()`).toBe(true);
      }
    });

    it(`${screen.name} says where every value it renders came from`, () => {
      // `fromEndpoint("getProject", …)` names the route. The check is that the
      // name is a real one — a screen cannot label its own invention with a
      // plausible-looking string and pass.
      const sources = [...screen.source.matchAll(/fromEndpoint\(\s*"([^"]+)"/g)].map(
        (match) => match[1]!,
      );
      expect(sources.length, `${screen.name} renders nothing it attributes`).toBeGreaterThan(0);
      for (const from of sources) {
        expect(CALLABLE.has(from), `${screen.name} attributes a value to "${from}"`).toBe(true);
      }
    });

    it(`${screen.name} does not fetch anything the client did not give it`, () => {
      // A bare `fetch` in a screen is the shape of an ADE growing a private API.
      expect(screen.source).not.toMatch(/\bfetch\s*\(/);
      expect(screen.source).not.toMatch(/new\s+EventSource\b/);
      expect(screen.source).not.toMatch(/XMLHttpRequest/);
    });
  }
});

describe("the endpoints the screens exercise (REQ-ADE-3)", () => {
  const called = new Set(
    screens.flatMap((screen) =>
      [...screen.source.matchAll(/\bclient\s*\n?\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1]!),
    ),
  );

  /** LLD §13.6's screen-to-endpoint table, for the seven screens T3.7 builds. */
  const REQUIRED = [
    "getProject",
    "getFlowsByFile",
    "putFlowsByFile",
    "postCompile",
    "getPlan",
    "postRun",
    "subscribe",
    "getRunsByIdAudit",
    "getRuns",
    "getRunsByIdResults",
    "postApiRequest",
    "getApi",
    "putApiByName",
    "getData",
    "putData",
  ];

  for (const endpoint of REQUIRED) {
    it(`${endpoint} is reached by a screen`, () => {
      expect(called.has(endpoint)).toBe(true);
    });
  }
});
