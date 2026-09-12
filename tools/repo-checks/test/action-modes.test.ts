/**
 * The two renderers agree about which mode an action belongs to (REQ-ADE-14).
 *
 * The fact lived only in the cockpit's key table, so the app could not read it —
 * and offered all seventeen of Session's actions on one toolbar whatever the
 * mode. There is no window width at which seventeen fit: **Stop recording** and
 * **Disconnect** were among the shed, and a person with a browser open had no
 * control in the application to close it.
 *
 * It is the action's own property now. This is the check that stops the two
 * descriptions drifting apart again, which is what created the gap.
 */
import { describe, expect, it } from "vitest";
import { ACTIONS, SESSION_MODES, type SessionMode } from "@svatah/yam-screens";
import { keysFor } from "@svatah/yam-tui";

describe("an action's modes are the model's, and the key table matches", () => {
  it("binds no key in a mode the action does not belong to", () => {
    const wrong: string[] = [];
    for (const mode of SESSION_MODES) {
      for (const binding of keysFor("session", mode as SessionMode)) {
        const action = ACTIONS.find((one) => one.id === binding.action);
        if (action === undefined) continue;
        if (action.modes !== undefined && !action.modes.includes(mode as SessionMode)) {
          wrong.push(`${binding.key} runs ${binding.action} in ${mode}, which it is not in`);
        }
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });

  /*
   * Every mode has to be able to do something, or the strip offers a dead end.
   */
  it("leaves no mode with nothing on it", () => {
    for (const mode of SESSION_MODES) {
      const on = ACTIONS.filter(
        (one) =>
          one.screen === "session" &&
          one.group === "Actions" &&
          (one.modes === undefined || one.modes.includes(mode as SessionMode)),
      );
      expect(on.length, `${mode} has no actions`).toBeGreaterThan(0);
    }
  });

  /*
   * The number that broke it. Seventeen on one bar is what the merge produced;
   * a mode that drifts back towards it is the defect coming back.
   */
  it("keeps each mode under what a toolbar can hold", () => {
    for (const mode of SESSION_MODES) {
      const on = ACTIONS.filter(
        (one) =>
          one.screen === "session" &&
          one.group === "Actions" &&
          (one.modes === undefined || one.modes.includes(mode as SessionMode)),
      );
      expect(on.length, `${mode}: ${on.map((x) => x.id).join(", ")}`).toBeLessThanOrEqual(12);
    }
  });
});
