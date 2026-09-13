/**
 * Every feature the product has is reachable from the app (`AX-18`, E1.7).
 *
 * The walkthrough of 2026-09-11 told a narrative — arrive, connect, record,
 * say, do — and four things the product can do were in none of it: watching
 * what a person does, handing a target to an agent and taking it back, healing
 * a run, and reading a run's report. Each of them exists. None of them was on
 * the path anybody was on.
 *
 * "Reachable" is made precise here, because the word on its own would pass on
 * anything:
 *
 *   * the **action** exists in the one registry both renderers read, and it is
 *     on a screen — so the cockpit has it too, and not only the app;
 *   * the **screen** it lives on is on the rail, or is opened by an action from
 *     a screen that is, transitively. A destination reachable only by typing
 *     its name into the palette is reachable the way a phone number is.
 *
 * This is a check of the model, which is the layer that can say "unreachable"
 * about both renderers at once. Whether the control is on the *screen* is the
 * app's own suite (`apps/desktop/test/first-task.test.tsx`) and the cockpit's
 * (`packages/tui/test/keys-reach.test.tsx`).
 */
import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  RAIL,
  SCREEN_IDS,
  actionById,
  screenById,
  type ScreenId,
} from "@svatah/yam-screens";

/** The four, named as the walkthrough names them, with what each is. */
const FEATURES: ReadonlyArray<{
  readonly feature: string;
  readonly actions: readonly string[];
  readonly screen: ScreenId;
}> = [
  {
    feature: "watching what a person does",
    actions: ["capture.start", "capture.stop"],
    screen: "session",
  },
  {
    feature: "handing a target to an agent, and taking it back",
    actions: ["surface.take-control", "surface.release-control"],
    screen: "session",
  },
  { feature: "healing a run", actions: ["heal.run", "heal.apply"], screen: "heal" },
  { feature: "a run's report", actions: ["run.again"], screen: "run" },
];

/** The screens the rail names outright. */
const ON_THE_RAIL = new Set<string>(RAIL.map((one) => one.screen));

/**
 * Everywhere you can get to, following actions from the rail (`AX-18`).
 *
 * A closure, not one step. The first form of this check took one hop from the
 * rail and reported Heal review unreachable — which was wrong in an instructive
 * way: Heal is reached from a *run*, and a run is reached from Runs, which is
 * on the rail. Two hops. A rule that only looks one deep calls a working path a
 * broken one, and the fix for a false report is usually to delete the rule.
 *
 * `goTo` is declared by the action's outcome rather than by its shape, so this
 * reads the registry's own source: the alternative is running every action
 * against a service, which is what the eval suite does and what a repository
 * check cannot.
 */
const REACHABLE = ((): ReadonlySet<string> => {
  const found = new Set<string>(ON_THE_RAIL);
  for (;;) {
    const before = found.size;
    for (const action of ACTIONS) {
      if (!found.has(action.screen)) continue;
      for (const match of String(action.run).matchAll(/goTo:\s*"([a-z]+)"/g)) found.add(match[1]!);
    }
    if (found.size === before) return found;
  }
})();

describe("every feature the product has is reachable from the app (AX-18)", () => {
  for (const one of FEATURES) {
    it(`offers ${one.feature}`, () => {
      for (const id of one.actions) {
        const action = actionById(id);
        expect(action, `${id} is in no registry, so neither renderer can offer it`).toBeDefined();
        expect(
          SCREEN_IDS.includes(action!.screen as ScreenId),
          `${id} is on "${action!.screen}", which is not a screen`,
        ).toBe(true);
      }
      expect(SCREEN_IDS.includes(one.screen), `${one.screen} is not a screen`).toBe(true);
      expect(screenById(one.screen).title, `${one.screen} has no title`).not.toBe("");
    });

    it(`can be got to: ${one.screen}`, () => {
      const reachable = REACHABLE.has(one.screen);
      expect(
        reachable,
        `${one.screen} is on no rail and no action goes there — the palette is not navigation`,
      ).toBe(true);
    });
  }

  it("names a destination for every screen, so none is orphaned", () => {
    /*
     * The general form of the rule above. It is here rather than only over the
     * four because a screen that becomes unreachable does so by something
     * *else* changing — a rail entry moved, an action's `goTo` renamed — and
     * the four would not notice.
     */
    const orphans = SCREEN_IDS.filter((one) => !REACHABLE.has(one));
    expect(orphans, `${orphans.join(", ")} cannot be reached`).toEqual([]);
  });
});
