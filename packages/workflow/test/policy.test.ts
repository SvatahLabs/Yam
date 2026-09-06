/**
 * The environment policy (T5.2, REQ-AUTO-7, 8, LLD §13.2).
 *
 * "Production requires `idempotent` or an explicit `allowSideEffects` on each
 * flow run."
 *
 * Four inputs, one answer each, and the one that matters is the default: a
 * non-idempotent story against a production config, with nobody having said
 * anything, is refused. Everything else in this file exists so that refusal
 * cannot be softened by accident.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type Config, type Story } from "@svatah/yam-schema";
import { checkEnvironment, EnvironmentRefusal } from "../src/index.js";

const story = (parts: Partial<Story["meta"]> = {}): Story => ({
  name: "Pay for a slot",
  kind: "story",
  file: "flows/pay.flow",
  meta: { enabled: true, onFailure: "stop", tags: [], ...parts },
  steps: [],
});

/**
 * A config for one case (P6-F5).
 *
 * `DEFAULT_CONFIG` is `Omit<Config, "project">` on purpose: every other field
 * has a defensible default and the project's *name* does not, so a caller has
 * to say it. Spreading the defaults and calling the result a `Config` therefore
 * did not type-check — which is why `pnpm -r typecheck` was red in this package
 * on `master` and stayed red for two phases (K9; Phase 6 verification, F5).
 * Draft 2.8 §16 puts `typecheck` in the verification contract, so it is fixed
 * where it was wrong rather than asserted away.
 */
const config = (parts: Partial<Config> = {}): Config => ({
  ...DEFAULT_CONFIG,
  project: "workflow-policy-test",
  ...parts,
});

describe("production refuses a story that might do something (REQ-AUTO-7)", () => {
  it("refuses a non-idempotent story with nothing said", () => {
    expect(() => checkEnvironment(story(), config({ environment: "production" }))).toThrow(
      EnvironmentRefusal,
    );
  });

  it("says what to do about it, both ways", () => {
    try {
      checkEnvironment(story(), config({ environment: "production" }));
      expect.unreachable("must refuse");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("idempotent");
      expect(message).toContain("--allow-side-effects");
      // And why, because "refused" without a reason reads as a bug.
      expect(message).toContain("no undo");
    }
  });

  it("allows a story that declares itself idempotent", () => {
    expect(() =>
      checkEnvironment(story({ idempotent: true }), config({ environment: "production" })),
    ).not.toThrow();
  });

  it("allows it when the caller said so on this invocation", () => {
    expect(() =>
      checkEnvironment(story(), config({ environment: "production" }), {
        allowSideEffects: true,
      }),
    ).not.toThrow();
  });

  it("allows it when the project said so, beside the `production` line", () => {
    // `allowSideEffects: true` in the same file that says `environment:
    // production` is someone writing it deliberately, which is what the
    // requirement asks for.
    expect(() =>
      checkEnvironment(story(), config({ environment: "production", allowSideEffects: true })),
    ).not.toThrow();
  });
});

describe("test and staging are not production", () => {
  it("runs a non-idempotent story without ceremony", () => {
    for (const environment of ["test", "staging"] as const) {
      expect(() => checkEnvironment(story(), config({ environment })), environment).not.toThrow();
    }
  });
});
