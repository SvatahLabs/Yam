/**
 * Types for `scripts/fetch-axe.mjs`, so the sheet-audit check can import it.
 *
 * The script is JavaScript because it runs from the repository root with no
 * build step; the types are here so a TypeScript test can use it without `any`.
 */

/** The axe-core build this repository is tested against. */
export declare const AXE_VERSION: string;
/** Its SHA-256. A fetch that does not match it is refused. */
export declare const AXE_SHA256: string;

/** Where the pinned build is cached: outside the repository and `node_modules`. */
export declare function axePath(): string;

/**
 * The pinned axe-core, downloading it once per machine.
 *
 * Throws with a readable reason when there is no network or when the bytes are
 * not the pinned ones; the caller decides whether that is a skip or a failure.
 */
export declare function ensureAxe(): Promise<string>;
