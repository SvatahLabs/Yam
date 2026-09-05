/**
 * P1-F1 — the healing eval verifies a repair against a ground-truth key
 * (LLD §16, REQ-HEAL-5 as amended in Draft 2.3).
 *
 * The negative control is the point of this file. It is easy to write a check
 * that always says "correct" — comparing a value with itself, or comparing two
 * values that are both `undefined` — and such a check would raise the published
 * number while proving nothing. So the same eval is run twice over the same
 * surface, changing only what the ground-truth reader says: once truthfully, and
 * once with the key of the proposed element deliberately altered. The first must
 * report `recovered`, the second `wrong-element`. A comparison that cannot fail
 * cannot pass this.
 *
 * The surface here is a stub. What is being tested is the eval's bookkeeping,
 * not a browser; the browser half is `packages/playwright-test/test/relocalize.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import type {
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  ElementDescription,
  Ref,
  SessionState,
  Snapshot,
  SurfaceKind,
} from "@svatah/schema";
import type { AgentSurface } from "@svatah/surface";
import { NO_CAPABILITIES, buildSnapshot } from "@svatah/surface";
import { runHealingEval } from "../src/eval.js";

/** One element, described the way an adapter would. */
function element(ref: Ref, id: string, name: string): ElementDescription {
  return {
    ref,
    role: "textbox",
    tag: "input",
    attrs: { id, name: "field", type: "text" },
    text: name,
    neighbours: { before: ["Label"], after: ["Help"] },
    rolePath: ["main", "form"],
    box: [10, 20, 100, 30],
    index: 0,
    states: [],
    native: { tag: "input", id },
  };
}

/**
 * A surface with exactly one element, whose `id` changes on variant 1.
 *
 * That is the whole scenario the eval needs: the recorded `id` candidate stops
 * resolving, relocalization scores the one element on the page and proposes it,
 * and a candidate re-synthesised from the new `id` resolves. Whether that counts
 * as a recovery is then entirely down to the ground-truth comparison.
 */
class OneElementSurface implements AgentSurface {
  readonly kind: SurfaceKind = "web";
  private readonly described: ElementDescription;

  constructor(
    private readonly id: string,
    readonly variant: number,
  ) {
    this.described = element("r0", id, "Username");
  }

  capabilities(): Capabilities {
    return { ...NO_CAPABILITIES };
  }
  async open(): Promise<void> {}
  async close(): Promise<void> {}
  async snapshot(): Promise<Snapshot> {
    return buildSnapshot(
      "r0",
      [{ ref: "r0", role: "textbox", name: "Username", states: [], depth: 0 }],
      "0".repeat(64),
    );
  }
  async act(): Promise<ActResult> {
    return { ok: true };
  }
  async read(): Promise<unknown> {
    return null;
  }
  async check(): Promise<CheckResult> {
    return { ok: true };
  }
  /** Only a candidate naming the *current* id finds the element. */
  async locate(candidate: Candidate): Promise<Ref[]> {
    if (candidate.by === "id") return candidate.value === this.id ? ["r0"] : [];
    if (candidate.by === "role" || candidate.by === "name" || candidate.by === "text") return ["r0"];
    return [];
  }
  async describe(): Promise<ElementDescription> {
    return this.described;
  }
  async screenshot(): Promise<void> {}
  async state(): Promise<SessionState> {
    return { url: "http://127.0.0.1/p" };
  }
  async restore(): Promise<void> {}
}

const options = {
  pages: ["/p"],
  variants: [{ id: 1, title: "the id was renamed", pages: ["/p"] }],
  open: async (_page: string, variant: number) =>
    new OneElementSurface(variant === 0 ? "user" : "user-renamed", variant) as AgentSurface,
  close: async () => {},
};

/** Truthful at variant 0, a different element afterwards. */
const shuffled = async (surface: AgentSurface): Promise<string> =>
  (surface as OneElementSurface).variant === 0 ? "p/01-username" : "p/02-somewhere-else";

describe("the healing eval checks its answers (LLD §16, Draft 2.3)", () => {
  it("counts a repair as recovered when the proposal is the element the binding was recorded on", async () => {
    const report = await runHealingEval({
      ...options,
      groundTruth: async () => "p/01-username",
    });

    expect(report.totals.degraded, "the variant degraded nothing to repair").toBeGreaterThan(0);
    expect(report.totals.recovered).toBe(report.totals.degraded);
    expect(report.totals.wrongElement).toBe(0);
  });

  it("counts it as wrong-element when the proposal is a different element", async () => {
    // The negative control the verification contract asks for: the same run, with
    // the key of the *proposed* element altered while the recorded one stays as
    // it was. Nothing else changes — same surface, same candidates, same score.
    const report = await runHealingEval({ ...options, groundTruth: shuffled });

    expect(report.totals.wrongElement).toBe(report.totals.degraded);
    expect(report.totals.recovered).toBe(0);
    expect(report.relocalizeOnly).toBe(0);
  });

  it("carries both keys into the case, so the report can name the mistake", async () => {
    const report = await runHealingEval({ ...options, groundTruth: shuffled });

    const wrong = report.cases.find((c) => c.outcome === "wrong-element");
    expect(wrong?.expectedTruth, "the key the binding was recorded on").toBe("p/01-username");
    expect(wrong?.proposedTruth, "the key of what relocalization proposed").toBe(
      "p/02-somewhere-else",
    );
  });

  it("reports unverified, not recovered, when it could not read a key at all", async () => {
    // A run with no ground truth available must not publish a recovery rate it
    // had no way to check. This is what an adapter without the page-script
    // affordance produces.
    const report = await runHealingEval(options);

    expect(report.totals.degraded).toBeGreaterThan(0);
    expect(report.totals.recovered).toBe(0);
    expect(report.totals.unverified).toBe(report.totals.degraded);
    expect(report.totals.wrongElement).toBe(0);
  });
});
