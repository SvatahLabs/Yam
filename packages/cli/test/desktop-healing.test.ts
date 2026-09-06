/**
 * The desktop healing cases, against the ADE's recorded variant trees
 * (T7.1, P6-F3, Draft 2.8 LLD §16, REQ-HEAL-5, REQ-ADE-6).
 *
 * > the ADE gains `SVATAH_A11Y_VARIANT=1|2`, where variant 1 renames one screen
 * > tab and one button on the Project screen and variant 2 moves the Record
 * > screen's gateway control into a different panel; a binding recorded at
 * > variant 0 must relocalize on both through the desktop adapter with the same
 * > weights and threshold as the web healing eval.
 *
 * T6.1 asked for this and Phase 6 shipped without it and without a deviation
 * (Phase 6 verification, F3). This is the part of it that runs anywhere: the
 * published healing cases, the real runner, the real `relocalize` from
 * `@svatah/bindings` with its own weights and threshold, and both desktop
 * adapters — driven against the trees `scripts/record-desktop-tree.mjs` recorded
 * from the real ADE at variants 0, 1 and 2.
 *
 * What it does *not* do is read `AXUIElement` or a UIA tree; that is the live
 * gate, and `docs/spec/progress/phase-7.md` states where it stands. A green run
 * here says the healing cases, the adapters' normalisation and the relocalizer
 * agree about the ADE's tree at all three variants. It does not say a bridge
 * read that tree.
 *
 * ## Why this test lives in `cli`
 *
 * It needs the relocalizer *and* a desktop adapter. `@svatah/bindings-cli` may
 * reach only the Playwright adapter (LLD §1), and an adapter may not reach the
 * bindings store — `cli` is the one package the boundaries let hold both, which
 * is the same reason it is the only place that registers adapters. The recorded
 * trees are read from the adapters' own fixture directories rather than copied,
 * because a 488-node tree in two places is a 488-node tree that will disagree
 * with itself.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fingerprint, relocalize } from "@svatah/bindings";
import {
  DESKTOP_HEALING_CASES,
  runSurfaceConformance,
  type DesktopHealing,
  type RecordedElement,
} from "@svatah/conformance";
import { AxSurface, type AxBridge, type AxWindow } from "@svatah/adapter-ax";
import { UiaSurface, type UiaBridge, type UiaWindow } from "@svatah/adapter-uia";
import type { AgentSurface } from "@svatah/surface";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtures = (adapter: "ax" | "uia"): string =>
  join(HERE, "..", "..", `adapter-${adapter}`, "test", "fixtures");

/** LLD §16's ground truth, and the attribute the scorer is blind to. */
const GROUND_TRUTH_ATTRIBUTE = "automationId";

/**
 * A bridge that serves one recorded tree, whatever is asked of it.
 *
 * The healing cases click a tab and snapshot; a fixture *is* one screen, so the
 * click is a no-op and the snapshot is the same tree. That is enough, because
 * what the cases measure is relocalization across two trees, not navigation —
 * and the tab the case clicks is present in every one of these fixtures.
 */
function replaying<W>(file: string, cost: Record<string, number>): W & { nodes: unknown[] } {
  const window = JSON.parse(readFileSync(file, "utf8")) as { nodes: unknown[] };
  return { ...window, cost: { nodes: window.nodes.length, wallMs: 0, msPerNode: 0, ...cost } } as never;
}

function axSurface(file: string): AgentSurface {
  const bridge: AxBridge = {
    async permission() {
      return { state: "granted", advice: "granted (recorded)" };
    },
    // These cases replay a recorded tree; the login session behind them is one
    // in which the ADE had a window, because that is where the trees came from.
    async session() {
      return {
        usable: true,
        state: "usable",
        owners: ["Svatah ADE"],
        detail: "1 application(s) own a window: Svatah ADE",
        advice: "recorded",
      };
    },
    async window() {
      return replaying<AxWindow>(file, { invocations: 0, axCalls: 0 });
    },
    async perform() {
      // A recorded tree does not change; the cases never need it to.
    },
    async screenshot() {},
  };
  return new AxSurface({ processName: "Svatah ADE", bridge });
}

function uiaSurface(file: string): AgentSurface {
  const bridge: UiaBridge = {
    async availability() {
      return { state: "available", advice: "available (recorded)" };
    },
    async window() {
      return replaying<UiaWindow>(file, { invocations: 0 });
    },
    async perform() {},
    async screenshot() {},
  };
  return new UiaSurface({ processName: "Svatah ADE", bridge });
}

/**
 * The healer the CLI injects, built exactly as
 * `packages/bindings-cli/src/commands/surface.ts` builds it: `relocalize`'s own
 * defaults, so "the same weights and threshold as the web healing eval" stays
 * true by construction rather than by two numbers agreeing today.
 */
function healingFor(variant: number, state: Record<string, RecordedElement>): DesktopHealing {
  return {
    variant,
    async fingerprint(surface, ref) {
      return await fingerprint(surface, ref, { ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE] });
    },
    async relocalize(surface, print, preferRole) {
      const result = await relocalize(surface, print, {
        preferRole,
        ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE],
      });
      return {
        outcome: result.outcome,
        ...(result.outcome === "relocalized"
          ? { ref: result.match.ref, score: result.match.score.total }
          : {}),
      };
    },
    recall: (id) => state[id],
    remember: (id, value) => {
      state[id] = value;
    },
  };
}

const CASES = {
  renamed: DESKTOP_HEALING_CASES.filter((one) => one.id === "ade.heal.renamed-control"),
  moved: DESKTOP_HEALING_CASES.filter((one) => one.id === "ade.heal.moved-panel"),
};

async function pass(
  adapter: "ax" | "uia",
  open: (file: string) => AgentSurface,
  screen: string,
  variant: number,
  cases: typeof DESKTOP_HEALING_CASES,
  state: Record<string, RecordedElement>,
): ReturnType<typeof runSurfaceConformance> {
  return await runSurfaceConformance({
    adapter,
    baseUrl: "",
    cases,
    variant,
    healing: healingFor(variant, state),
    openSurface: async () => {
      const surface = open(join(fixtures(adapter), `${screen}.json`));
      await surface.open({ kind: "desktop", processName: "Svatah ADE" } as never);
      return surface;
    },
  });
}

const failures = (report: Awaited<ReturnType<typeof runSurfaceConformance>>): unknown =>
  report.cases
    .filter((one) => one.status === "failed")
    .map((one) => ({ id: one.id, error: one.error, checks: one.checks.filter((c) => !c.ok) }));

for (const [adapter, open] of [
  ["ax", axSurface],
  ["uia", uiaSurface],
] as const) {
  describe(`desktop healing through the ${adapter} adapter (LLD §16, T7.1)`, () => {
    it("records at variant 0 and relocalizes the renamed tab and button at variant 1", async () => {
      const state: Record<string, RecordedElement> = {};

      const recorded = await pass(adapter, open, "ade-flows", 0, CASES.renamed, state);
      expect(failures(recorded), JSON.stringify(failures(recorded), null, 2)).toEqual([]);
      /*
       * One binding now (T10.3): the **rail item** §16's variant 1 renames. It
       * was a screen tab and a Project screen button, and T10.3 deleted both
       * with the eleven screens they belonged to. It is recorded by the
       * ground-truth key that survives the rename, and the fingerprint cannot
       * see that key.
       */
      expect(Object.keys(state).sort()).toEqual(["ade.heal.renamed-control:rail-flows"]);

      const healed = await pass(adapter, open, "ade-flows-v1", 1, CASES.renamed, state);
      expect(failures(healed), JSON.stringify(failures(healed), null, 2)).toEqual([]);
      expect(healed.conformant).toBe(true);
    }, 120_000);

    it("records at variant 0 and relocalizes the moved gateway control at variant 2", async () => {
      const state: Record<string, RecordedElement> = {};

      const recorded = await pass(adapter, open, "ade-record", 0, CASES.moved, state);
      expect(failures(recorded), JSON.stringify(failures(recorded), null, 2)).toEqual([]);
      expect(Object.keys(state)).toEqual(["ade.heal.moved-panel:record-gateway"]);

      const healed = await pass(adapter, open, "ade-record-v2", 2, CASES.moved, state);
      expect(failures(healed), JSON.stringify(failures(healed), null, 2)).toEqual([]);
      expect(healed.conformant).toBe(true);
    }, 120_000);

    it("fails rather than passes when no relocalizer was injected", async () => {
      /*
       * A healing case with no healer must say so. The alternative — skipping —
       * would let a desktop gate report seven green cases and two silences,
       * which is the shape of the finding this whole task exists to fix.
       */
      const report = await runSurfaceConformance({
        adapter,
        baseUrl: "",
        cases: CASES.renamed,
        variant: 1,
        openSurface: async () => {
          const surface = open(join(fixtures(adapter), "ade-flows-v1.json"));
          await surface.open({ kind: "desktop", processName: "Svatah ADE" } as never);
          return surface;
        },
      });
      expect(report.conformant).toBe(false);
      expect(JSON.stringify(report.cases[0]!.checks)).toContain("no healer was injected");
    }, 60_000);
  });
}
