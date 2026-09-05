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
import { recordedBridge, type AdeScreen } from "./recorded.js";

describe("the desktop conformance suite against the recorded ADE (T6.1)", () => {
  it("runs every case, and every check holds", async () => {
    /*
     * The bridge maps a select on a tab to the screen it opens, by reading the
     * path the adapter sends against the tree it last served. That is the
     * smallest faithful stand-in for the application: the suite clicks a tab by
     * name, and the next snapshot is that screen.
     */
    const byPath = new Map<string, AdeScreen>();
    const bridge = recordedBridge({
      screen: "project",
      onCommand: (command) => {
        // A tab is selected through `SelectionItemPattern`, not invoked — see
        // `UiaSurface.invoke`. A handler that watched only for a click would
        // never see the ADE's screens change.
        if (command.kind !== "pattern" && command.kind !== "click") return undefined;
        const key = "path" in command ? command.path.join(".") : "";
        return byPath.get(key);
      },
    });

    const surface = new UiaSurface({ processName: "Svatah ADE", bridge });
    await surface.open({ kind: "desktop", processName: "Svatah ADE" } as never);

    // Learn which path each tab is at, from the tree itself.
    const tabs: Array<{ name: string; path: string }> = [];
    for (const node of (await surface.snapshot()).nodes) {
      if (node.role !== "tab" || node.name === undefined) continue;
      const refs = await surface.locate({
        by: "role",
        role: "tab",
        name: node.name,
        exact: true,
        score: 1,
      });
      const path = (surface as unknown as { nodes: Array<{ ref: string; path: number[] }> }).nodes
        .find((one) => one.ref === refs[0])!
        .path.join(".");
      tabs.push({ name: node.name, path });
    }
    const screens: Record<string, AdeScreen> = {
      Project: "project",
      "Flow editor": "flows",
      Run: "run",
      Results: "results",
      "API client": "api",
      "Record review": "record",
    };
    for (const tab of tabs) {
      const target = screens[tab.name];
      if (target !== undefined) byPath.set(tab.path, target);
    }
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
      "ade.no-navigation",
    ]);
  });
});
