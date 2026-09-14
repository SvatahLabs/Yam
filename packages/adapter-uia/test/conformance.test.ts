/**
 * The desktop conformance suite, against the app's recorded trees (T6.2,
 * REQ-SURF-3, REQ-ADE-6, LLD §14, §16).
 *
 * ## What this is, and what it is not
 *
 * It is the published suite (`@svatah/yam-conformance`'s `DESKTOP_CASES`) run
 * against this adapter, with the bridge replaying the trees `test/recorded.ts`
 * describes. Every case, every check, the real runner and the real report.
 *
 * It is **not** the conformance result REQ-ADP-6 asks for. That needs the macOS
 * Accessibility permission and a running APP_DIR, and the command for it is in
 * `docs/spec/progress/phase-6.md` beside the reason it could not be run here.
 * A green run of this file says the suite and the adapter agree about the app's
 * accessibility tree; it does not say `powershell` reads that tree correctly.
 */
import { describe, expect, it } from "vitest";
import { DESKTOP_CASES, runSurfaceConformance } from "@svatah/yam-conformance";
import { UiaSurface } from "../src/index.js";
import { ADE_SCREENS, recordedBridge, type AppScreen } from "./recorded.js";

describe("the desktop conformance suite against the recorded APP_DIR (T6.1)", () => {
  it("runs every case, and every check holds", async () => {
    /*
     * The bridge maps a select on a **rail item** to the screen it opens, by
     * reading the path the adapter sends against the tree it last served. That
     * is the smallest faithful stand-in for the application: the suite presses
     * a rail row by its `automationId`, and the next snapshot is that screen
     * (T10.3 — the eleven tabs are gone).
     *
     * The four screens the rail does not carry — `run`, `record`, `heal`,
     * `explorer` — are reached through the palette's `Go to` rows, and those are
     * mapped the same way.
     */
    const byPath = new Map<string, AppScreen>();
    const bridge = recordedBridge({
      screen: "flows",
      onCommand: (command) => {
        // A row is selected through `SelectionItemPattern` and a button is
        // invoked — see `UiaSurface.invoke`. A handler that watched only for a
        // click would never see the app's screens change.
        if (command.kind !== "pattern" && command.kind !== "click") return undefined;
        const key = "path" in command ? command.path.join(".") : "";
        return byPath.get(key);
      },
    });

    const surface = new UiaSurface({ processName: "Yam", bridge });
    await surface.open({ kind: "desktop", processName: "Yam" } as never);

    /** Which fixture each navigable control opens, by `automationId`. */
    const screens: Record<string, AppScreen> = {
      "rail-flows": "flows",
      "rail-runs": "results",
      "rail-bindings": "bindings",
      "rail-agents": "flows",
      "rail-api": "api",
      "rail-data": "flows",
      "rail-import": "flows",
      "rail-settings": "project",
      /*
       * The palette is a screen of its own here: pressing the top bar's button
       * serves the tree recorded with it open, and its `Go to` rows then serve
       * the four screens the rail does not carry (T10.3).
       */
      "open-command-palette": "palette",
      /*
       * Pressing Run on the Flows screen serves the Run screen (T12.3).
       *
       * `app.result` makes a run before it reads the table, because the branch
       * that reads rows was never exercised otherwise. The stand-in has to
       * behave like the application here too, or the case would wait three
       * minutes for a screen a recording will never change to.
       */
      "action-run-flow": "run",
      "palette-go-run": "run",
      "palette-go-record": "record",
      "palette-go-explorer": "explorer",
      "palette-go-heal": "results",
    };

    /*
     * Learn which path each of them is at, in **every** tree.
     *
     * A control's path is a property of the tree it is in: the rail is on every
     * screen, at a different path on each, and the palette's rows are only in
     * the palette's. One pass per fixture is what makes the stand-in behave like
     * an application where the rail works wherever you are.
     */
    const learn = async (): Promise<void> => {
      for (const [id, target] of Object.entries(screens)) {
        const refs = await surface.locate({ by: "automationId", value: id, score: 1 });
        if (refs.length !== 1) continue;
        const path = (surface as unknown as { nodes: Array<{ ref: string; path: number[] }> }).nodes
          .find((one) => one.ref === refs[0])!
          .path.join(".");
        byPath.set(path, target);
      }
    };
    for (const one of ADE_SCREENS) {
      bridge.setScreen(one);
      await surface.snapshot();
      await learn();
    }
    bridge.setScreen("flows");
    await surface.close();

    const report = await runSurfaceConformance({
      adapter: "uia",
      baseUrl: "",
      cases: DESKTOP_CASES,
      openSurface: async () => {
        const one = new UiaSurface({ processName: "Yam", bridge });
        await one.open({ kind: "desktop", processName: "Yam" } as never);
        return one;
      },
    });

    const failed = report.cases
      .filter((one) => one.status === "failed")
      .map((one) => ({
        id: one.id,
        error: one.error,
        checks: one.checks.filter((check) => !check.ok),
      }));
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.totals.passed).toBe(DESKTOP_CASES.length);
    expect(report.conformant).toBe(true);
  }, 60_000);

  it("counts a window that is its own Window pattern as having its controls", async () => {
    /*
     * On the Windows runner Chromium's frame published no caption button at all
     * — not in the walk, not in the raw view, not to hit-testing — and the
     * window element carried `WindowPattern`. The recorded trees have the three
     * buttons, so here they are taken away (by id, so the tree keeps its shape)
     * and the root is given the patterns the runner's root had, or not.
     */
    const snapshotCase = async (rootPatterns: readonly string[]) => {
      const recorded = recordedBridge({ screen: "flows" });
      const bridge: typeof recorded = {
        ...recorded,
        async window(request) {
          const window = await recorded.window(request);
          return {
            ...window,
            nodes: window.nodes.map((node, index) =>
              index === 0
                ? { ...node, patterns: rootPatterns }
                : ["Close", "Minimize", "Maximize"].includes(node.automationId ?? "")
                  ? { ...node, automationId: `not-chrome-${node.automationId}` }
                  : node,
            ),
          };
        },
      };
      const report = await runSurfaceConformance({
        adapter: "uia",
        baseUrl: "",
        cases: DESKTOP_CASES,
        only: ["app.snapshot"],
        openSurface: async () => {
          const one = new UiaSurface({ processName: "Yam", bridge });
          await one.open({ kind: "desktop", processName: "Yam" } as never);
          return one;
        },
      });
      return report.cases[0]!.checks.find((check) => check.description === "the window's own controls are in the snapshot");
    };

    expect((await snapshotCase(["Window", "Transform", "ScrollItem", "ItemContainer"]))?.ok).toBe(true);
    // And a window with neither the buttons nor the pattern still fails.
    expect((await snapshotCase(["Transform"]))?.ok).toBe(false);
  });

  it("covers the five flows LLD §16 names, and nothing else claims to be one", () => {
    expect(DESKTOP_CASES.map((one) => one.id)).toEqual([
      "app.snapshot",
      "app.project",
      "app.flow",
      "app.run",
      "app.result",
      "app.api-client",
      "app.inspector",
      "app.no-navigation",
    ]);
  });
});
