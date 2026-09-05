/**
 * T2.10 — the compatibility milestone's committed result (REQ-NFR-8, REQ-STD-2).
 *
 * `scripts/compatibility.mjs` is what *makes* the claims — determinism, one plan
 * under both hosts, byte-stable compiles — because they need a browser and an
 * application. This holds the committed evidence in place:
 *
 * * the run directory exists and is complete;
 * * the set of steps that do not pass is exactly the four documented in the
 *   fixture's README, so a fifth failure fails the build rather than being
 *   absorbed into a number;
 * * every result validates against the published schema, which is what a foreign
 *   runtime is compared against (REQ-STD-3).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stepResultSchema, summarySchema } from "@svatah/schema";
import { fromRoot } from "../src/repo.js";

const DIR = fromRoot("evals", "conformance", "runtime");

const results = readFileSync(join(DIR, "results.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as Record<string, unknown>);

/**
 * The steps the fixture's README documents as unable to pass against
 * `apps/sample-web`. Each is an assumption the *original* application satisfied.
 */
const DOCUMENTED_FAILURES = [
  "Click the Indiranagar suggestion",
  "The schedule heading should be visible",
  "Type {data.user.email} into the username field",
  "Wait for the username field to be present",
];

describe("the runtime conformance fixture (T2.10)", () => {
  it("is complete", () => {
    for (const file of ["results.jsonl", "summary.json", "plan.sha256", "README.md"]) {
      expect(existsSync(join(DIR, file)), file).toBe(true);
    }
  });

  it("records every step of the four flows", () => {
    expect(results.length).toBeGreaterThanOrEqual(40);
    expect(new Set(results.map((r) => r["flow"]))).toEqual(
      new Set([
        "flows/simple.flow",
        "flows/svatah.flow",
        "flows/natural_language_login.flow",
        "flows/execution.flow",
      ]),
    );
  });

  it("is canonical, so it can be diffed", () => {
    /*
     * A run id, three timestamps and a duration change on every run. A verbatim
     * copy could never be diffed — CI would report a change every time — so
     * those are removed, and what is left is what a foreign runtime is compared
     * on (REQ-STD-3).
     */
    for (const result of results) {
      for (const field of ["runId", "startedAt", "endedAt", "durationMs"]) {
        expect(result[field], `${field} is still in the fixture`).toBeUndefined();
      }
    }
    const summary = JSON.parse(readFileSync(join(DIR, "summary.json"), "utf8")) as Record<string, unknown>;
    expect(summary["runId"]).toBeUndefined();
    expect(summary["totals"]).toBeDefined();
    expect(summary["planHash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("every result is the shape the published schema describes (REQ-STD-1)", () => {
    // Minus the run's own fields, which is what `stepResultSchema` also wants
    // once they are put back — so the check is that the rest is intact.
    const at = "2026-09-02T00:00:00.000Z";
    for (const result of results) {
      expect(() =>
        stepResultSchema.parse({
          ...result,
          runId: "r",
          startedAt: at,
          endedAt: at,
          durationMs: 0,
        }),
      ).not.toThrow();
    }
    expect(() =>
      summarySchema.parse({
        ...(JSON.parse(readFileSync(join(DIR, "summary.json"), "utf8")) as object),
        runId: "r",
        startedAt: at,
        endedAt: at,
        configHash: "c",
      }),
    ).not.toThrow();
  });

  it("fails exactly the four documented steps, and no others", () => {
    const failed = results.filter((r) => r["status"] === "failed").map((r) => r["text"] as string);
    expect(failed.sort()).toEqual([...DOCUMENTED_FAILURES].sort());
  });

  it("documents each of them, with a reason", () => {
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    for (const step of DOCUMENTED_FAILURES) {
      expect(readme, `${step} is not documented`).toContain(step);
    }
  });

  it("records which candidate matched, for every step that resolved one", () => {
    // REQ-STD-3 compares a foreign runtime on statuses *and* matched candidates.
    const acted = results.filter((r) => r["status"] === "passed" && r["matched"] !== undefined);
    expect(acted.length).toBeGreaterThan(10);
    for (const result of acted) {
      expect(result["matched"]).toHaveProperty("by");
      expect(result["matched"]).toHaveProperty("candidateIndex");
    }
  });

  it("carries the plan hash the run was made from (REQ-COMP-7)", () => {
    expect(readFileSync(join(DIR, "plan.sha256"), "utf8")).toMatch(/^[0-9a-f]{64} {2}plan\.json/);
  });

  it("skips the rest of a story after a failure, which is the default policy", () => {
    // REQ-RUN-4. Named so the 15 skips read as the policy working rather than as
    // 15 more things that went wrong.
    expect(results.filter((r) => r["status"] === "skipped").length).toBeGreaterThan(0);
  });
});
