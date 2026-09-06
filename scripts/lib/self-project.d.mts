/**
 * Types for `scripts/lib/self-project.mjs`, so the repo check can import it.
 *
 * The script is JavaScript because it runs from the repository root with no
 * build step; the types are here so a TypeScript test can use it without `any`.
 */

/** The parts of a Yam project, and whether a copy may do without one. */
export declare const SELF_PROJECT_PARTS: {
  readonly required: readonly string[];
  readonly optional: readonly string[];
};

/**
 * Copy the named parts of a project directory, skipping optional absences.
 *
 * Returns the names that were skipped. Throws when a *required* part is
 * missing, because a project without its flows is not a project.
 */
export declare function copyProjectParts(
  from: string,
  to: string,
  names: readonly string[],
): string[];
