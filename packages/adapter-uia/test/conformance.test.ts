/**
 * The desktop conformance suite, against the ADE's recorded trees (T6.2,
 * REQ-SURF-3, REQ-ADE-6, LLD §14, §16).
 *
 * ## What this is, and what it is not
 *
 * It is the published suite (`@svatah/conformance`'s `DESKTOP_CASES`) run
 * against this adapter, with the bridge replaying the trees `test/recorded.ts`
 * describes. Every case, every check, the real runner and the real report.
 *
 * It is **not** the conformance result REQ-ADP-6 asks for. That needs the macOS
 * Accessibility permission and a running ADE, and the command for it is in
 * `docs/spec/progress/phase-6.md` beside the reason it could not be run here.
 * A green run of this file says the suite and the adapter agree about the ADE's
 * accessibility tree; it does not say `powershell` reads that tree correctly.
 */
import { describe, expect, it } from "vitest";
import { DESKTOP_CASES, runSurfaceConformance } from "@svatah/conformance";
import { UiaSurface } from "../src/index.js";
import { ADE_SCREENS, recordedBridge, type AdeScreen } from "./recorded.js";

describe("the desktop conformance suite against the recorded ADE (T6.1)", () => {
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
    const byPath = new Map<string, AdeScreen>();
    const bridge = recordedBridge({
      screen: "flows",
      onCommand: (command) => {
        // A row is selected through `SelectionItemPattern` and a button is
        // invoked — see `UiaSurface.invoke`. A handler that watched only for a
        // click would never see the ADE's screens change.
        if (command.kind !== "pattern" && command.kind !== "click") return undefined;
        const key = "path" in command ? command.path.join(".") : "";
        return byPath.get(key);
      },
    });

    const surface = new UiaSurface({ processName: "Svatah ADE", bridge });
    await surface.open({ kind: "desktop", processName: "Svatah ADE" } as never);

    /** Which fixture each navigable control opens, by `automationId`. */
    const screens: Record<string, AdeScreen> = {
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
        const one = new UiaSurface({ processName: "Svatah ADE", bridge });
        await one.open({ kind: "desktop", processName: "Svatah ADE" } as never);
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

  it("covers the five flows LLD §16 names, and nothing else claims to be one", () => {
    expect(DESKTOP_CASES.map((one) => one.id)).toEqual([
      "ade.snapshot",
      "ade.project",
      "ade.flow",
      "ade.run",
      "ade.result",
      "ade.api-client",
      "ade.inspector",
      "ade.no-navigation",
    ]);
  });
});
