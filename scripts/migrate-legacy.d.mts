/**
 * Types for `scripts/migrate-legacy.mjs`, so the drift test can import it.
 */
import type { MigrateResult } from "@svatah/migrate";

/** `legacy/src/test/resources`, relative to the repository root. */
export declare const SOURCE: string;
/** `evals/migrate/expected`, relative to the repository root. */
export declare const EXPECTED: string;

/** Migrate the frozen legacy project into `destination`, report and all. */
export declare function migrateLegacy(destination: string): MigrateResult;

/** Every file under a directory, as `relative path → contents`. */
export declare function snapshot(dir: string): Map<string, string>;
