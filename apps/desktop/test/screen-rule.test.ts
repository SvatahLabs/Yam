/**
 * T3.7's Validate — "a review confirms no app-only logic" — made mechanical,
 * and rewritten for the structure T10.1–T10.3 left behind.
 *
 * The screen rule is: "every screen renders a service response or a project file
 * and nothing the CLI cannot produce." A review can confirm that once. This
 * confirms it on every commit, which is the difference between a rule and a
 * remark.
 *
 * ## What changed, and why the check got stronger
 *
 * Phase 3's screens each called the generated client and attributed each value
 * to the route it came from, and this file read the sources for both. Phase 10's
 * screens do not call anything: a screen is a function of a `ScreenState` that
 * `@svatah/yam-screens` loaded, and the app is one of its two renderers (§13.7). So
 * the rule is now checkable in a harder form —
 *
 *   1. **no screen reaches the network at all**: no `fetch`, no `EventSource`,
 *      no `client.` call outside the shell, which is the one file that holds a
 *      client and hands it to the model;
 *   2. **every screen's props are a state type from `@svatah/yam-screens`**, so a
 *      value it draws is one the model produced;
 *   3. **every screen id has a body**, so a screen cannot exist in the model and
 *      be unreachable in the application;
 *   4. **every endpoint LLD §13.6's table names is reached** — by the model now,
 *      which is where the reading moved to.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREEN_IDS } from "@svatah/yam-screens";
import { ENDPOINTS } from "../src/renderer/client.generated.js";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = join(APP_DIR, "src", "renderer", "shell");
const MODEL = join(APP_DIR, "..", "..", "packages", "screens", "src");

const shell = readdirSync(SHELL)
  .filter((name) => name.endsWith(".tsx"))
  .map((name) => ({ name, source: readFileSync(join(SHELL, name), "utf8") }));

/** The screens, which is everything under `shell/` but the shell and its parts. */
const screens = shell.filter(
  (one) => !["Shell.tsx", "parts.tsx", "Welcome.tsx"].includes(one.name),
);

/** Everything the generated client offers, plus the two hand-written additions. */
const CALLABLE = new Set([
  ...ENDPOINTS.map((one) => one.id),
  // `subscribe` is `GET /events/sse` — a stream rather than a request, which a
  // generator over paths cannot express — and `screenshot` is the one route
  // whose answer is bytes rather than JSON.
  "subscribe",
  "screenshot",
]);

describe("the app renders the model and nothing else (T3.7, T10.1, T10.2)", () => {
  it("has a file for each screen the model has", () => {
    /*
     * Eight files for thirteen screens: `Secondary.tsx` carries the six of T10.2,
     * `Surfaces.tsx` is the surface-first landing (T14), and the rest are one
     * file each — because they are one *kind* of screen — a table, an editor, an
     * inspector — and a file per screen would be a chance for them to drift. What
     * the next case checks is that every *id* has a body.
     */
    expect(screens.map((one) => one.name).sort()).toEqual([
      "Bindings.tsx",
      "Flows.tsx",
      "Heal.tsx",
      "Record.tsx",
      "Run.tsx",
      "Runs.tsx",
      "Secondary.tsx",
      "Surfaces.tsx",
    ]);
  });

  it("the shell has a body and an inspector for every screen id", () => {
    const source = shell.find((one) => one.name === "Shell.tsx")!.source;
    const body = source.slice(source.indexOf("function screenBody"));
    const bodies = body.slice(0, body.indexOf("function inspectorBody"));
    const inspectors = body.slice(body.indexOf("function inspectorBody"));

    for (const id of SCREEN_IDS) {
      // `flows` is the `default` arm of both, because a shell with no screen
      // showing is a shell showing the one a project opens on.
      if (id === "flows") continue;
      expect(bodies, `no body for the ${id} screen`).toContain(`case "${id}":`);
      expect(inspectors, `no inspector for the ${id} screen`).toContain(`case "${id}":`);
    }
    expect(bodies).toContain("<FlowsScreen");
    expect(inspectors).toContain("<FlowsInspector");
  });

  for (const screen of screens) {
    it(`${screen.name} reaches nothing: it draws a state`, () => {
      // A bare `fetch` in a screen is the shape of an app growing a private API.
      expect(screen.source).not.toMatch(/\bfetch\s*\(/);
      expect(screen.source).not.toMatch(/new\s+EventSource\b/);
      expect(screen.source).not.toMatch(/XMLHttpRequest/);
      // And no client at all: the shell holds the one there is.
      expect(screen.source).not.toMatch(/\bclient\s*\n?\s*\.\s*\w+\s*\(/);
      expect(screen.source).not.toContain("ServiceClient");
    });

    it(`${screen.name} draws a state type from the model`, () => {
      /*
       * The imports, not the whole file: what is checked is where a screen's
       * `…State` types *come from*, and every one of them has to come from
       * `@svatah/yam-screens`. A screen with a state type of its own would be a
       * screen with a value the other renderer cannot show.
       */
      const imported = screen.source.slice(0, screen.source.indexOf("export function"));
      const states = [...imported.matchAll(/\b(\w+State)\b/g)].map((one) => one[1]!);
      expect(states.length, `${screen.name} imports no screen state`).toBeGreaterThan(0);
      expect(imported, `${screen.name} does not import from the model`).toContain(
        'from "@svatah/yam-screens"',
      );
      // And it declares none of its own.
      const body = screen.source.slice(screen.source.indexOf("export function"));
      expect(body, `${screen.name} declares a state type of its own`).not.toMatch(
        /\b(interface|type)\s+\w+State\b/,
      );
    });
  }

  it("the shell is the only file that holds a client", () => {
    const holders = shell.filter((one) => one.source.includes("ServiceClient"));
    expect(holders.map((one) => one.name)).toEqual(["Shell.tsx"]);
  });

  it("the legacy screens and their stylesheet are gone (T10.3)", () => {
    const renderer = readdirSync(join(APP_DIR, "src", "renderer"));
    expect(renderer, "apps/desktop/src/renderer/screens still exists").not.toContain("screens");
    expect(renderer, "apps/desktop/src/renderer/app.css still exists").not.toContain("app.css");
    // The import, not the comment above it that records why there is none.
    const main = readFileSync(join(APP_DIR, "src", "renderer", "main.tsx"), "utf8");
    expect(main).not.toMatch(/^import ".*app\.css";$/m);
  });
});

/**
 * The endpoints LLD §13.6's screen table names are reached (REQ-ADE-3).
 *
 * By the *model* now: `@svatah/yam-screens`'s `load()` and the action registry are
 * the only things in this system that call the service, and the app and
 * `yam ui` both go through them. Reading the model's sources rather than the
 * app's is the same check one layer down, and it covers both renderers at once.
 */
describe("the endpoints the screens exercise (REQ-ADE-3, LLD §13.6)", () => {
  const model = readdirSync(MODEL, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(MODEL, name), "utf8"))
    .join("\n");

  const called = new Set(
    [...model.matchAll(/\bservice\s*\n?\s*\.\s*(\w+)\s*\(/g)].map((match) => match[1]!),
  );

  const REQUIRED = [
    "getProject",
    "getFlowsByFile",
    "putFlowsByFile",
    "postCompile",
    "getPlan",
    "postRun",
    "getRunsByIdAudit",
    "getRuns",
    "getRunsById",
    "getRunsByIdResults",
    /* T10.4 — the Run screen's Stop (Draft 2.12 §13.5). */
    "postRunsByIdStop",
    "postApiRequest",
    "getApi",
    "getData",
    "putData",
    /* T5.7 — record review, the bindings browser and the heal review. */
    "postRecord",
    "postRecordByIdDecision",
    "postRecordByIdStop",
    "getBindings",
    "getBindingsById",
    "postBindingsVerify",
    "postHeal",
    /*
     * T5.8's tool panel. The surface explorer's routes went with the Explorer
     * in T15 — Surfaces reaches the broker's own catalogue routes instead. The
     * record review's `postSurfaceBySessionSnapshot` is still served for the
     * re-pick picker, but no screen reaches it yet, so it is not required here.
     */
    "postTrajectoryCompile",
    "getTools",
    /* T6.6 — the prototype database import (REQ-ADE-9). */
    "postMigrate",
  ];

  for (const endpoint of REQUIRED) {
    it(`${endpoint} is reached by a screen or an action`, () => {
      expect(called.has(endpoint)).toBe(true);
    });
  }

  it("and nothing is called that the service does not publish", () => {
    for (const method of called) {
      expect(CALLABLE.has(method), `the model calls service.${method}()`).toBe(true);
    }
  });
});

describe("the Record screen's gateway choice (P5-F2, REQ-ADE-4, LLD §13.6)", () => {
  const record = screens.find((one) => one.name === "Record.tsx")!.source;

  it("offers the gateway on the screen, with the service's own answer", () => {
    // The choice is the model's (`RecordState.gateways`, one entry per gateway
    // with `available` from `GET /project`); the screen draws it as a control
    // with a name and an id, which is what a desktop adapter binds to.
    expect(record).toContain('id="record-gateway"');
    expect(record).toContain('label="Gateway"');
    expect(record).toContain("state.gateways");
  });

  it("says when a session is running against the committed answers", () => {
    expect(record).toContain("record-fake-gateway");
    expect(record).toContain("evals/grounding/cases");
  });

  it("renders a failed session as an alert", () => {
    expect(record).toContain("record-failed");
    expect(record).toContain("<Alert");
  });

  it("gives advice about this window, never a command-line flag", () => {
    /*
     * The defect stated mechanically. Whatever `adviseOnFailure` returns is
     * what a person reads in an Electron window, and a flag they cannot type
     * is not advice. The screen's *comments* may name the old message — that
     * is the record of why this exists — so only the returned strings are
     * checked.
     */
    const body = record.slice(record.indexOf("export function adviseOnFailure"));
    const advice = body.slice(0, body.indexOf("\n}"));
    const literals = [...advice.matchAll(/"([^"]{12,})"/g)].map((match) => match[1]!);
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(literal, `advice reads: ${literal}`).not.toMatch(/--[a-z]/);
      expect(literal, `advice reads: ${literal}`).not.toMatch(/\byam [a-z]+/);
    }
  });
});
