/**
 * The host tests' fixture plan.
 *
 * Read from `project/plan.json`, not compiled here: `@svatah/yam-host-playwright`
 * must not depend on the compiler (LLD §1), in devDependencies as much as
 * anywhere, and the boundary is right — the host *consumes* a plan.
 *
 * The plan is committed and `node scripts/compile-fixtures.mjs` regenerates it;
 * `tools/repo-checks/test/fixture-plans.test.ts` fails when the two disagree, so
 * a compiler change cannot drift away from these tests.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planSchema, type Plan } from "@svatah/yam-schema";

export const PROJECT = join(dirname(fileURLToPath(import.meta.url)), "project");

export async function compiledPlan(): Promise<Plan> {
  return planSchema.parse(
    JSON.parse(readFileSync(join(PROJECT, "plan.json"), "utf8")),
  ) as Plan;
}
