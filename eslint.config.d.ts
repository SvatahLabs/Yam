/**
 * Types for the workspace lint configuration.
 *
 * `eslint.config.js` is the single source of the LLD §1 import boundaries. The
 * dependency-graph test in `tools/repo-checks` reads `BOUNDARIES` from it so the
 * lint and the test cannot drift apart; this declaration is what lets a strict
 * TypeScript test file import a plain `.js` config.
 */
import type { Linter } from "eslint";

/** One import boundary: `@svatah/<from>` must not import `@svatah/<to>`. */
export interface Boundary {
  /** Package directory name under `packages/`. */
  readonly from: string;
  /** Package directory name under `packages/` that `from` must not reach. */
  readonly to: string;
  /** The clause of LLD §1 this boundary comes from, quoted in the lint message. */
  readonly why: string;
}

/** Every boundary of LLD §1, expanded. */
export declare const BOUNDARIES: readonly Boundary[];

declare const config: Linter.Config[];
export default config;
