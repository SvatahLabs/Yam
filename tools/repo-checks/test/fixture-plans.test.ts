/**
 * Committed fixture plans do not drift (T2.8).
 *
 * `@svatah/yam-host-playwright` cannot compile its own test plan: LLD §1 forbids the
 * host depending on the compiler, in devDependencies as much as anywhere, and
 * the boundary is right — a host consumes a plan and does not make one.
 *
 * So the plan is compiled from the repository root and committed, and this is
 * what stops it going stale. Without it, a change to the grammar or to the plan
 * shape would leave the host's tests passing against a plan nothing produces any
 * more, which is worse than either failing or being absent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromRoot } from "../src/repo.js";
import { FIXTURE_PROJECTS, planFor } from "../../../scripts/compile-fixtures.mjs";

describe("committed fixture plans", () => {
  it("has fixtures to check, so this suite is not vacuous", () => {
    expect(FIXTURE_PROJECTS.length).toBeGreaterThan(0);
  });

  it.each(FIXTURE_PROJECTS.map((f) => [f.name, f] as const))(
    "%s: the committed plan is what the compiler produces",
    (_name, fixture) => {
      const committed = readFileSync(fromRoot(fixture.plan), "utf8");
      expect(committed, `run \`node scripts/compile-fixtures.mjs\``).toBe(planFor(fixture));
    },
  );
});
