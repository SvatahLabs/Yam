/**
 * Types for `scripts/compile-fixtures.mjs`, so the drift test can import it.
 *
 * The script is JavaScript because it runs from the repository root with no
 * build step; the types are here so a TypeScript test can use it without `any`.
 */
export interface FixtureProject {
  readonly name: string;
  /** Project root, relative to the repository root. */
  readonly root: string;
  /** Where the committed plan lives, relative to the repository root. */
  readonly plan: string;
  readonly projectName: string;
  /** The bindings directory, relative to the project root. */
  readonly bindingsDir: string;
}

export declare const FIXTURE_PROJECTS: readonly FixtureProject[];

/** The exact bytes the committed plan should hold. */
export declare function planFor(fixture: FixtureProject): string;
