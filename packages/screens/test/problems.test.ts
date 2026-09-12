/**
 * The six states a surface can be in (TV-A05, SF-17).
 *
 * `SF-17` requires every one of them to name a specific next action, and the
 * `TUI-Surface-States` board draws six cards saying exactly that. What stops
 * the seventh from arriving without one is this: the kinds are enumerated from
 * the type, every one is produced, and every one is asked whether it says what
 * to do.
 *
 * The busy state is the reason `nextActionId` is optional and `nextAction` is
 * not: taking control from another client is an action, and being told which
 * client holds it is sometimes all a person can act on.
 */
import { describe, expect, it } from "vitest";
import { problemFor, type SurfaceProblemKind } from "../src/index.js";

/** Every kind, and a service code that produces it. */
const CODES: Readonly<Record<SurfaceProblemKind, string>> = {
  stale: "STALE_REFERENCE",
  busy: "CONTROL_BUSY",
  unsupported: "UNSUPPORTED_OPERATION",
  permission: "PERMISSION_REQUIRED",
  unknown: "OUTCOME_UNKNOWN",
  disconnected: "SESSION_NOT_FOUND",
};

describe("every state a surface can be in names a next action (SF-17, TV-A05)", () => {
  for (const [kind, code] of Object.entries(CODES) as Array<[SurfaceProblemKind, string]>) {
    it(`${kind} says what to do about it`, () => {
      const problem = problemFor(code, "the service's own words");
      expect(problem, `${code} produces no problem at all`).toBeDefined();
      expect(problem!.kind).toBe(kind);
      expect(problem!.nextAction.length, `${kind} offers no next action`).toBeGreaterThan(0);
      /* And it says what happened in the service's words, not a paraphrase. */
      expect(problem!.message).toBe("the service's own words");
    });
  }

  it("covers every kind the type declares, so a seventh cannot arrive quietly", () => {
    /*
     * The list above is exhaustive over `SurfaceProblemKind` by construction —
     * `Record<SurfaceProblemKind, string>` will not compile if a kind is added
     * and not given a code here, which is what makes this a check rather than a
     * list somebody keeps up to date.
     */
    expect(Object.keys(CODES).sort()).toEqual(
      ["busy", "disconnected", "permission", "stale", "unknown", "unsupported"].sort(),
    );
  });

  it("says nothing at all for a code that is not a problem", () => {
    expect(problemFor(undefined, "")).toBeUndefined();
    expect(problemFor("SOMETHING_ELSE", "x")).toBeUndefined();
  });
});
