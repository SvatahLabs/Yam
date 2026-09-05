/**
 * Types for the generated Tier 1 parser (`grammar/step.peggy`).
 *
 * Hand-written and small, because the generated module is JavaScript with
 * `// @ts-nocheck` on it. What matters to a caller is the two start rules, the
 * shape of a parse failure, and that the result is the raw AST `lower.ts`
 * consumes.
 */
export interface PeggyLocation {
  readonly start: { readonly offset: number; readonly line: number; readonly column: number };
  readonly end: { readonly offset: number; readonly line: number; readonly column: number };
}

export declare class SyntaxError extends Error {
  readonly location: PeggyLocation;
  readonly expected: ReadonlyArray<{ type: string; description?: string }>;
  readonly found: string | null;
}

export declare function parse(
  input: string,
  options?: { startRule?: "Step" | "GuardOnly" },
): unknown;
