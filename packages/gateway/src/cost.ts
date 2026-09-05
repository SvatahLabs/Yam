/**
 * What a call cost (REQ-NFR-2: "estimated and actual tokens and cost printed per
 * invocation", REQ-AGT-3: cost in provenance).
 *
 * A table rather than a lookup at run time: a record of what a recording cost has
 * to be reproducible a year later, and a price fetched from the network would
 * make two runs of the same eval disagree for a reason that is not about the
 * eval. The prices are per million tokens, in US dollars.
 *
 * A model absent from the table costs `0` and says so through `known`, so a
 * report never quietly presents a made-up number as a measured one.
 */

export interface Prices {
  /** US dollars per million input tokens. */
  readonly input: number;
  /** US dollars per million output tokens. */
  readonly output: number;
  /** Per million tokens read from the prompt cache. */
  readonly cacheRead: number;
  /** Per million tokens written to the prompt cache. */
  readonly cacheWrite: number;
}

/**
 * Anthropic first-party rates. Cache reads are a tenth of the input rate and
 * cache writes 1.25× it, which is the published relationship rather than a
 * separately quoted number.
 */
function anthropic(input: number, output: number): Prices {
  return { input, output, cacheRead: input * 0.1, cacheWrite: input * 1.25 };
}

export const PRICES: Readonly<Record<string, Prices>> = {
  "claude-opus-5": anthropic(5, 25),
  "claude-opus-4-8": anthropic(5, 25),
  "claude-sonnet-5": anthropic(2, 10),
  "claude-haiku-4-5": anthropic(1, 5),
};

export interface TokenCounts {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
}

/** Whether the cost of this model is a measured number rather than a zero. */
export function priced(model: string): boolean {
  return PRICES[model] !== undefined;
}

/**
 * Dollars for one call.
 *
 * A locally hosted model has no per-token price and returns `0` — which is the
 * true marginal cost, not a missing number, and `priced()` is how a report tells
 * the two cases apart.
 */
export function costOf(model: string, tokens: TokenCounts): number {
  const price = PRICES[model];
  if (price === undefined) return 0;
  return (
    (tokens.tokensIn * price.input +
      tokens.tokensOut * price.output +
      (tokens.cacheRead ?? 0) * price.cacheRead +
      (tokens.cacheWrite ?? 0) * price.cacheWrite) /
    1_000_000
  );
}

/** `$0.0123`, for a line a person reads. */
export function formatUsd(amount: number): string {
  return amount >= 0.01 ? `$${amount.toFixed(2)}` : `$${amount.toFixed(4)}`;
}
