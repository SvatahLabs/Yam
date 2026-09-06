/**
 * T3.4 — the model half of the healing eval (REQ-HEAL-1, REQ-HEAL-5, LLD §10).
 *
 * "Relocalization alone at least 60 percent, with one model call at least 85
 * percent." The second number is what a registered `Regrounder` adds, and three
 * things about it have to be true or it is not a number worth publishing:
 *
 * 1. the model is asked **only** where relocalization declined, never on a
 *    binding it placed (REQ-HEAL-1's ordering);
 * 2. a re-grounded proposal is judged by the same two tests as a relocalized one
 *    — the ground-truth key must match, and a candidate re-synthesised from it
 *    must resolve uniquely — so a model's confidence buys it nothing;
 * 3. with no `Regrounder` registered, `withModel` is the relocalize-only number
 *    and the report says the 85% figure was not measured, rather than reporting
 *    a model result nobody took.
 *
 * The surface is a stub, as in `eval-ground-truth.test.ts`: what is under test is
 * the eval's bookkeeping, not a browser.
 */
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActResult,
  BindingEntry,
  Candidate,
  Capabilities,
  CheckResult,
  ElementDescription,
  Ref,
  SessionState,
  Snapshot,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import { NO_CAPABILITIES, buildSnapshot } from "@svatah/yam-surface";
import { clearRegrounder, registerRegrounder } from "../src/regrounder.js";
import { MODEL_THRESHOLD, runHealingEval } from "../src/eval.js";

function element(ref: Ref, id: string): ElementDescription {
  return {
    ref,
    role: "textbox",
    tag: "input",
    attrs: { id, name: "field", type: "text" },
    text: "Username",
    neighbours: { before: ["Label"], after: ["Help"] },
    rolePath: ["main", "form"],
    box: [10, 20, 100, 30],
    index: 0,
    states: [],
    native: { tag: "input", id },
  };
}

/**
 * One element whose `id` changes on variant 1, and whose *fingerprint* changes
 * with it — so relocalization scores it below the threshold and declines.
 *
 * That is the case the model exists for: the element is still there, and nothing
 * model-free can say which one it is.
 */
class MovedElementSurface implements AgentSurface {
  readonly kind: SurfaceKind = "web";
  private readonly described: ElementDescription;

  constructor(
    private readonly id: string,
    readonly variant: number,
  ) {
    this.described =
      variant === 0
        ? element("r0", id)
        : {
            // Everything a fingerprint scores on has moved: a different tag, a
            // different role path, different neighbours, a different box.
            ...element("r0", id),
            tag: "textarea",
            role: "generic",
            rolePath: ["footer"],
            neighbours: { before: ["Nothing"], after: ["At all"] },
            box: [900, 900, 5, 5],
            text: "",
          };
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
    return { kind: "web", url: "http://127.0.0.1/p" };
  }
  async restore(): Promise<void> {}
}

const options = {
  pages: ["/p"],
  variants: [{ id: 1, title: "the element moved and was renamed", pages: ["/p"] }],
  open: async (_page: string, variant: number) =>
    new MovedElementSurface(variant === 0 ? "user" : "user-renamed", variant) as AgentSurface,
  close: async () => {},
  groundTruth: async () => "p/01-username",
};

/** A `Regrounder` that names the element, the way the recorder's would. */
function grounder(options: { answer: "right" | "wrong" | "declines" }) {
  let asked = 0;
  return {
    plugin: {
      name: "stand-in",
      async ground(_request: unknown, surface: AgentSurface): Promise<BindingEntry | null> {
        asked += 1;
        if (options.answer === "declines") return null;
        const described = await surface.describe("r0" as Ref);
        return {
          context: { pattern: "/p", hash: "h", platform: "web" as const },
          candidates: [
            {
              by: "id" as const,
              value: options.answer === "right" ? described.attrs["id"]! : "nothing-here",
              score: 0.95,
            },
          ],
          fingerprint: {
            tag: described.tag,
            attrs: described.attrs,
            text: described.text,
            neighbours: described.neighbours,
            rolePath: described.rolePath,
            box: described.box,
            index: described.index,
          },
          recordedAt: new Date().toISOString(),
          provenance: {
            model: "stand-in",
            promptVersion: "g-1",
            at: new Date().toISOString(),
            tokensIn: 10,
            tokensOut: 5,
          },
          verified: false,
        };
      },
    },
    asked: () => asked,
  };
}

afterEach(() => {
  clearRegrounder();
});

describe("the model half of REQ-HEAL-5 (LLD §10)", () => {
  it("is not measured at all when nothing is registered", async () => {
    const report = await runHealingEval(options);

    expect(report.totals.degraded).toBeGreaterThan(0);
    expect(report.usedModel).toBe(false);
    expect(report.regrounder).toBe("none");
    expect(report.totals.regrounded).toBe(0);
    // `withModel` equals the relocalize-only rate rather than claiming a number.
    expect(report.withModel).toBe(report.relocalizeOnly);
    expect(report.meetsModelThreshold).toBe(false);
    expect(report.modelThreshold).toBe(MODEL_THRESHOLD);
  });

  it("re-grounds what relocalization declined, and counts it", async () => {
    const stand = grounder({ answer: "right" });
    registerRegrounder(stand.plugin);

    const report = await runHealingEval(options);

    expect(report.usedModel).toBe(true);
    expect(report.regrounder).toBe("stand-in");
    expect(report.totals.regrounded).toBe(report.totals.degraded);
    expect(report.withModel).toBe(1);
    expect(report.meetsModelThreshold).toBe(true);
    // Relocalization's own number is untouched: the model did not improve it,
    // it repaired what relocalization could not.
    expect(report.relocalizeOnly).toBe(0);
  });

  it("asks once per binding relocalization declined, and never on one it placed", async () => {
    const stand = grounder({ answer: "right" });
    registerRegrounder(stand.plugin);

    const report = await runHealingEval(options);
    const declined = report.cases.filter(
      (one) => one.outcome === "regrounded" || one.outcome === "not-found" || one.outcome === "ambiguous",
    ).length;

    expect(stand.asked()).toBe(declined);
    expect(report.cases.filter((one) => one.outcome === "recovered")).toHaveLength(0);
  });

  it("counts a re-grounded proposal on a different element as wrong, not recovered", async () => {
    registerRegrounder({
      name: "stand-in",
      async ground(): Promise<BindingEntry | null> {
        const proposal = await grounder({ answer: "right" }).plugin.ground(
          {},
          new MovedElementSurface("user-renamed", 1) as AgentSurface,
        );
        return proposal;
      },
    });

    // The ground-truth reader says the proposal is somewhere else. The proposal
    // resolves perfectly well; that is exactly the failure a confidence score
    // cannot catch.
    const report = await runHealingEval({
      ...options,
      groundTruth: async (surface) =>
        (surface as MovedElementSurface).variant === 0 ? "p/01-username" : "p/99-elsewhere",
    });

    expect(report.totals.regrounded).toBe(0);
    expect(report.totals.wrongElement).toBe(report.totals.degraded);
    expect(report.withModel).toBe(0);
  });

  it("a proposal that cannot be re-found is unverified, not a recovery", async () => {
    registerRegrounder(grounder({ answer: "wrong" }).plugin);

    const report = await runHealingEval(options);

    expect(report.totals.regrounded).toBe(0);
    expect(report.totals.unverified).toBe(report.totals.degraded);
  });

  it("a Regrounder that declines leaves the case as relocalization left it", async () => {
    const stand = grounder({ answer: "declines" });
    registerRegrounder(stand.plugin);

    const report = await runHealingEval(options);

    expect(stand.asked()).toBeGreaterThan(0);
    expect(report.totals.regrounded).toBe(0);
    expect(report.totals.notFound + report.totals.ambiguous).toBe(report.totals.degraded);
  });
});
