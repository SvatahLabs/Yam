/**
 * The shape a flow file reads as (LLD §4.1, `docs/flow-language.md` §1).
 *
 * This is deliberately *not* the IR. The reader's job is the file's block
 * structure — headers, metadata, signatures, which lines are steps and what
 * guards them — and nothing about what a sentence means. A step is a string and
 * a line number here; turning it into an `Action` with a target and arguments is
 * Tier 0 (T2.3) and Tier 1 (T2.4), over this.
 *
 * Keeping the split means the reader can be wrong about a sentence without being
 * wrong about the file, which is what lets an unrecognised sentence be one
 * diagnostic pointing at one line instead of a cascade.
 */
import type { Signature, StoryMeta } from "@svatah/schema";

/** A step line, with the guard that applies to it if there is one. */
export interface RawStep {
  /** The sentence, with the guard prefix removed and whitespace collapsed. */
  readonly text: string;
  /** 1-based line of the sentence itself. */
  readonly line: number;
  /**
   * `Only if <predicate>` / `Unless <predicate>`, from a prefix on this line or
   * from a guard line above it. The predicate is raw text; T2.4 parses it.
   */
  readonly guard?: {
    readonly mode: "onlyIf" | "unless";
    readonly text: string;
    /** Where the guard was written, which may be the line above. */
    readonly line: number;
  };
}

export interface StoryBlock {
  readonly kind: "story" | "scenario";
  readonly name: string;
  readonly line: number;
  readonly meta: StoryMeta;
  readonly signature?: Signature;
  readonly steps: readonly RawStep[];
}

/**
 * A `compose:` or `test:`/`run:` block: a name and an ordered list of names.
 *
 * A run block that lists nothing runs the story or composition of *its own
 * name*. That is how every legacy flow is written — `test : I want to validate
 * stories` — and the v3 fixtures preserve it. `names` therefore already carries
 * the header's name in that case, and `fromHeader` says so, because "the block
 * lists nothing and its own name means nothing either" is a different and much
 * more useful diagnostic than "unknown story".
 */
export interface ListBlock {
  readonly kind: "compose" | "test" | "run";
  readonly name: string;
  readonly line: number;
  readonly names: ReadonlyArray<{ readonly name: string; readonly line: number }>;
  /** True when `names` is the header's own name because the block listed none. */
  readonly fromHeader?: boolean;
}

export type FlowBlock = StoryBlock | ListBlock;

export interface FlowFile {
  /** Path relative to the project root, as it appears in diagnostics. */
  readonly file: string;
  readonly blocks: readonly FlowBlock[];
}

export function isStoryBlock(block: FlowBlock): block is StoryBlock {
  return block.kind === "story" || block.kind === "scenario";
}

export function isRunBlock(block: FlowBlock): block is ListBlock {
  return block.kind === "test" || block.kind === "run";
}
