/**
 * T03 — Turn audit failures into regression cases (SF-03, SF-17, SF-21).
 *
 * Each test reproduces a verified defect from the gap analysis
 * (docs/spec/surface-first/gap-analysis.md) on the baseline commit a7557ae.
 * They assert the contract the fix must satisfy. Tests that verify the
 * catalogue and dispatcher run against the new surface-control package;
 * tests that verify source-level issues (docs, UI registry) read the
 * source files directly.
 *
 * Evidence labels: each test names its gap ID, requirement, and whether the
 * evidence was Observed (executed) or Source (inspected).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Defect 1 (G02, Observed): `yam surface snapshot` and `yam surface act`
 * exit 64 with "Unknown surface subcommand" / "Phase 1 implements surface
 * conform". The action registry advertises these as CLI equivalents.
 *
 * Regression: the operation catalogue must define these as valid CLI
 * subcommands, and the surface command handler must accept them.
 */
describe("G02: surface subcommands exist (SF-03, SF-06)", () => {
  it("catalogue defines snapshot, act, read, check, connect, close as CLI subcommands", async () => {
    const { SURFACE_CLI_SUBCOMMANDS } = await import("../src/catalogue.js");
    for (const sub of ["snapshot", "act", "read", "check", "connect", "close"]) {
      expect(
        SURFACE_CLI_SUBCOMMANDS,
        `"${sub}" must be a registered CLI subcommand`,
      ).toContain(sub);
    }
  });

  it("surface command handler source does not reject known subcommands", () => {
    const source = readFileSync(
      join(ROOT, "packages", "bindings-cli", "src", "commands", "surface.ts"),
      "utf8",
    );
    // The baseline rejects everything except "conform".
    // After the fix, at minimum snapshot/act/connect/close must be accepted.
    // This test checks that the handler doesn't have a hard-coded single-command gate.
    const rejectsAll = /if\s*\(\s*sub\s*!==\s*["']conform["']\s*\)/.test(source);
    expect(
      rejectsAll,
      'surface command should not reject all subcommands except "conform"',
    ).toBe(false);
  });
});

/**
 * Defect 2 (G03, Observed + Source): the desktop Explorer collects adapter
 * and intent but never an action, so explorer.act always refuses with
 * "Choose an action."
 *
 * Regression: the Explorer renderer source must provide an action selector
 * to the explorer.act action handler.
 */
describe("G03: explorer provides action to explorer.act (SF-11, SF-17)", () => {
  it("Explorer renderer source includes a surface action selector", () => {
    const source = readFileSync(
      join(ROOT, "apps", "desktop", "src", "renderer", "shell", "Secondary.tsx"),
      "utf8",
    );
    // The renderer must collect a specific surface action (click, type, hover,
    // etc.) and pass it as args.action to explorer.act. On baseline, it never
    // does — onAction("explorer.act") is called but the args object has no
    // "action" key, so the registry handler always refuses with "Choose an action."
    // After fix, the renderer should have a control that sets a surface action value.
    const hasSurfaceActionControl =
      /SurfaceAction|SURFACE_ACTIONS|action.*selector|actionSelect/i.test(source) ||
      /["']click["'].*["']type["']|["']hover["']/i.test(source);
    expect(
      hasSurfaceActionControl,
      "Explorer renderer must have a surface action selector for explorer.act",
    ).toBe(true);
  });
});

/**
 * Defect 3 (G04, Observed + Source): POST /surface/:session/open with
 * adapter: "does-not-exist" returns 200 and silently opens configured
 * Playwright. Adapter selection is cosmetic.
 *
 * Regression: a nonexistent adapter must be refused before anything launches.
 */
describe("G04: adapter selection is real (SF-03, SF-04, SF-09)", () => {
  it("catalogue connect operation accepts adapter as a parameter", async () => {
    const { operationByName } = await import("../src/catalogue.js");
    const connect = operationByName("connect")!;
    expect(connect).toBeDefined();
    const parsed = connect.inputSchema.safeParse({ adapter: "does-not-exist" });
    expect(parsed.success).toBe(true);
  });

  it("dispatcher refuses an unknown adapter via adapterFactory", async () => {
    const { dispatchConnect } = await import("../src/dispatcher.js");
    const { createSessionStore } = await import("../src/sessions.js");

    const ctx = { sessions: createSessionStore() };
    const result = await dispatchConnect(ctx, {
      adapter: "does-not-exist",
      adapterFactory: async (name) => {
        throw new Error(`Adapter "${name}" is not registered`);
      },
    });
    expect((result as Record<string, unknown>).status).toBe("failed");
  });

  it("service open endpoint source accepts adapter in the request body", () => {
    const source = readFileSync(
      join(ROOT, "packages", "service", "src", "server.ts"),
      "utf8",
    );
    // The service's /surface/:session/open route should forward the adapter
    // from the request body, not just headed.
    // On baseline: Body type is { headed?: boolean } — no adapter field.
    const openRoute = source.match(
      /["']\/surface\/:session\/open["'][\s\S]*?(?=fastify\.|\/\*\*|\n  \}\);)/,
    );
    expect(openRoute).toBeTruthy();
    // After fix, the route body type should include adapter
    const routeSource = openRoute![0];
    const hasAdapter =
      /adapter/.test(routeSource) && !/drops?\s+.*adapter/i.test(routeSource);
    expect(
      hasAdapter,
      "service /surface/:session/open must accept adapter in request body",
    ).toBe(true);
  });
});

/**
 * Defect 4 (G05, Observed + Source): snapshot without intent reaches
 * trajectory z.string().min(1) validation and returns 500. Read without
 * intent returns 400 "missing-intent". After the fix, neither requires
 * intent at all for direct control.
 *
 * Regression: surface operations must not require intent for direct control.
 */
describe("G05: intent is optional for direct control (SF-03, SF-12)", () => {
  it("catalogue input schemas do not require intent", async () => {
    const { operationByName } = await import("../src/catalogue.js");

    for (const name of ["snapshot", "act", "read", "check", "describe", "screenshot"]) {
      const op = operationByName(name)!;
      expect(op, `operation ${name} must exist`).toBeDefined();

      const minInput: Record<string, unknown> = { session: "s_test123" };
      if (name === "act") minInput.action = "click";
      if (name === "read") minInput.kind = "title";
      if (name === "check") {
        minInput.predicate = { kind: "visible" };
        minInput.subject = "page";
      }
      if (name === "describe") minInput.ref = "r1";

      const result = op.inputSchema.safeParse(minInput);
      expect(result.success, `${name} should accept input without intent`).toBe(true);
    }
  });

  it("service surface dispatch source does not require intent", () => {
    const source = readFileSync(
      join(ROOT, "packages", "service", "src", "server.ts"),
      "utf8",
    );
    // On baseline, the service has a "missing-intent" check that rejects calls
    // without intent. After the fix, this check should not exist for
    // direct surface control operations.
    const hasMandatoryIntent = /["']missing-intent["']/.test(source);
    expect(
      hasMandatoryIntent,
      'service should not return "missing-intent" for direct surface control',
    ).toBe(false);
  });
});

/**
 * Defect 5 (G07, Source): HTTP surface dispatch drops ref2 for drag, name
 * for attribute reads, and snapshot options other than interactiveOnly.
 * MCP passes all three.
 *
 * Regression: the catalogue's input schemas must accept ref2, name, and
 * all snapshot options, and the dispatcher must forward them.
 */
describe("G07: ref2, name, and snapshot options are not dropped (SF-03, SF-06, SF-11)", () => {
  it("act input schema accepts ref2", async () => {
    const { operationByName } = await import("../src/catalogue.js");
    const act = operationByName("act")!;
    const result = act.inputSchema.safeParse({
      session: "s_test123",
      action: "dragTo",
      ref: "r1",
      ref2: "r2",
    });
    expect(result.success, "act must accept ref2 for drag operations").toBe(true);
  });

  it("read input schema accepts name", async () => {
    const { operationByName } = await import("../src/catalogue.js");
    const read = operationByName("read")!;
    const result = read.inputSchema.safeParse({
      session: "s_test123",
      kind: "attribute",
      ref: "r1",
      name: "aria-label",
    });
    expect(result.success, "read must accept name for attribute reads").toBe(true);
  });

  it("snapshot input schema accepts root, maxNodes, interactiveOnly", async () => {
    const { operationByName } = await import("../src/catalogue.js");
    const snapshot = operationByName("snapshot")!;
    const result = snapshot.inputSchema.safeParse({
      session: "s_test123",
      root: "r1",
      maxNodes: 100,
      interactiveOnly: true,
    });
    expect(result.success, "snapshot must accept root, maxNodes, interactiveOnly").toBe(true);
  });

  it("dispatcher forwards ref2 to surface.act", async () => {
    const { dispatchAct } = await import("../src/dispatcher.js");
    const { createSessionStore } = await import("../src/sessions.js");
    const store = createSessionStore();

    let receivedRef2: string | undefined;
    const mockSurface = {
      kind: "web",
      capabilities: () => ({}),
      open: async () => {},
      close: async () => {},
      snapshot: async () => ({}),
      act: async (_action: string, _ref: unknown, _args: unknown, ref2: unknown) => {
        receivedRef2 = ref2 as string;
        return { ok: true };
      },
      read: async () => "",
      check: async () => ({ ok: true }),
      describe: async () => ({}),
      screenshot: async () => {},
    } as never;

    const sessionId = store.create(mockSurface, "test");
    await dispatchAct({ sessions: store }, {
      session: sessionId,
      action: "dragTo",
      ref: "r1",
      ref2: "r2",
    });
    expect(receivedRef2).toBe("r2");
  });

  it("dispatcher forwards name to surface.read", async () => {
    const { dispatchRead } = await import("../src/dispatcher.js");
    const { createSessionStore } = await import("../src/sessions.js");
    const store = createSessionStore();

    let receivedName: string | undefined;
    const mockSurface = {
      kind: "web",
      capabilities: () => ({}),
      open: async () => {},
      close: async () => {},
      snapshot: async () => ({}),
      act: async () => ({ ok: true }),
      read: async (_kind: string, _ref: unknown, name: unknown) => {
        receivedName = name as string;
        return "test-value";
      },
      check: async () => ({ ok: true }),
      describe: async () => ({}),
      screenshot: async () => {},
    } as never;

    const sessionId = store.create(mockSurface, "test");
    await dispatchRead({ sessions: store }, {
      session: sessionId,
      kind: "attribute" as never,
      ref: "r1",
      name: "aria-label",
    });
    expect(receivedName).toBe("aria-label");
  });

  it("service surface dispatch source forwards ref2 and name", () => {
    const source = readFileSync(
      join(ROOT, "packages", "cli", "src", "service-api.ts"),
      "utf8",
    );
    // The dispatch block where act/read/check calls are made must forward
    // ref2 for act and name for read. Scan a window around each call site.
    const actIdx = source.indexOf("surface.act(", source.indexOf("call === \"act\""));
    expect(actIdx, "must find the dispatch surface.act call").toBeGreaterThan(-1);
    const actWindow = source.slice(actIdx, actIdx + 200);
    expect(actWindow, "dispatch surface.act must forward ref2").toContain("ref2");

    const readIdx = source.indexOf("surface.read(", source.indexOf("call === \"read\""));
    expect(readIdx, "must find the dispatch surface.read call").toBeGreaterThan(-1);
    const readWindow = source.slice(readIdx, readIdx + 200);
    expect(readWindow, "dispatch surface.read must forward name").toContain("name");
  });
});

/**
 * Defect 6 (G11, Source): docs/mcp.md tells people to run `npx yam`,
 * which resolves to an unrelated package on the public registry. The
 * package is `@svatah/yam`.
 *
 * Regression: no doc file should reference `npx yam` without the scope.
 */
describe("G11: docs reference correct package name (SF-02, SF-20)", () => {
  it("docs/mcp.md does not reference unscoped yam package", () => {
    const content = readFileSync(join(ROOT, "docs", "mcp.md"), "utf8");
    // Check for both inline `npx yam` and JSON config { "args": ["yam", ...] }
    // which together form `npx yam`. The package is @svatah/yam.
    const hasUnscopedInline = content.split("\n").some(
      (line) => /\bnpx\s+yam\b/.test(line) && !line.includes("@svatah/yam"),
    );
    const hasUnscopedInArgs = /["']args["']\s*:\s*\[["']yam["']/.test(content);
    const hasUnscoped = hasUnscopedInline || hasUnscopedInArgs;
    expect(
      hasUnscoped,
      "docs/mcp.md should use @svatah/yam, not bare yam in npx/args",
    ).toBe(false);
  });
});
