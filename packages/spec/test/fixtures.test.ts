/**
 * T2.1 — the five fixture flows read cleanly (REQ-NFR-8).
 *
 * The unit tests above each check one rule on a flow written to exercise it.
 * This checks the flows that actually exist: the four migrated from the legacy
 * project and the compensation showcase. They are the compatibility milestone's
 * input (T2.10), so a reader that cannot read them is a reader that is finished
 * with nothing.
 *
 * It reads them from `evals/fixtures`, not from a copy, so the two cannot drift.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { formatDiagnostic, isStoryBlock, readProjectFrom } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "evals", "fixtures");

const { project, diagnostics } = readProjectFrom({
  root: ROOT,
  flowsDir: "flows",
  apiDir: "api",
  dataFile: "data.yaml",
  // No secrets are set, so the run-level ones are expected to be unresolved.
  env: {},
});

describe("the fixture flows (REQ-NFR-8)", () => {
  it("reads with no errors", () => {
    const errors = diagnostics.filter((d) => d.severity === "error");
    expect(errors.map(formatDiagnostic)).toEqual([]);
  });

  it("warns only about the secrets nobody set in this environment", () => {
    expect(diagnostics.map((d) => d.code)).toEqual(
      diagnostics.map(() => "W_SECRET_UNSET"),
    );
    expect(diagnostics.length).toBe(3);
  });

  it("finds all five flow files", () => {
    expect(project.flows.map((f) => f.file).sort()).toEqual([
      "flows/booking-compensation.flow",
      "flows/execution.flow",
      "flows/natural_language_login.flow",
      "flows/simple.flow",
      "flows/svatah.flow",
    ]);
  });

  it("reads the seven original execution.flow scenario names, in order", () => {
    // P0-F2 restored these. The reader is the first thing that would lose them.
    const execution = project.flows.find((f) => f.file === "flows/execution.flow")!;
    expect(execution.blocks.filter(isStoryBlock).map((b) => b.name)).toEqual([
      "start zoomcar booking",
      "perform search",
      "select date and time",
      "select car and login",
      "checkout the selected car",
      "initiate payment",
      "logout",
    ]);
  });

  it("reads simple.flow's signature", () => {
    const login = project.stories.get("I want to validate login")!.story;
    expect(login.signature).toEqual({
      inputs: { email: { type: "string" }, password: { type: "secret" } },
      outputs: { enterprise: { type: "string" } },
    });
    expect(login.meta.tags).toEqual(["smoke"]);
  });

  it("reads the compensation policy the showcase exists for (REQ-AUTO-4)", () => {
    expect(project.stories.get("book a slot")!.story.meta.onFailure).toEqual({
      compensate: "cancel booking",
    });
    expect(project.stories.get("cancel booking")!.story.meta.idempotent).toBe(true);
  });

  it("resolves every name a compose or run block uses", () => {
    // Covered by "reads with no errors" as well, but named separately: this is
    // the property that makes the compatibility run (T2.10) possible at all.
    expect(diagnostics.filter((d) => d.code === "E_UNKNOWN_STORY")).toEqual([]);
    expect([...project.runs.values()].every((names) => names.length > 0)).toBe(true);
  });

  it("reads the named API request the flows call", () => {
    expect(project.apis.requests.get("active count")?.url).toBe(
      "{data.baseUrl}/api/active-count",
    );
  });

  it("reads the data and its three secret paths", () => {
    expect([...project.data.secrets].sort()).toEqual([
      "card.cvv",
      "card.number",
      "user.password",
    ]);
    expect(project.data.values["baseUrl"]).toBe("http://localhost:4173");
  });

  it("keeps every story's steps, and none of the comments", () => {
    const counts = Object.fromEntries(
      [...project.stories].map(([name, { story }]) => [name, story.steps.length]),
    );
    // svatah.flow has 18 non-comment lines under the header and 16 steps: its
    // two commented-out steps must not appear.
    expect(counts["Validate Text"]).toBe(16);
    expect(Object.values(counts).every((n) => n > 0)).toBe(true);
  });
});
