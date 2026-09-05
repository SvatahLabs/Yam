/**
 * What the grammar emits, before the project is applied (LLD §4.2).
 *
 * The grammar has no dictionary, no data file and no secrets list, so it cannot
 * turn "the username field" into an element id or mark `{data.card.number}`
 * secret. It emits phrases and raw references, and `lower.ts` resolves them.
 *
 * Keeping the two apart is what makes a sentence's *pattern* independent of the
 * project it is compiled in: the same sentence hits the same rule whatever the
 * dictionary says, which is the property `--stable` and the golden set both rest
 * on.
 */

/** A value the grammar read, before it knows whether the path is secret. */
export type RawValue =
  | { readonly literal: string }
  | { readonly var: string; readonly story?: string }
  | { readonly data: string }
  | { readonly input: string }
  | { readonly template: readonly RawValue[] };

export interface RawTarget {
  readonly phrase: string;
  readonly scope?: "page" | "dialog" | "frame" | "desktop" | "window";
}

export interface RawPredicate {
  readonly kind: string;
  readonly negate?: boolean;
  readonly value?: RawValue;
  readonly name?: string;
  readonly numbers?: readonly number[];
  readonly left?: RawValue;
  readonly op?: string;
  readonly right?: RawValue;
}

export interface RawStep {
  readonly action: string;
  readonly target?: RawTarget;
  readonly target2?: RawTarget;
  readonly args?: Readonly<Record<string, RawValue | number | boolean>>;
  readonly expect?: { readonly subject: string; readonly predicate: RawPredicate };
  readonly guard?: {
    readonly subject: string;
    readonly predicate: RawPredicate;
    readonly mode: string;
    /**
     * The noun phrase a `target` guard named (T5.4, Draft 2.7).
     *
     * The grammar reads it because that is how the sentence is written, and
     * `lowerStep` turns it into `guard.target` when it names an element other
     * than the one the step acts on (LLD §3.2). When it names the same element
     * it is dropped, because the step's own target already says it.
     */
    readonly phrase?: string;
  };
  readonly capture?: {
    readonly name: string;
    readonly from: string;
    readonly attribute?: string;
    readonly jsonPath?: string;
  };
  readonly invoke?: { readonly story: string; readonly inputs: Readonly<Record<string, RawValue>> };
}
