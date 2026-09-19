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
    const { SURFACE_CLI_SUBCOMMANDS } = await import("@svatah/yam-contract");
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
describe("G03: an action is always offered, and always completable (SF-11, SF-17)", () => {
  /*
   * The defect was the Explorer's Act button refusing every press with "Choose
   * an action": the renderer never collected one. T15 removed that screen, and
   * the contract is now stronger and is *data* rather than a string in a
   * renderer — so this asserts the behaviour instead of grepping a source file,
   * which is what let the original defect through.
   */
  it("a text field opens on an action that can be completed", async () => {
    const { defaultActionForRole, offeredActions, actionFormFor } = await import(
      "@svatah/yam-schema"
    );
    const web = offeredActions("web", { drag: true });
    expect(web.length, "a web surface must offer actions").toBeGreaterThan(0);

    // Selecting a text field offers to fill it, and the form says what that needs.
    const chosen = defaultActionForRole("textbox");
    expect(chosen).toBe("type");
    expect(web.some((one) => one.action === chosen)).toBe(true);
    expect(actionFormFor(chosen)!.fields.map((one) => one.name)).toEqual(["value"]);
  });

  it("never offers an action whose arguments it cannot collect", async () => {
    const { offeredActions, actionFormFor } = await import("@svatah/yam-schema");
    // Every offered action is described, and every required field is named — a
    // form that could not be completed is the dead end this defect was.
    for (const kind of ["web", "desktop", "mobile"] as const) {
      for (const offer of offeredActions(kind, { drag: true, upload: true, dialogs: true, frames: true, windows: true })) {
        const form = actionFormFor(offer.action);
        expect(form, offer.action).toBeDefined();
        for (const field of form!.fields) {
          expect(field.name.length, `${offer.action}.${field.name}`).toBeGreaterThan(0);
          expect(field.label.length, `${offer.action}.${field.name}`).toBeGreaterThan(0);
        }
      }
    }
    // An HTTP surface is not an element surface and offers none; it has `request`.
    expect(offeredActions("http", {})).toEqual([]);
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
    const { operationByName } = await import("@svatah/yam-contract");
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

  it("the catalogue's connect takes an adapter, and the dispatcher validates it", async () => {
    /*
     * G04 was "`POST /surface/:session/open` drops `adapter`". T15 removed that
     * route with the Explorer that was its only caller, so the contract this
     * defect is about is now the catalogue's `connect`: it declares `adapter`,
     * and `dispatchConnect` refuses one this host cannot run *before* launching
     * anything (the case above). Asserting on the removed route would be
     * asserting about code nothing serves.
     */
    const { operationByName } = await import("@svatah/yam-contract");
    const connect = operationByName("connect")!;
    expect(connect.service).toEqual({ method: "POST", path: "/sessions" });
    const shape = connect.inputSchema.safeParse({ url: "http://127.0.0.1:1", adapter: "uia" });
    expect(shape.success, "connect must accept an adapter").toBe(true);
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
    const { operationByName } = await import("@svatah/yam-contract");

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
    const { operationByName } = await import("@svatah/yam-contract");
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
    const { operationByName } = await import("@svatah/yam-contract");
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
    const { operationByName } = await import("@svatah/yam-contract");
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
      // A surface that is asked to drag says it can: `dragTo` is refused before
      // dispatch when the `drag` capability is false (SF-11).
      capabilities: () => ({ drag: true }),
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

  it("the catalogue carries ref2, attribute name and the snapshot options", async () => {
    /*
     * The defect was an argument forwarded one layer and dropped the next. The
     * old service dispatch it was found in went with the Explorer (T15), so
     * this asserts the *contract* every interface is generated from: if the
     * catalogue accepts them, CLI, MCP and HTTP all carry them.
     */
    const { operationByName } = await import("@svatah/yam-contract");
    const act = operationByName("act")!;
    expect(act.inputSchema.safeParse({
      session: "s", action: "dragTo", ref: "r1", ref2: "r2", snapshot: "snap_1",
    }).success, "act must carry ref2 and snapshot").toBe(true);

    const read = operationByName("read")!;
    expect(read.inputSchema.safeParse({
      session: "s", kind: "attribute", ref: "r1", name: "data-testid",
    }).success, "read must carry the attribute name").toBe(true);

    const snapshot = operationByName("snapshot")!;
    expect(snapshot.inputSchema.safeParse({
      session: "s", maxNodes: 50, root: "r1", interactiveOnly: true,
    }).success, "snapshot must carry its limits").toBe(true);
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
