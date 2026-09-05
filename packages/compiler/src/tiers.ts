/**
 * The tier pipeline (REQ-COMP-1..4, LLD §4.1).
 *
 * A sentence is offered to each tier in order and the first that claims it wins:
 *
 * | Tier | What it is | When it arrives |
 * |---|---|---|
 * | 0 | Custom typed steps (`@svatah/steps`) | T2.3 |
 * | 1 | The controlled grammar | T2.4 |
 * | 2 | A local 1.7B–4B instruct model | Phase 4 |
 * | 3 | A frontier model, for Tier 2's residue | Phase 4 |
 *
 * Tiers 2 and 3 are *plugins*, registered by the CLI when a model is configured.
 * The compiler declares the interface and defaults to nothing, which is what
 * keeps `compile` offline by default (REQ-NFR-3) and keeps `@svatah/compiler`
 * free of a dependency on the gateway.
 *
 * ## Why Tier 0 goes first, and why that needs a rule
 *
 * A project must be able to claim a sentence shape the grammar would otherwise
 * take — that is what an escape hatch is for. But then a sentence could satisfy
 * both, and which one ran would depend on nothing a reader can see. REQ-LANG-16
 * makes that an error naming both, which is why `compileSentence` asks Tier 1
 * even after Tier 0 has claimed a sentence: it has to know whether there was a
 * second claimant.
 */
import type { Step } from "@svatah/schema";
import type { Diagnostic } from "@svatah/spec";

/** A tier that a model backs. Registered by the CLI; absent by default. */
export interface ModelTier {
  readonly tier: 2 | 3;
  /** Compile one sentence, or return nothing to pass it on. */
  compile(
    text: string,
    context: { file: string; line: number; storyName: string },
  ): Promise<{ step: Partial<Step>; diagnostics?: readonly Diagnostic[] } | undefined>;
}

const registered = new Map<2 | 3, ModelTier>();

/** Register a model-backed tier. Module (b)'s CLI does this when configured. */
export function registerTier(tier: ModelTier): void {
  registered.set(tier.tier, tier);
}

export function clearTiers(): void {
  registered.clear();
}

export function tierFor(level: 2 | 3): ModelTier | undefined {
  return registered.get(level);
}

/** Whether any model-backed tier is available, for `--tier2` / `--tier3` checks. */
export function hasModelTiers(): boolean {
  return registered.size > 0;
}
