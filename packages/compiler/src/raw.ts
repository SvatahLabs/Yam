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
  readonly guard?: { readonly subject: string; readonly predicate: RawPredicate; readonly mode: string };
  readonly capture?: {
    readonly name: string;
    readonly from: string;
    readonly attribute?: string;
    readonly jsonPath?: string;
  };
  readonly invoke?: { readonly story: string; readonly inputs: Readonly<Record<string, RawValue>> };
}
