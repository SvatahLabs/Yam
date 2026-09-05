/**
 * `promptText` is resolved at the boundary (T7.3, Draft 2.8 §3.2).
 *
 * §3.2 fixes `dialog`'s args as `{ action, text? }`. The raw model-step schema
 * accepts `promptText` as a synonym, because a Tier 2 model may have learned the
 * other name and refusing a correct answer over a spelling would be the wrong
 * trade — but the tolerance stops here, in the lowering.
 *
 * An adapter that had to know both spellings is an adapter that can disagree
 * with another one about which it reads, and that is exactly the shape of the
 * defect §3.2 was written for: the grammar emitted `args.action`, the adapters
 * read `args.accept`, and every dialog was accepted for two phases (P6-F4).
 */
import { describe, expect, it } from "vitest";
import { lowerStep } from "../src/lower.js";
import type { RawStep, RawValue } from "../src/raw.js";

const identity = { id: "s1", storyName: "S", line: 1, text: "Answer the dialog", rule: "p21" };
const context = { secrets: new Set<string>() } as never;

/** A raw arg: the grammar and the tiers write `{ literal: "…" }`, not a string. */
const literal = (value: string): RawValue => ({ literal: value });

const argsOf = (raw: Partial<RawStep>): Record<string, unknown> | undefined =>
  lowerStep(raw as RawStep, identity, context).step.args as Record<string, unknown> | undefined;

describe("dialog args, lowered (T7.3, LLD §3.2)", () => {
  it("renames promptText to text", () => {
    expect(argsOf({ action: "dialog", args: { action: literal("accept"), promptText: literal("Atul") } })).toEqual({
      action: { kind: "literal", value: "accept" },
      text: { kind: "literal", value: "Atul" },
    });
  });

  it("leaves text alone, and prefers it when a step somehow carries both", () => {
    expect(argsOf({ action: "dialog", args: { action: literal("dismiss"), text: literal("Atul") } })).toEqual({
      action: { kind: "literal", value: "dismiss" },
      text: { kind: "literal", value: "Atul" },
    });
    expect(
      argsOf({ action: "dialog", args: { action: literal("accept"), text: literal("right"), promptText: literal("wrong") } }),
    ).toEqual({
      action: { kind: "literal", value: "accept" },
      text: { kind: "literal", value: "right" },
    });
  });

  it("renames it only on a dialog step", () => {
    // `promptText` means nothing to any other action, and a rename that fired
    // everywhere would be a rule nobody could predict.
    expect(argsOf({ action: "type", args: { promptText: literal("Atul") } })).toEqual({
      promptText: { kind: "literal", value: "Atul" },
    });
  });
});
